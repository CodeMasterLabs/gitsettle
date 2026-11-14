# Security review checkpoint

Reviewed on 2026-11-14. This is an implementation review and regression-test
checkpoint, not an independent audit or a claim of production readiness.

Scope: `contracts/gitsettle/src/lib.rs`, the contract transition tests, and
`services/verifier`. The deployed contract was read but **not changed** during
this review. Deployment identity and Wasm digest are in `DEPLOYMENT.json`.

## Findings fixed in the verifier

| Finding | Resolution and regression coverage |
| --- | --- |
| An already-merged historical PR could be rebound by editing its body after funding. | Automatic release requires `merged_at >= bounty.created_at`. A PR opened before the bounty remains eligible if merged after funding. |
| Evidence in hidden comments, examples or quoted text could count as an intentional issue reference/account binding. | The documented plain body lines must be visible. Comments, fenced/indented code, inline code and blockquotes are excluded; closing-keyword references start their own line or list item. |
| Malformed changed-file status and path components were too permissive. | Unknown statuses fail as operational errors; removed/unchanged files cannot qualify; URL `.`/`..` segments are rejected. Exact locale boundaries and full pagination already had regression coverage. |
| A `.testnet` account suffix alone did not verify the configured network. | Service startup checks RPC `chain_id === "testnet"` before checking the configured verifier or signing. |

The verifier suite now has **44 passing tests**, including nested cases. Root
TypeScript checking also passed after these changes. The suite covers canonical
URL/host/number boundaries, other-repository references, claimant/contract/bounty
binding, unmerged PRs beyond deadline, malformed/rate-limited API responses,
locale paths, complete pagination/3000-file cap, stale submissions, overlapping
scans, dry runs, failed transfer callbacks and retries. External services are
mocked by these tests; live transaction proof belongs in `LIVE_E2E.json` only
after the real loop passes.

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
  PR if each was created before merge and each has matching evidence. Points are
  neither Sybil-resistant nor a quality guarantee. No global PR uniqueness is claimed.
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
