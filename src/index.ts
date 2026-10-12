/**
 * Fresh Markets Watch — Worker entry point (ticket #303 wiring surface).
 *
 * Routes:
 *   POST /webhook  — Alchemy Notify receiver
 *   POST /scan     — x402-gated pair query
 *   GET  /health   — free health check
 *   cron           — fallback scanner
 */

import { handleWebhook } from "./webhook";
import { handleScan } from "./scan";
import { handleHealth } from "./health";
import { runCronScanner } from "./scanner";
import type { KVStore as KVStoreType } from "./kv";
import { KVStore } from "./kv";
import type { NewPair } from "./types";
import type { ExecutionContext, KVNamespace, ScheduledEvent } from "@cloudflare/workers-types";

export interface Env {
  FRESH_KV: KVNamespace;
  ALCHEMY_API_KEY: string;
  /** Alchemy webhook signing key (wrangler secret, used by /webhook). */
  ALCHEMY_SIGNING_KEY: string;
  ORG_EVM_PAYTO: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;

    try {
      if (path === "/webhook" && request.method === "POST") {
        return handleWebhook(request, env);
      }
      if (path === "/scan" && request.method === "POST") {
        return handleScan(request, env);
      }
      if (path === "/health" && request.method === "GET") {
        return handleHealth(request, env);
      }
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Fetch error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await runCronScanner(env);
          console.log(
            `Cron completed: ${result.scanned} scanned, ${result.added} added, ${result.errors.length} errors`
          );
          if (result.errors.length) console.error("Cron errors:", result.errors);
        } catch (error) {
          console.error("Cron error:", error);
        }
      })()
    );
  },
};

// Re-exported for tests and downstream tickets.
export { KVStore };
export type { KVStoreType, NewPair };
