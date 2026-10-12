# Fresh Markets Watch

Real-time AMM pair detection for Ethereum and BSC, served over HTTP from a
Cloudflare Worker. Watches the four canonical factories (Uniswap V2/V3,
PancakeSwap V2/V3) for `PairCreated`/`PoolCreated` events via two
complementary paths, caches the resulting pairs in Workers KV with a
10-minute TTL, and exposes them through an x402-paid `/scan` endpoint.

## Detection paths

1. **Webhook** (`POST /webhook`) — Alchemy Notify address-activity events are
   parsed, the creation transaction is verified on-chain (reverted
   transactions are acknowledged and dropped), initial mint holders are
   extracted from the transaction receipt, and the pair is appended to KV.
2. **Cron scanner** (`scheduled`) — a fallback that polls the last ~15
   minutes of blocks for factory events every run and persists anything the
   webhook missed. Hard 25-second wall-clock budget per run.

Both paths converge on one mapping (`src/pair.ts`) so the persisted
`NewPair` shape cannot drift between them.

## HTTP surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/webhook` | POST | Alchemy | Ingest pair-creation events |
| `/scan` | POST | x402 (0.01 USDC on Base) | Query cached new pairs |
| `/health` | GET | none | Cache status per chain |

## `/scan` request

```json
{
  "chain": "ethereum" | "bsc" | "both",
  "factories": ["0x..."],
  "window_minutes": 10
}
```

All fields optional; defaults are `both` and 10 minutes. Response is
`{ pairs, cached_at, count }`, newest first.

## Configuration

Secrets are never stored in the repo. Set them with:

```sh
wrangler secret put ALCHEMY_API_KEY
wrangler secret put ORG_EVM_PAYTO
```

`ALCHEMY_API_KEY` is substituted into the per-chain RPC URL templates at
call time by `resolveRpcUrl()` — the raw templates in `src/chains.ts` are
inert. `ORG_EVM_PAYTO` is the x402 payee address for `/scan`.

Bind a Workers KV namespace as `FRESH_KV` (see `wrangler.toml`).

## Development

```sh
npm install
npm run dev         # wrangler dev
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
npm run deploy
```

## Module map

- `src/types.ts` — the wire contract (`NewPair`, KV envelope, request/response types)
- `src/chains.ts` — chain + factory configs, `resolveRpcUrl()`
- `src/kv.ts` — TTL KV store: read/write/append with dedup + retry/backoff
- `src/pair.ts` — shared `DetectedPair` → `NewPair` mapping
- `src/holders.ts` — initial-holder extraction from creation tx receipts
- `src/webhook.ts` — Alchemy Notify handler
- `src/scanner.ts` — cron fallback scanner
- `src/scan.ts` — x402-gated query endpoint
- `src/health.ts` — free health endpoint
- `src/index.ts` — worker entry point and routing

## Known limitations

- `/scan` accepts the `X-PAYMENT` header but does not settle it with the
  x402 facilitator yet; settlement lands with the wiring ticket (#303).
- Token symbols and initial liquidity are populated only when enrichment
  data is available at detection time.
