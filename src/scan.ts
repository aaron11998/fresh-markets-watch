/**
 * Fresh Markets Watch — x402 /scan endpoint (ticket #302).
 */

import type { ChainId, NewPair, ScanRequest, ScanResponse } from "./types";
import { isChainId } from "./chains";
import { KVStore } from "./kv";
import type { KVNamespace } from "@cloudflare/workers-types";

export interface ScanEnv {
  FRESH_KV: KVNamespace;
  ORG_EVM_PAYTO: string;
}

const X402_PRICE_USD = "0.01";
const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_WINDOW_MINUTES = 10;

export async function handleScan(request: Request, env: ScanEnv): Promise<Response> {
  const paymentHeader = request.headers.get("X-PAYMENT");

  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base",
            maxAmountRequired: X402_PRICE_USD,
            resource: new URL(request.url).pathname,
            description: "Fresh Markets Watch scan - new AMM pair data",
            mimeType: "application/json",
            payTo: env.ORG_EVM_PAYTO,
            maxTimeoutSeconds: 300,
            asset: USDC_ON_BASE,
            extra: { name: "USDC", version: "1" },
          },
        ],
      }),
      {
        status: 402,
        headers: { "Content-Type": "application/json", "X-PAYMENT-REQUIRED": "1" },
      }
    );
  }

  // Payment verification with the x402 facilitator lands in #303 wiring.
  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as ScanRequest;
    const windowMinutes =
      typeof body.window_minutes === "number" && body.window_minutes > 0
        ? body.window_minutes
        : DEFAULT_WINDOW_MINUTES;

    const kvStore = new KVStore(env.FRESH_KV);
    const chains: readonly ChainId[] =
      body.chain === "both" || !body.chain
        ? ["ethereum", "bsc"]
        : isChainId(body.chain)
          ? [body.chain]
          : [];

    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    let pairs: NewPair[] = [];
    for (const chain of chains) {
      let chainPairs = await kvStore.read(chain);
      if (body.factories && body.factories.length > 0) {
        const factorySet = new Set(body.factories.map((f) => f.toLowerCase()));
        chainPairs = chainPairs.filter((p) => factorySet.has(p.factory.toLowerCase()));
      }
      pairs = pairs.concat(chainPairs.filter((p) => Date.parse(p.created_at) >= cutoff));
    }

    pairs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    const response: ScanResponse = {
      pairs,
      cached_at: new Date().toISOString(),
      count: pairs.length,
    };
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Scan error:", error);
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
