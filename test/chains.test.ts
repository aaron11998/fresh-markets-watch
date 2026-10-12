import { describe, it, expect } from "vitest";
import {
  CHAINS,
  CHAIN_IDS,
  getChainConfig,
  getFactoriesForChain,
  getAllFactories,
  findFactory,
  resolveRpcUrl,
} from "../src/chains";

describe("Chain configurations (#298 AC)", () => {
  it("exposes ethereum and bsc configs with chain ids", () => {
    expect(CHAINS.ethereum.chain_id).toBe(1);
    expect(CHAINS.bsc.chain_id).toBe(56);
    expect(CHAIN_IDS).toEqual(["ethereum", "bsc"]);
  });

  it("hardcodes the four AC factory addresses (checksummed)", () => {
    const all = getAllFactories();
    expect(all.map((f) => f.address)).toEqual([
      "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Ethereum Uniswap V2
      "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Ethereum Uniswap V3
      "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73", // BSC PancakeSwap V2
      "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", // BSC PancakeSwap V3
    ]);
  });

  it("carries blocks_per_minute per chain", () => {
    expect(getChainConfig("ethereum").blocks_per_minute).toBe(5); // 12s blocks
    expect(getChainConfig("bsc").blocks_per_minute).toBe(20); // 3s blocks
  });

  it("returns factories filtered by chain", () => {
    const eth = getFactoriesForChain("ethereum");
    expect(eth.map((f) => f.name)).toEqual(["UniswapV2", "UniswapV3"]);
    const bsc = getFactoriesForChain("bsc");
    expect(bsc.map((f) => f.name)).toEqual(["PancakeSwapV2", "PancakeSwapV3"]);
  });

  it("uses canonical event topics for v2 PairCreated and v3 PoolCreated", () => {
    for (const chain of ["ethereum", "bsc"] as const) {
      const factories = getFactoriesForChain(chain);
      expect(factories[0].event_topic0).toBe(
        "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9"
      );
      expect(factories[1].event_topic0).toBe(
        "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e2b7171"
      );
    }
  });

  it("finds factories case-insensitively", () => {
    expect(findFactory("0xca143ce32fe78f1f7019d7d551a6402fc5350c73")?.name).toBe(
      "PancakeSwapV2"
    );
    expect(findFactory("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });

  it("resolveRpcUrl substitutes the key and fails loudly without one", () => {
    const url = resolveRpcUrl(CHAINS.ethereum.rpc_url, "test-key-123");
    expect(url).toBe("https://eth-mainnet.g.alchemy.com/v2/test-key-123");
    expect(url).not.toContain("${");
    expect(() => resolveRpcUrl(CHAINS.ethereum.rpc_url, undefined)).toThrow(
      /ALCHEMY_API_KEY/
    );
  });
});
