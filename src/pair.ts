/**
 * Fresh Markets Watch — NewPair construction helpers (foundation).
 *
 * Shared mapping from internal detection records to the wire-level NewPair
 * contract so webhook and cron paths cannot drift.
 */

import type { DetectedPair, NewPair, PairToken } from "./types";

/** Unix seconds → ISO-8601. Normalizes millisecond inputs defensively. */
export function isoFromUnix(seconds: number): string {
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

/** Lowercase-trimmed PairToken; symbol is filled by enrichment later. */
export function makeToken(address: string, symbol = ""): PairToken {
  return { address: address.toLowerCase(), symbol };
}

/** Map a DetectedPair to the persisted NewPair shape. */
export function detectedToNewPair(
  detected: DetectedPair,
  opts: {
    factoryName: string;
    holders: string[];
    /** Raw initial reserves per token (integer strings); optional until enriched. */
    initLiquidity?: { token0_raw: string; token1_raw: string } | null;
    symbols?: { token0?: string; token1?: string };
  }
): NewPair {
  return {
    pair_address: detected.pair_address.toLowerCase(),
    chain: detected.chain,
    factory: detected.factory_address,
    factory_version: detected.version,
    tokens: [
      makeToken(detected.token0, opts.symbols?.token0 ?? ""),
      makeToken(detected.token1, opts.symbols?.token1 ?? ""),
    ],
    init_liquidity: opts.initLiquidity ?? null,
    top_holders: opts.holders,
    created_at: isoFromUnix(detected.timestamp),
    block_number: detected.block_number,
    tx_hash: detected.tx_hash,
    factory_name: opts.factoryName,
  };
}
