/**
 * Fresh Markets Watch — Alchemy Notify webhook handler (ticket #300).
 *
 * Every request must carry a valid `x-alchemy-signature` HMAC-SHA256 header
 * computed over the raw request body with the webhook's signing key
 * (`ALCHEMY_SIGNING_KEY`, a wrangler secret — never a literal). Unsigned or
 * forged payloads are rejected before parsing. Reverted transactions are
 * acknowledged with 200-without-store so Alchemy does not retry them.
 */

import type { AlchemyWebhookPayload, ChainId, DetectedPair, NewPair } from "./types";
import { getChainConfig, getFactoriesForChain, resolveRpcUrl } from "./chains";
import { KVStore } from "./kv";
import { detectedToNewPair } from "./pair";
import { extractHoldersFallback } from "./holders";
import { factoryNameFor } from "./scanner";
import { ethers } from "ethers";
import type { KVNamespace } from "@cloudflare/workers-types";

const ALCHEMY_SIGNATURE_HEADER = "x-alchemy-signature";
const textEncoder = new TextEncoder();

export interface WebhookEnv {
  FRESH_KV: KVNamespace;
  ALCHEMY_API_KEY: string;
  /** Alchemy webhook signing key (wrangler secret). */
  ALCHEMY_SIGNING_KEY: string;
}

export type SignatureVerdict = "ok" | "unconfigured" | "invalid";

/**
 * Verify Alchemy's `x-alchemy-signature` header (hex HMAC-SHA256 of the raw
 * body) in constant time. Fails closed: a missing signing key never falls
 * back to trusting the payload.
 */
export async function verifyAlchemySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string | undefined
): Promise<SignatureVerdict> {
  if (!signingKey) return "unconfigured";
  if (!signatureHeader) return "invalid";

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, textEncoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(mac), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  return timingSafeEqualHex(expected, signatureHeader.trim().toLowerCase())
    ? "ok"
    : "invalid";
}

/** Constant-time comparison of two equal-alphabet hex digests. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function handleWebhook(
  request: Request,
  env: WebhookEnv
): Promise<Response> {
  try {
    const rawBody = await request.text();
    const verdict = await verifyAlchemySignature(
      rawBody,
      request.headers.get(ALCHEMY_SIGNATURE_HEADER),
      env.ALCHEMY_SIGNING_KEY
    );
    if (verdict === "unconfigured") {
      // Fail closed: reject rather than trust unverified payloads. Alchemy
      // retries 5xx responses, which surfaces the deploy misconfiguration.
      return new Response("Webhook signing key not configured", { status: 503 });
    }
    if (verdict === "invalid") {
      return new Response("Invalid webhook signature", { status: 401 });
    }

    let payload: AlchemyWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as AlchemyWebhookPayload;
    } catch {
      return new Response("Invalid webhook payload", { status: 400 });
    }
    if (!payload?.event?.hash) {
      return new Response("Invalid webhook payload", { status: 400 });
    }

    const chain: ChainId = payload.network.toLowerCase().includes("bsc")
      ? "bsc"
      : "ethereum";
    const event = payload.event;

    const detected = parsePairCreatedEvent(event, chain);
    if (!detected) {
      return new Response("Failed to parse pair event", { status: 400 });
    }

    const verified = await verifyTransactionStatus(event.hash, chain, env.ALCHEMY_API_KEY);
    if (!verified) {
      // Reverted tx: acknowledge without storing so Alchemy doesn't retry.
      return new Response("Transaction failed verification", { status: 200 });
    }

    const holders = await extractHoldersFallback(
      detected.tx_hash,
      detected.chain,
      detected.pair_address,
      detected.token0,
      detected.token1,
      env.ALCHEMY_API_KEY
    );

    const newPair: NewPair = detectedToNewPair(detected, {
      factoryName: factoryNameFor(detected.factory_address),
      holders: holders.holders,
    });

    const kvStore = new KVStore(env.FRESH_KV);
    await kvStore.append(detected.chain, [newPair]);

    return new Response(JSON.stringify({ success: true, pair: newPair }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

function parsePairCreatedEvent(
  event: AlchemyWebhookPayload["event"],
  chain: ChainId
): DetectedPair | null {
  try {
    const factories = getFactoriesForChain(chain);
    const factory = factories.find(
      (f) => f.address.toLowerCase() === event.contractAddress.toLowerCase()
    );
    if (!factory) return null;

    const iface =
      factory.version === "v2"
        ? new ethers.Interface([
            "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
          ])
        : new ethers.Interface([
            "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
          ]);

    const parsed = iface.parseLog({ topics: event.topics, data: event.data });
    if (!parsed) return null;
    const args = parsed.args as Record<string, string>;
    const token0 = (args.token0 ?? "").toLowerCase();
    const token1 = (args.token1 ?? "").toLowerCase();
    const pair = (args.pair ?? args.pool ?? "").toLowerCase();
    if (!token0 || !token1 || !pair) return null;

    return {
      pair_address: pair,
      factory_address: factory.address,
      version: factory.version,
      token0,
      token1,
      tx_hash: event.hash,
      block_number: event.blockNumber,
      log_index: event.logIndex,
      chain,
      timestamp: event.timestamp > 1e12 ? Math.floor(event.timestamp / 1000) : event.timestamp,
    };
  } catch (error) {
    console.error("Parse event error:", error);
    return null;
  }
}

async function verifyTransactionStatus(
  txHash: string,
  chain: ChainId,
  apiKey: string
): Promise<boolean> {
  try {
    const config = getChainConfig(chain);
    const provider = new ethers.JsonRpcProvider(resolveRpcUrl(config.rpc_url, apiKey));
    const receipt = await provider.getTransactionReceipt(txHash);
    return receipt?.status === 1;
  } catch {
    return false;
  }
}
