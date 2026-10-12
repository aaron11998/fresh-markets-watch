/**
 * Fresh Markets Watch — Foundation contract types (bounty #1, ticket #298).
 *
 * Zero external dependencies: every other module imports its wire contract
 * from here. Field names are snake_case per the #298 acceptance criteria.
 */

export type ChainId = "ethereum" | "bsc";
export type FactoryVersion = "v2" | "v3";

/** One token of a pair. `symbol` is empty until fetched from the token contract. */
export interface PairToken {
  address: string;
  symbol: string;
}

/** Initial liquidity in raw token units (integer strings, no price feed). */
export interface InitLiquidity {
  token0_raw: string;
  token1_raw: string;
}

/** A newly created AMM pair/pool, as produced by every detection path. */
export interface NewPair {
  pair_address: string;
  chain: ChainId;
  /** Factory contract that emitted the creation event (checksummed). */
  factory: string;
  factory_version: FactoryVersion;
  /** [token0, token1] in factory sort order. */
  tokens: [PairToken, PairToken];
  init_liquidity: InitLiquidity | null;
  /** Initial holder addresses (deployer, pair, mint recipients). */
  top_holders: string[];
  /** ISO-8601 timestamp of the block that created the pair. */
  created_at: string;
  block_number: number;
  tx_hash: string;
  factory_name: string;
}

/** Per-chain static configuration. */
export interface ChainConfig {
  name: ChainId;
  /** EVM chain id (1 = Ethereum, 56 = BSC). */
  chain_id: number;
  /** URL template; resolve with resolveRpcUrl() — never use raw. */
  rpc_url: string;
  blocks_per_minute: number;
  factories: FactoryConfig[];
}

export interface FactoryConfig {
  /** EIP-55 checksummed factory address. */
  address: string;
  version: FactoryVersion;
  name: string;
  chain: ChainId;
  /** Canonical event signature used for log parsing. */
  event_signature: string;
  /** topic0 hash of event_signature. */
  event_topic0: string;
}

/** Result of holder extraction over a creation transaction. */
export interface HolderResult {
  holders: string[];
  warnings: string[];
}

/** Internal detection record before enrichment into NewPair. */
export interface DetectedPair {
  pair_address: string;
  factory_address: string;
  version: FactoryVersion;
  token0: string;
  token1: string;
  tx_hash: string;
  block_number: number;
  log_index: number;
  chain: ChainId;
  /** Unix seconds. */
  timestamp: number;
}

/** KV envelope persisted under `pairs:{chain}`. */
export interface KVEntry {
  pairs: NewPair[];
  updated_at: string;
}

/** x402 /scan request body. */
export interface ScanRequest {
  chain?: ChainId | "both";
  factories?: string[];
  window_minutes?: number;
}

export interface ScanResponse {
  pairs: NewPair[];
  cached_at: string;
  count: number;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  pairs_cached: number;
  chains: Record<ChainId, { pairs_cached: number; last_webhook?: string; last_cron?: string }>;
}

/** Alchemy Notify address-activity payload (subset we consume). */
export interface AlchemyWebhookPayload {
  webhookId: string;
  network: string;
  event: {
    type: string;
    hash: string;
    blockNumber: number;
    logIndex: number;
    contractAddress: string;
    topics: string[];
    data: string;
    /** Event timestamp; seconds or milliseconds depending on sender. */
    timestamp: number;
  };
}

/** Structural KV binding — avoids importing @cloudflare/workers-types here. */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export class PairDetectionError extends Error {
  constructor(
    message: string,
    public code:
      | "WEBHOOK_PARSE"
      | "CRON_FETCH"
      | "HOLDER_EXTRACT"
      | "KV_WRITE"
      | "RPC_ERROR"
      | "TX_VERIFY"
  ) {
    super(message);
    this.name = "PairDetectionError";
  }
}
