/**
 * Fresh Markets Watch — Hardcoded chain configs (ticket #298).
 *
 * Factories per AC:
 *  - Ethereum Uniswap V2  0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f
 *  - Ethereum Uniswap V3  0x1F98431c8aD98523631AE4a59f267346ea31F984
 *  - BSC PancakeSwap V2   0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73
 *  - BSC PancakeSwap V3   0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865
 *
 * rpc_url values are templates: `${ALCHEMY_API_KEY}` is substituted at call
 * time via resolveRpcUrl(); never connect to the raw string.
 */

import type { ChainConfig, ChainId, FactoryConfig } from "./types";

export const ALCHEMY_RPC_TEMPLATE = "https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}";
export const ALCHEMY_BSC_RPC_TEMPLATE = "https://bsc-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}";

/** Well-known canonical Uniswap-V2-style PairCreated topic0. */
export const PAIR_CREATED_TOPIC0 =
  "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";
/** Canonical Uniswap-V3-style PoolCreated topic0. */
export const POOL_CREATED_TOPIC0 =
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e2b7171";

export const PAIR_CREATED_SIGNATURE = "PairCreated(address,address,address,uint256)";
export const POOL_CREATED_SIGNATURE =
  "PoolCreated(address,address,uint24,int24,address)";

const ETHEREUM_FACTORIES: FactoryConfig[] = [
  {
    address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    version: "v2",
    name: "UniswapV2",
    chain: "ethereum",
    event_signature: PAIR_CREATED_SIGNATURE,
    event_topic0: PAIR_CREATED_TOPIC0,
  },
  {
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    version: "v3",
    name: "UniswapV3",
    chain: "ethereum",
    event_signature: POOL_CREATED_SIGNATURE,
    event_topic0: POOL_CREATED_TOPIC0,
  },
];

const BSC_FACTORIES: FactoryConfig[] = [
  {
    address: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    version: "v2",
    name: "PancakeSwapV2",
    chain: "bsc",
    event_signature: PAIR_CREATED_SIGNATURE,
    event_topic0: PAIR_CREATED_TOPIC0,
  },
  {
    address: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    version: "v3",
    name: "PancakeSwapV3",
    chain: "bsc",
    event_signature: POOL_CREATED_SIGNATURE,
    event_topic0: POOL_CREATED_TOPIC0,
  },
];

export const CHAINS: Record<ChainId, ChainConfig> = {
  ethereum: {
    name: "ethereum",
    chain_id: 1,
    rpc_url: ALCHEMY_RPC_TEMPLATE,
    blocks_per_minute: 5, // 12s blocks
    factories: ETHEREUM_FACTORIES,
  },
  bsc: {
    name: "bsc",
    chain_id: 56,
    rpc_url: ALCHEMY_BSC_RPC_TEMPLATE,
    blocks_per_minute: 20, // 3s blocks
    factories: BSC_FACTORIES,
  },
};

export const CHAIN_IDS: readonly ChainId[] = ["ethereum", "bsc"];

export function isChainId(value: string): value is ChainId {
  return value === "ethereum" || value === "bsc";
}

export function getChainConfig(chain: ChainId): ChainConfig {
  return CHAINS[chain];
}

export function getFactoriesForChain(chain: ChainId): FactoryConfig[] {
  return CHAINS[chain].factories;
}

export function getAllFactories(): FactoryConfig[] {
  return [...ETHEREUM_FACTORIES, ...BSC_FACTORIES];
}

export function findFactory(address: string): FactoryConfig | undefined {
  const needle = address.toLowerCase();
  return getAllFactories().find((f) => f.address.toLowerCase() === needle);
}

/**
 * Substitute ${ALCHEMY_API_KEY} in an rpc_url template.
 * Throws when the key is missing so callers fail loudly instead of
 * hitting a URL that contains a literal template marker.
 */
export function resolveRpcUrl(template: string, apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error("ALCHEMY_API_KEY is not set; cannot resolve RPC url");
  }
  return template.replace("${ALCHEMY_API_KEY}", apiKey);
}
