# Read performance

The November 14, 2026 investigation found two separate costs: the configured
public NEAR RPC took about three seconds per view from the VPS, and the board
waited for three views in sequence. GitHub descriptions could add further waits.

Read-only measurements and their context are recorded in
[PERFORMANCE_MEASUREMENTS.json](PERFORMANCE_MEASUREMENTS.json). No transactions
were sent while profiling.

## Measurements

| Measurement | Before | After |
| --- | ---: | ---: |
| Public board API, successful sample | 9,993 ms | 1,733 ms first observed / 222 ms repeated, after the provider change alone |
| Public leaderboard API, successful sample | 3,267 ms | 1,167 ms first observed / 265 ms repeated, after the provider change alone |
| RPC status + finalized view, from the VPS | Official endpoint: 3,175 / 3,052 ms | FastNEAR: 83 / 53 ms; dRPC: 128 / 65 ms |
| Revised local board read model | — | 567 ms empty read cache / under 1 ms cached |
| Revised local single-bounty detail | — | 204 ms empty read cache / under 1 ms cached |
| Revised local leaderboard | — | 205 ms empty read cache / under 1 ms cached |
| Revised local contributor profile | — | 279 ms empty read cache / under 1 ms cached |

These are individual diagnostic samples, not percentiles or a load test.
Public API timings include network/TLS and HTTP overhead; the first post-change
configuration request alone took 1,146 ms versus 222 ms on repeat. Local revised
numbers measure exported server data functions using real finalized testnet
state, an empty metadata database, and explicit read-cache invalidation before
each screen. They do not measure production HTTP or browser rendering. The warm
transport is reused after the first local query. The raw JSON distinguishes all
test conditions.

Initial public board/detail/leaderboard/profile samples returned 503 before the
successful baseline samples. The app exposed the failure honestly; it did not
replace the unavailable chain state with demo balances. A provider improvement
does not guarantee future testnet availability.

## Provider

The [NEAR RPC provider documentation](https://docs.near.org/api/rpc/providers)
lists `https://test.rpc.fastnear.com` and `https://near-testnet.drpc.org` as public
testnet endpoints. Read-only checks from the actual web container confirmed
`chain_id: testnet` and current finalized contract views on both. The operator
changed the hosted `NEAR_RPC_URL` to FastNEAR after those checks. The shared public
configuration now uses FastNEAR as its default; an explicit environment value
still takes precedence.

The application does not silently switch RPC providers during transaction
submission, re-sign a transaction, or add a broadcast retry. Public contract
views use the documented `query` / `call_function` JSON-RPC shape with
`finality: final`, strict response decoding, no redirects, and a six-second
abort deadline. This avoids near-api-js 7.5.3's default twelve HTTP attempts
holding a public page open. The verified SDK remains responsible for NEP-413,
access-key checks, transaction status, and the separate signing services.

## Source changes

- The board starts contract configuration and the first bounty page together.
  It does not request configuration twice. Additional pages run at most four
  at a time, and incomplete/noncontiguous rows fail rather than silently dropping
  escrow records. A first page that raced new funding is retried once.
- Detail reads request only the selected bounty and configuration. Contributor
  profile data starts alongside its board read instead of after it.
- A process-wide, bounded display cache coalesces concurrent reads for five
  seconds. A slow initial read remains shared while pending; its successful
  result gets a usable cache lifetime. Composite responses retain older
  `updatedAt` boundaries instead of extending them. Namespace keys include mode,
  contract account, and RPC URL.
- Confirmed transaction responses invalidate display caches. In-flight older
  requests cannot refill an invalidated cache. `getBounty` and `viewContract`
  remain uncached authority reads for confirmation and appeal eligibility.
- GitHub titles/descriptions no longer block escrow responses. Known text is
  served immediately while stale/missing descriptions refresh with three workers,
  four-second timeouts, and retry backoff. Failed refreshes do not overwrite good
  text with placeholders. Cold instances display the real issue number/link
  until descriptive text arrives. `metadataUpdatedAt` and `metadataStale` make
  that distinction explicit.
- Public board/detail/profile/leaderboard responses expose `updatedAt`,
  `Server-Timing`, `X-GitSettle-Read-At`, and the five-second cache TTL. HTTP
  responses remain `Cache-Control: no-store`. Client display caching must retain
  that read timestamp and clear on confirmed wallet updates.

Descriptive metadata can be stale. Monetary display snapshots are short-lived
finalized observations; failed refreshes return an error, with no stale-success
fallback and no illustrative/live data mixing. A cached screen never authorizes
a transfer: the contract and uncached transaction confirmation remain decisive.

## Validation

For comparable public HTTP samples before and after a deployment, use the same
machine and this read-only script:

```sh
npx tsx scripts/measure-performance.ts \
  --origin https://gitsettle.89.167.109.196.sslip.io \
  --output /tmp/gitsettle-api-after.json
```

It makes five sequential rounds across configuration, board, bounty #8, and
leaderboard. The report includes each HTTP status, total/header time, parsed
`Server-Timing` durations, medians, and allowlisted counts/state summaries. It
contains no response bodies, cookies, credentials, or signatures. The origin can
also come from the exported `APP_ORIGIN`; `.env` files are not loaded. Omitting
`--output` prints the report without creating a file. Existing artifacts are
never overwritten. Missing server timing metrics remain empty rather than being
invented. `--timeout-ms` defaults to 15,000; use `--help` for options.

Ten focused regressions cover concurrent board reads, blocked GitHub metadata,
direct detail loading, uncached authority reads, parallel profile fetches, RPC
namespace isolation, bounded/complete pagination, malformed RPC responses,
success-only cache expiry, failure recovery, confirmation invalidation, and
composite snapshot age. Run:

```sh
npx tsx --test packages/shared/src/read-cache.test.ts packages/shared/src/data.test.ts
npm run typecheck
```

The source changes passed those checks. Production build and browser/layout
validation are coordinated with the accompanying UI revision; the measurement
file does not claim that the revised source was already deployed when sampled.

## Browser work and wallet recovery

The public-view navigation cache is bounded to 100 URLs, coalesces in-flight requests and respects the server snapshot timestamp. It excludes all private/auth/AI endpoints. A URL change never displays another account's previous record, and confirmed transactions invalidate pending and cached observations. Mounted content remains stable during a refresh, hidden tabs do not poll, and visible tabs resume with a fresh read. Six isolated regressions cover the cache boundary and invalidation races.

Wallet Selector's signing/cryptography code is loaded on Connect for new visitors. Existing selector state, a pending transaction or a wallet return initializes it immediately. Persisted transaction recovery runs before optional chunk loading, so a failed download cannot lose a sent request. Mismatched return evidence preserves original intent for recovery; only a verified matching finalized failure permits clearing it. Browser checks cover lazy Connect and failure/recovery paths.
