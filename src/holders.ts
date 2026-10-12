/**
 * Fresh Markets Watch — Holder extraction engine (ticket #299).
 *
 * Parses the creation tx receipt for ERC-20 Transfer mint events
 * (from = 0x0) on the two pair tokens; no external indexer APIs.
 */

import type { HolderResult } from "./types";
import { getChainConfig, resolveRpcUrl } from "./chains";
import { ethers } from "ethers";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_HOLDERS = 10;
const FEW_HOLDERS_THRESHOLD = 3;

export async function extractHolders(
  txHash: string,
  chain: "ethereum" | "bsc",
  pairAddress: string,
  token0: string,
  token1: string,
  apiKey: string,
  deployer?: string
): Promise<HolderResult> {
  const warnings: string[] = [];
  const holders = new Set<string>();

  if (deployer) holders.add(deployer.toLowerCase());
  holders.add(pairAddress.toLowerCase());

  try {
    const config = getChainConfig(chain);
    const provider = new ethers.JsonRpcProvider(
      resolveRpcUrl(config.rpc_url, apiKey)
    );

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      warnings.push(`Transaction receipt not found: ${txHash}`);
      return { holders: Array.from(holders).filter(Boolean), warnings };
    }
    if (receipt.status !== 1) {
      warnings.push(`Transaction failed: ${txHash}`);
      return { holders: [], warnings };
    }

    for (const log of receipt.logs) {
      if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      const from = `0x${log.topics[1].slice(26)}`;
      const to = `0x${log.topics[2].slice(26)}`;
      const token = log.address.toLowerCase();
      if (from !== ZERO_ADDRESS && to !== ZERO_ADDRESS) continue;
      if (from !== ZERO_ADDRESS) continue; // mint = from 0x0
      if (to === ZERO_ADDRESS) continue;
      if (token !== token0.toLowerCase() && token !== token1.toLowerCase()) continue;
      holders.add(to.toLowerCase());
    }

    const found = Array.from(holders).filter(Boolean).slice(0, MAX_HOLDERS);
    if (found.length < FEW_HOLDERS_THRESHOLD) {
      warnings.push(`Few holders found (${found.length}), using fallback`);
      return {
        holders: Array.from(
          new Set([deployer?.toLowerCase() || "", pairAddress.toLowerCase()])
        ).filter(Boolean),
        warnings,
      };
    }
    return { holders: found, warnings };
  } catch (error) {
    warnings.push(
      `Holder extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { holders: Array.from(holders).filter(Boolean), warnings };
  }
}

export async function extractHoldersFallback(
  txHash: string,
  chain: "ethereum" | "bsc",
  pairAddress: string,
  token0: string,
  token1: string,
  apiKey: string
): Promise<HolderResult> {
  return extractHolders(txHash, chain, pairAddress, token0, token1, apiKey, undefined);
}
