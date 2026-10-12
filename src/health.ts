/**
 * Fresh Markets Watch — free /health endpoint (ticket #302).
 */

import type { HealthResponse } from "./types";
import { KVStore } from "./kv";
import type { KVNamespace } from "@cloudflare/workers-types";

export interface HealthEnv {
  FRESH_KV: KVNamespace;
}

export async function handleHealth(_request: Request, env: HealthEnv): Promise<Response> {
  try {
    const kvStore = new KVStore(env.FRESH_KV);
    const chains = await kvStore.listChains();
    const perChain = Object.fromEntries(
      chains.map(({ chain, pairs }) => [chain, { pairs_cached: pairs.length }])
    );

    const health: HealthResponse = {
      status: "ok",
      pairs_cached: chains.reduce((sum, c) => sum + c.pairs.length, 0),
      chains: {
        ethereum: perChain.ethereum ?? { pairs_cached: 0 },
        bsc: perChain.bsc ?? { pairs_cached: 0 },
      },
    };

    return new Response(JSON.stringify(health), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return new Response(
      JSON.stringify({
        status: "degraded",
        error: "KV unavailable",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
