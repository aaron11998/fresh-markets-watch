import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KVStore, KV_TTL_SECONDS, KV_WRITE_BACKOFF_MS, kvKeyForChain } from "../src/kv";
import type { NewPair } from "../src/types";

class MockKVNamespace {
  store = new Map<string, string>();
  failNext = 0;
  puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void> {
    this.puts.push({ key, value, options });
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("kv transient failure");
    }
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makePair(overrides: Partial<NewPair> = {}): NewPair {
  return {
    pair_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    chain: "ethereum",
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    factory_version: "v2",
    tokens: [
      { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", symbol: "AAA" },
      { address: "0xccccccccccccccccccccccccccccccccccccccccc", symbol: "WETH" },
    ],
    init_liquidity: { token0_raw: "1000000", token1_raw: "2000000" },
    top_holders: ["0xddddddddddddddddddddddddddddddddddddddddd"],
    created_at: new Date().toISOString(),
    block_number: 12345,
    tx_hash: "0x" + "ab".repeat(32),
    factory_name: "UniswapV2",
    ...overrides,
  };
}

describe("KVStore (#298 AC)", () => {
  let mock: MockKVNamespace;
  let store: KVStore;

  beforeEach(() => {
    mock = new MockKVNamespace();
    store = new KVStore(mock);
  });

  it("reads empty array for missing key", async () => {
    expect(await store.read("ethereum")).toEqual([]);
  });

  it("writes with the 10-minute TTL", async () => {
    await store.write("ethereum", [makePair()]);
    expect(mock.puts).toHaveLength(1);
    expect(mock.puts[0].key).toBe(kvKeyForChain("ethereum"));
    expect(mock.puts[0].options?.expirationTtl).toBe(KV_TTL_SECONDS);
    expect(KV_TTL_SECONDS).toBe(600);
  });

  it("round-trips pairs", async () => {
    const pair = makePair();
    await store.write("bsc", [pair]);
    const read = await store.read("bsc");
    expect(read).toHaveLength(1);
    expect(read[0].pair_address).toBe(pair.pair_address);
  });

  it("filters expired entries on read", async () => {
    const stale = makePair({ pair_address: "0x1111111111111111111111111111111111111111" });
    stale.created_at = new Date(Date.now() - 2 * KV_TTL_SECONDS * 1000).toISOString();
    await store.write("ethereum", [stale]);
    expect(await store.read("ethereum")).toEqual([]);
  });

  it("appends unique pairs and dedupes by pair_address", async () => {
    const p1 = makePair({ pair_address: "0x1111111111111111111111111111111111111111" });
    const p2 = makePair({ pair_address: "0x2222222222222222222222222222222222222222" });
    expect(await store.append("ethereum", [p1])).toBe(1);
    expect(await store.append("ethereum", [p2])).toBe(1);
    // Same address, different case → still deduped.
    const p1Upper = makePair({ pair_address: "0X1111111111111111111111111111111111111111" });
    expect(await store.append("ethereum", [p1Upper])).toBe(0);
    expect(await store.read("ethereum")).toHaveLength(2);
  });

  it("has() checks dedup without writing", async () => {
    const pair = makePair();
    expect(await store.has("ethereum", pair.pair_address)).toBe(false);
    await store.append("ethereum", [pair]);
    expect(await store.has("ethereum", pair.pair_address.toUpperCase())).toBe(true);
  });

  it("retries failed writes twice with 100ms/500ms backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const sleepSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((cb: () => void, ms?: number) => {
        sleeps.push(ms ?? 0);
        cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout);

    mock.failNext = 2; // fail twice, succeed on 3rd attempt
    const ok = await store.write("ethereum", [makePair()]);
    expect(ok).toBe(true);
    expect(sleeps).toEqual([...KV_WRITE_BACKOFF_MS]); // [100, 500]
    expect(await store.read("ethereum")).toHaveLength(1);

    sleepSpy.mockRestore();
  });

  it("returns false (not throws) after exhausting all retries", async () => {
    mock.failNext = 99; // every attempt fails
    const ok = await store.write("ethereum", [makePair()]);
    expect(ok).toBe(false);
    // Initial attempt + 2 retries = 3 puts
    expect(mock.puts).toHaveLength(3);
  });

  it("append() propagates failure when the write gives up", async () => {
    mock.failNext = 99;
    await expect(store.append("ethereum", [makePair()])).rejects.toThrow(/KV append failed/);
  });

  it("listChains() reports per-chain pairs", async () => {
    await store.append("ethereum", [makePair()]);
    await store.append("bsc", [makePair({ pair_address: "0x2222222222222222222222222222222222222222" })]);
    const chains = await store.listChains();
    expect(chains.find((c) => c.chain === "ethereum")?.pairs).toHaveLength(1);
    expect(chains.find((c) => c.chain === "bsc")?.pairs).toHaveLength(1);
  });
});
