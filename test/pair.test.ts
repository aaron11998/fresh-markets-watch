import { describe, it, expect } from "vitest";
import { isoFromUnix, makeToken, detectedToNewPair } from "../src/pair";
import type { DetectedPair } from "../src/types";

function makeDetected(overrides: Partial<DetectedPair> = {}): DetectedPair {
  return {
    pair_address: "0xAABBCCDDEEFF00112233445566778899AABBCCDD",
    factory_address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    version: "v2",
    token0: "0x1111111111111111111111111111111111111111",
    token1: "0x2222222222222222222222222222222222222222",
    tx_hash: "0x" + "cd".repeat(32),
    block_number: 20600123,
    log_index: 7,
    chain: "ethereum",
    timestamp: 1700000000,
    ...overrides,
  };
}

describe("pair helpers (#298 AC)", () => {
  it("isoFromUnix converts seconds to ISO-8601", () => {
    expect(isoFromUnix(1700000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("isoFromUnix normalizes millisecond inputs defensively", () => {
    expect(isoFromUnix(1700000000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("makeToken lowercases the address and defaults the symbol to empty", () => {
    expect(makeToken("0xAbCdEf0000000000000000000000000000000001")).toEqual({
      address: "0xabcdef0000000000000000000000000000000001",
      symbol: "",
    });
    expect(makeToken("0xAbCdEf0000000000000000000000000000000001", "WETH").symbol).toBe(
      "WETH"
    );
  });

  it("detectedToNewPair maps every field onto the wire contract", () => {
    const detected = makeDetected();
    const np = detectedToNewPair(detected, {
      factoryName: "UniswapV2",
      holders: ["0xdddd000000000000000000000000000000000001"],
    });
    expect(np.pair_address).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
    expect(np.chain).toBe("ethereum");
    expect(np.factory).toBe("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f");
    expect(np.factory_version).toBe("v2");
    expect(np.tokens).toEqual([
      { address: "0x1111111111111111111111111111111111111111", symbol: "" },
      { address: "0x2222222222222222222222222222222222222222", symbol: "" },
    ]);
    expect(np.init_liquidity).toBeNull();
    expect(np.top_holders).toEqual(["0xdddd000000000000000000000000000000000001"]);
    expect(np.created_at).toBe("2023-11-14T22:13:20.000Z");
    expect(np.block_number).toBe(20600123);
    expect(np.tx_hash).toBe(detected.tx_hash);
    expect(np.factory_name).toBe("UniswapV2");
  });

  it("detectedToNewPair carries optional symbols and init liquidity when enriched", () => {
    const np = detectedToNewPair(makeDetected({ version: "v3", chain: "bsc" }), {
      factoryName: "PancakeSwapV3",
      holders: [],
      initLiquidity: { token0_raw: "1000000", token1_raw: "2000000" },
      symbols: { token0: "AAA", token1: "WBNB" },
    });
    expect(np.factory_version).toBe("v3");
    expect(np.chain).toBe("bsc");
    expect(np.init_liquidity).toEqual({ token0_raw: "1000000", token1_raw: "2000000" });
    expect(np.tokens[0].symbol).toBe("AAA");
    expect(np.tokens[1].symbol).toBe("WBNB");
  });
});
