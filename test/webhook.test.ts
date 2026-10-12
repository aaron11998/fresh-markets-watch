import { describe, it, expect } from "vitest";
import { handleWebhook, verifyAlchemySignature } from "../src/webhook";
import type { WebhookEnv } from "../src/webhook";

const SIGNING_KEY = "test-signing-key-#300";

async function signBody(body: string, key: string = SIGNING_KEY): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeEnv(overrides: Partial<WebhookEnv> = {}): WebhookEnv {
  return {
    FRESH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    ALCHEMY_API_KEY: "unused-in-signature-tests",
    ALCHEMY_SIGNING_KEY: SIGNING_KEY,
    ...overrides,
  } as WebhookEnv;
}

function signedRequest(body: string, headers: Record<string, string>): Request {
  return new Request("https://worker.test/webhook", {
    method: "POST",
    body,
    headers,
  });
}

describe("verifyAlchemySignature (#300)", () => {
  it("accepts a correctly signed payload", async () => {
    const body = JSON.stringify({ webhookId: "w", network: "ETH_MAINNET", event: {} });
    const sig = await signBody(body);
    expect(await verifyAlchemySignature(body, sig, SIGNING_KEY)).toBe("ok");
  });

  it("accepts uppercase or padded signature headers", async () => {
    const body = "payload";
    const sig = await signBody(body);
    expect(await verifyAlchemySignature(body, ` ${sig.toUpperCase()} `, SIGNING_KEY)).toBe("ok");
  });

  it("rejects a signature computed over different bytes (tampered body)", async () => {
    const body = JSON.stringify({ ok: true });
    const sig = await signBody(body);
    const tampered = JSON.stringify({ ok: true, injected: true });
    expect(await verifyAlchemySignature(tampered, sig, SIGNING_KEY)).toBe("invalid");
  });

  it("rejects a signature from the wrong key", async () => {
    const body = "payload";
    const sig = await signBody(body, "attacker-key");
    expect(await verifyAlchemySignature(body, sig, SIGNING_KEY)).toBe("invalid");
  });

  it("rejects a missing signature header", async () => {
    expect(await verifyAlchemySignature("payload", null, SIGNING_KEY)).toBe("invalid");
  });

  it("fails closed when the signing key is unconfigured", async () => {
    expect(await verifyAlchemySignature("payload", "deadbeef", undefined)).toBe("unconfigured");
    expect(await verifyAlchemySignature("payload", "deadbeef", "")).toBe("unconfigured");
  });

  it("negative control: the signer used by these tests is not trivially pass-through", async () => {
    const body = "payload";
    const sig = await signBody(body);
    expect(sig).not.toBe("payload");
    expect(sig).toHaveLength(64);
    expect(await verifyAlchemySignature("other-payload", sig, SIGNING_KEY)).toBe("invalid");
  });
});

describe("handleWebhook signature gate (#300)", () => {
  const structurallyInvalidPayload = JSON.stringify({ webhookId: "w", network: "ETH_MAINNET" });

  it("returns 401 and never parses the payload when the signature is invalid", async () => {
    const res = await handleWebhook(
      signedRequest(structurallyInvalidPayload, { "x-alchemy-signature": "00".repeat(32) }),
      makeEnv()
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid webhook signature");
  });

  it("returns 401 when the signature header is absent", async () => {
    const res = await handleWebhook(
      signedRequest(structurallyInvalidPayload, {}),
      makeEnv()
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when ALCHEMY_SIGNING_KEY is unset (fail closed, Alchemy retries)", async () => {
    const sig = await signBody(structurallyInvalidPayload);
    const res = await handleWebhook(
      signedRequest(structurallyInvalidPayload, { "x-alchemy-signature": sig }),
      makeEnv({ ALCHEMY_SIGNING_KEY: undefined } as Partial<WebhookEnv>)
    );
    expect(res.status).toBe(503);
  });

  it("proceeds past the signature gate only for validly signed requests", async () => {
    // Valid signature over a payload with no event.hash reaches the parse
    // validation (400), proving the gate is order-correct: signature before
    // body semantics.
    const sig = await signBody(structurallyInvalidPayload);
    const res = await handleWebhook(
      signedRequest(structurallyInvalidPayload, { "x-alchemy-signature": sig }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid webhook payload");
  });

  it("returns 400 (not 500) for signed garbage JSON", async () => {
    const garbage = "{{not-json";
    const sig = await signBody(garbage);
    const res = await handleWebhook(
      signedRequest(garbage, { "x-alchemy-signature": sig }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });
});
