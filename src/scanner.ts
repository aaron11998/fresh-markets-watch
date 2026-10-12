/**
 * Fresh Markets Watch — Cron scanner (ticket #301).
 *
 * Fallback detection: scans the last ~15 minutes of blocks for
 * PairCreated/PoolCreated events on every configured factory.
 */

import { getChainConfig, getFactoriesForChain, resolveRpcUrl } from "./chains";
import type { ChainId, DetectedPair, FactoryConfig } from "./types";
import { KVStore } from "./kv";
import { detectedToNewPair } from "./pair";
import { extractHoldersFallback } from "./holders";
import { ethers } from "ethers";
import type { KVNamespace } from "@cloudflare/workers-types";

export interface ScannerEnv {
  FRESH_KV: KVNamespace;
  ALCHEMY_API_KEY: string;
}

const BATCH_SIZE = 20;
const MAX_ELAPSED_MS = 25000; // stay under Worker CPU/wall limits
const CRON_LOOKBACK_MINUTES = 15;

export async function runCronScanner(
  env: ScannerEnv
): Promise<{ scanned: number; added: number; errors: string[] }> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalScanned = 0;
  let totalAdded = 0;
  const kvStore = new KVStore(env.FRESH_KV);

  for (const chain of ["ethereum", "bsc"] as const) {
    if (Date.now() - startTime > MAX_ELAPSED_MS) {
      errors.push("CPU limit reached; stopping scan early");
      break;
    }
    const config = getChainConfig(chain);
    const provider = new ethers.JsonRpcProvider(
      resolveRpcUrl(config.rpc_url, env.ALCHEMY_API_KEY)
    );
    const factories = getFactoriesForChain(chain);

    let currentBlock: number;
    try {
      currentBlock = await provider.getBlockNumber();
    } catch (error) {
      errors.push(`${chain}: getBlockNumber failed: ${error instanceof Error ? error.message : "Unknown"}`);
      continue;
    }
    const fromBlock = Math.max(0, currentBlock - CRON_LOOKBACK_MINUTES * config.blocks_per_minute);

    for (const factory of factories) {
      if (Date.now() - startTime > MAX_ELAPSED_MS) {
        errors.push("CPU limit reached; stopping factory scan");
        break;
      }
      try {
        const detected = await scanFactory(provider, factory, fromBlock, currentBlock);
        totalScanned += detected.length;
        for (let i = 0; i < detected.length; i += BATCH_SIZE) {
          const batch = detected.slice(i, i + BATCH_SIZE);
          totalAdded += await processBatch(batch, env.ALCHEMY_API_KEY, kvStore);
        }
      } catch (error) {
        const msg = `Factory ${factory.name} error: ${error instanceof Error ? error.message : "Unknown"}`;
        errors.push(msg);
      }
    }
  }

  return { scanned: totalScanned, added: totalAdded, errors };
}

async function scanFactory(
  provider: ethers.JsonRpcProvider,
  factory: FactoryConfig,
  fromBlock: number,
  toBlock: number
): Promise<DetectedPair[]> {
  const logs = await provider.getLogs({
    address: factory.address,
    fromBlock,
    toBlock,
    topics: [factory.event_topic0],
  });

  const iface =
    factory.version === "v2"
      ? new ethers.Interface([
          "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
        ])
      : new ethers.Interface([
          "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
        ]);

  const pairs: DetectedPair[] = [];
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (!parsed) continue;
      const args = parsed.args as Record<string, string>;
      const token0 = (args.token0 ?? "").toLowerCase();
      const token1 = (args.token1 ?? "").toLowerCase();
      const pair = (args.pair ?? args.pool ?? "").toLowerCase();
      if (!token0 || !token1 || !pair) continue;
      pairs.push({
        pair_address: pair,
        factory_address: factory.address,
        version: factory.version,
        token0,
        token1,
        tx_hash: log.transactionHash,
        block_number: log.blockNumber,
        log_index: log.index,
        chain: factory.chain as ChainId,
        timestamp: Math.floor(Date.now() / 1000),
      });
    } catch {
      // malformed/unrelated log — skip
    }
  }
  return pairs;
}

async function processBatch(
  batch: DetectedPair[],
  apiKey: string,
  kvStore: KVStore
): Promise<number> {
  let added = 0;
  for (const detected of batch) {
    try {
      const holders = await extractHoldersFallback(
        detected.tx_hash,
        detected.chain,
        detected.pair_address,
        detected.token0,
        detected.token1,
        apiKey
      );
      const newPair = detectedToNewPair(detected, {
        factoryName: factoryNameFor(detected.factory_address),
        holders: holders.holders,
      });
      await kvStore.append(detected.chain, [newPair]);
      added++;
    } catch (error) {
      console.error(`Batch process error: ${error instanceof Error ? error.message : error}`);
    }
  }
  return added;
}

export function factoryNameFor(address: string): string {
  const factories: Record<string, string> = {
    "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f": "UniswapV2",
    "0x1f98431c8ad98523631ae4a59f267346ea31f984": "UniswapV3",
    "0xca143ce32fe78f1f7019d7d551a6402fc5350c73": "PancakeSwapV2",
    "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865": "PancakeSwapV3",
  };
  return factories[address.toLowerCase()] ?? "Unknown";
}
