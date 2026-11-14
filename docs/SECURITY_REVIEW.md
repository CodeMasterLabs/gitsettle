# Security review checkpoint

Reviewed on 2026-11-14. This is an implementation review and regression-test
checkpoint, not an independent audit or a claim of production readiness.

Scope: `contracts/gitsettle/src/lib.rs`, contract transition tests, `services/verifier`, `packages/community`, and `packages/triage`. The deployed contract was read but **not changed** during
this review. Deployment identity and Wasm digest are in `DEPLOYMENT.json`.

## Findings fixed in the verifier

| Finding | Resolution and regression coverage |
| --- | --- |
| An already-merged historical PR could be rebound by editing its body after funding. | Automatic release requires `merged_at >= bounty.created_at`. A PR opened before the bounty remains eligible if merged after funding. |
| Evidence in hidden comments, examples or quoted text could count as an intentional issue reference/account binding. | The documented plain body lines must be visible. Comments, fenced/indented code, inline code and blockquotes are excluded; closing-keyword references start their own line or list item. |
| Malformed changed-file status and path components were too permissive. | Unknown statuses fail as operational errors; removed/unchanged files cannot qualify; URL `.`/`..` segments are rejected. Exact locale boundaries and full pagination already had regression coverage. |
| A `.testnet` account suffix alone did not verify the configured network. | Service startup checks RPC `chain_id === "testnet"` before checking the configured verifier or signing. |

The verifier suite now has **64 passing tests**, including nested cases and the
AgentGuard integration described below. Root
TypeScript checking also passed after these changes. The suite covers canonical
URL/host/number boundaries, other-repository references, claimant/contract/bounty
binding, unmerged PRs beyond deadline, malformed/rate-limited API responses,
locale paths, complete pagination/3000-file cap, stale submissions, overlapping
scans, dry runs, failed transfer callbacks and retries. External services are
mocked by these tests; live transaction proof belongs in `LIVE_E2E.json` only
after the real loop passes.

The subsequent [AgentGuard integration](AGENTGUARD.md) runs pinned local recipient
and text-risk checks before automatic release, plus a separate exact per-payout
cap. Review/deny/error holds never call `reject_submission`; they preserve
Submitted state and poster review. Raw PR context is not persisted. This adds no
on-chain AgentGuard custody, TEE attestation, cumulative budget guarantee or
protection against a compromised verifier key. Legitimate security/localization
text can require manual review.

## Community and AI review

At the community/triage checkpoint, the Node suite passed 136 tests (64 verifier, 32 community, 33 triage and 7 shared). Authentication uses genuine NEP-413 signatures, browser/domain/account binding, single-use challenges, finalized key checks and hashed sessions. Ticket identities are session-derived, mutations require exact origin, and unauthorized resources return 404.

Two additional review findings were fixed with regressions: rotating invented account IDs could bypass the per-account challenge limit, so issuance now has an atomic 120/minute deployment ceiling and actual-expiry pruning; chat history could retain extra nested fields, so provider context is projected to only `role` and `content`. SQLite transactions cover support quotas/duplicates/writes and AI daily quotas across connections.

Optional LLM context and output are bounded, provider redirects/tool calls are refused, errors redact credentials, and AI has no financial authority. IP throttles require correctly configured proxy trust; wallet quotas cannot defeat Sybil wallets. Support text is plaintext in the operator database; AI requests use the configured external provider's privacy policy. Provider behavior is fixture-tested; no paid live LLM test is claimed. See [COMMUNITY.md](COMMUNITY.md) and [TRIAGE.md](TRIAGE.md).

## Contract paths reviewed

- Initialization is single-use and restricted to the contract account. Creation
  collects exactly reward plus the nonrefundable 0.05 NEAR storage reserve.
- Claimants cannot be the poster; only the recorded claimant submits; only the
  poster or verifier releases; only the verifier rejects; only the poster refunds.
- Refund requires the deadline and Open/Claimed/Rejected state. Submitted records
  block refunds while the verifier resolves evidence, including after deadline.
- Release/refund switch to an intermediate state before scheduling the transfer.
  Private callbacks require exactly one promise result and the expected state.
  Failed transfers restore the previous actionable state; successful reward
  callbacks alone add earned balance, merge count and points.
- Record lengths, maximum reward, deadline horizon, query pages and the top-100
  leaderboard are bounded. The fixed reserve covers bounded record growth rather
  than coming out of the reward. Settlement reserves a 30 Tgas callback and requires
  at least 60 Tgas; clients attach 100 Tgas.

