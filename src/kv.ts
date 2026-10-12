/**
 * Fresh Markets Watch — KV helpers (ticket #298).
 *
 * Contract per AC:
 *  - write with TTL (default 10 min)
 *  - read, list by chain, dedup check (append)
 *  - write retries twice with 100ms / 500ms backoff on failure
 */

import type { KVEntry, KVNamespaceLike, NewPair } from "./types";

export const KV_TTL_SECONDS = 600; // 10 minutes
export const KV_KEY_PREFIX = "pairs:";

/** Backoff schedule for KV write retries: 2 retries → 100ms, 500ms. */
export const KV_WRITE_BACKOFF_MS: readonly number[] = [100, 500];

export function kvKeyForChain(chain: "ethereum" | "bsc"): string {
  return `${KV_KEY_PREFIX}${chain}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KVStore {
  constructor(private kv: KVNamespaceLike) {}

  async read(chain: "ethereum" | "bsc"): Promise<NewPair[]> {
    const raw = await this.kv.get(kvKeyForChain(chain));
    if (!raw) return [];
    let entry: KVEntry;
    try {
      entry = JSON.parse(raw) as KVEntry;
    } catch {
      return [];
    }
    const pairs = Array.isArray(entry?.pairs) ? entry.pairs : [];
    const cutoff = Date.now() - KV_TTL_SECONDS * 1000;
    return pairs.filter((p) => Date.parse(p.created_at) > cutoff);
  }

  /**
   * Write with TTL; retries twice on failure with 100ms/500ms backoff.
   * Returns true on success, false only after all retries are exhausted.
   */
  async write(chain: "ethereum" | "bsc", pairs: NewPair[]): Promise<boolean> {
    const entry: KVEntry = { pairs, updated_at: new Date().toISOString() };
    const body = JSON.stringify(entry);
    const key = kvKeyForChain(chain);

    let lastError: unknown;
    for (let attempt = 0; attempt <= KV_WRITE_BACKOFF_MS.length; attempt++) {
      try {
        await this.kv.put(key, body, { expirationTtl: KV_TTL_SECONDS });
        return true;
      } catch (error) {
        lastError = error;
        if (attempt < KV_WRITE_BACKOFF_MS.length) {
          await sleep(KV_WRITE_BACKOFF_MS[attempt]);
        }
      }
    }
    console.error(
      `KV write failed after ${KV_WRITE_BACKOFF_MS.length + 1} attempts for ${key}:`,
      lastError instanceof Error ? lastError.message : lastError
    );
    return false;
  }

  /**
   * Dedup check built in: only appends pairs whose pair_address is not
   * already stored (case-insensitive). Returns how many were added.
   */
  async append(chain: "ethereum" | "bsc", newPairs: NewPair[]): Promise<number> {
    const existing = await this.read(chain);
    const seen = new Set(existing.map((p) => p.pair_address.toLowerCase()));
    const fresh = newPairs.filter((p) => !seen.has(p.pair_address.toLowerCase()));
    if (fresh.length === 0) return 0;
    const merged = [...fresh, ...existing];
    const ok = await this.write(chain, merged);
    if (!ok) {
      throw new Error(`KV append failed for ${chain}; ${fresh.length} pair(s) not persisted`);
    }
    return fresh.length;
  }

  /** Dedup probe without writing: true if pair_address is already stored. */
  async has(chain: "ethereum" | "bsc", pairAddress: string): Promise<boolean> {
    const existing = await this.read(chain);
    const needle = pairAddress.toLowerCase();
    return existing.some((p) => p.pair_address.toLowerCase() === needle);
  }

  async count(chain: "ethereum" | "bsc"): Promise<number> {
    return (await this.read(chain)).length;
  }

  async listChains(): Promise<Array<{ chain: "ethereum" | "bsc"; pairs: NewPair[] }>> {
    const out: Array<{ chain: "ethereum" | "bsc"; pairs: NewPair[] }> = [];
    for (const chain of ["ethereum", "bsc"] as const) {
      out.push({ chain, pairs: await this.read(chain) });
    }
    return out;
  }

  async clear(chain: "ethereum" | "bsc"): Promise<void> {
    await this.kv.delete(kvKeyForChain(chain));
  }
}