No direct unauthorized-transfer or duplicate-settlement bypass was found in
these paths. Native Rust tests do not meter real Wasm execution. The callback's
bounded work reduces gas risk, but does not prove every future protocol/runtime
condition will complete within its budget.

## Accepted MVP limits and operational risks

- **Upgradeable account:** the development contract account retains a full-access
  key. Its holder can replace code and therefore controls a trust boundary beyond
  the verifier/poster methods in the current code. The verifier field is immutable
  in current storage, not an immutable-deployment guarantee.
- **Trusted metadata and operator:** PR authors and authorized maintainers can
  edit body markers. The marker binds the declared wallet to a specific bounty;
  it is not a cryptographic GitHub ownership proof. GitHub and the verifier key
  are trusted. Posters can deliberately bypass oracle policy with manual release.
- **Scope/quality:** any merged target-repository branch is eligible. The reference
  does not assert actual GitHub issue closure. A locale path can contain example
  or poor-quality content. This policy cannot grade security fixes or translations.
- **Deadline/rejection:** definite mismatches on merged PRs are rejected by default.
  Before deadline the claimant may correct and resubmit; afterward the poster may
  refund. `VERIFIER_REJECT_INVALID=false` keeps these cases in manual review.
  Unmerged PRs and API failures are never grounds for rejection.
- **Liveness:** a malicious claimant can reserve work until deadline or keep funds
  locked with a timely unmerged submission. There is no abandon/expiry arbitration.
  Lost verifier access, unavailable GitHub, or an unresolved callback failure can
  leave funds pending. A generic timeout retry after an unknown transfer outcome
  would risk double payment, so it is intentionally absent.
- **Reputation:** multiple explicitly funded bounties may reward the same merged
  PR if each was created before merge and each has matching evidence. The worker now holds reused PRs across Submitted/Releasing/Released bounties, but posters can override it and the contract does not enforce global PR uniqueness. Points are neither Sybil-resistant nor a quality guarantee.
- **Operations:** run one worker replica per contract, keep keys out of the web
  process, and use the audit store only as a read model. On-chain finalized state
  remains authoritative after a restart or failed SQLite write.

Production work includes reviewed upgrade/key custody, dispute and liveness
resolution, scoped service access keys, callback gas/storage integration tests
at maximum bounds, and an external contract audit.

## Dependency audit

`npm audit --json` reported **11 low-severity findings, zero moderate/high/critical**
on 2026-11-14. These are one underlying advisory propagated through the browser
wallet dependency tree:

```text
@near-wallet-selector/core / my-near-wallet 10.1.4
  → @near-js/crypto 2.5.1 → secp256k1 5.0.1 → elliptic 6.6.1
```

[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)
describes faulty ECDSA nonce/signature handling. Under the stated conditions,
obtaining a faulty and a correct signature for the same inputs may expose a
secret key. The latest `elliptic` version is still 6.6.1 and the advisory lists no
patched release. The affected package nodes are not separate cryptographic flaws;
the audit's count includes affected dependents.

GitSettle provisions Ed25519 testnet keys and its server signer uses
`near-api-js` 7.5.3, outside this dependency path. That narrows this application's
intended use, but does not make the browser dependency advisory disappear.
No blanket claim of non-exploitability is made.

`npm audit fix --force` proposes downgrading Wallet Selector to 9.5.4, which would
break the v10 action API implemented and verified here. No forced downgrade,
unverified transitive override, or lockfile mutation was applied. Monitor the
upstream selector/crypto replacement, then update the coordinated wallet packages
and rerun connection, signing, transaction-return, production build and dependency
checks. Keep the advisory visible as an unresolved dependency review item.

## CLI and performance revision

The current Node suite has 182 passing tests, including 25 CLI cases. CLI signing requires an explicit `--yes`, a validated testnet endpoint and a protected local Ed25519 credential. A duplicate create requires a separate `--allow-duplicate` acknowledgement; failed duplicate lookups prevent signing. CLI reads and dry runs were checked against the deployed contract and hosted API without new transactions (`CLI_E2E.json`).

Display caches are bounded, exclude private routes, namespace chain/RPC/account state and invalidate after confirmed wallet actions. They do not participate in contract authorization or private appeal eligibility. A wallet chunk-loading failure cannot discard a pending action. Mismatched/unverifiable return evidence preserves the original requested action; only a matched finalized failure can clear it as failed. Browser and CLI regressions cover that boundary.
