# GitSettle verifier

This is a deterministic, trusted verification agent. It reads finalized NEAR
bounties, checks GitHub REST evidence, and signs `release` or `reject_submission`
as the immutable verifier configured in the contract. The service does not merge
pull requests, hold the escrow, grade code, or call an LLM.

Before automatic payout, the default-enabled [AgentGuard local gate](../../docs/AGENTGUARD.md)
adds recipient/text-risk checks and a GitSettle per-payout cap of 5 NEAR. Review,
deny or error holds leave the submission intact for poster review; they never
turn otherwise valid work into a refundable rejection. This uses pinned local
rules, not AgentGuard vault custody or a TEE oracle.

## Run

From the repository root after `npm ci`:

```sh
npm run verifier -- --once --dry-run
npm run verifier -- --once
npm run verifier
```

`DEMO_MODE=true` keeps the worker idle and never sends transactions. Live mode
needs `DEMO_MODE=false`, `NEAR_CONTRACT_ID`, `NEAR_VERIFIER_ACCOUNT_ID`,
`NEAR_VERIFIER_PRIVATE_KEY`, `NEAR_RPC_URL`, and optionally `GITHUB_TOKEN`.
`--dry-run` can omit the private key and records proposed decisions without
changing any bounty. No private key belongs in a `NEXT_PUBLIC_*` variable.

The worker polls every 15 seconds (`VERIFIER_INTERVAL_MS`, minimum 5 seconds).
Use **one replica per contract**. Each scan is serial and timer ticks cannot
overlap. On-chain `Submitted`/`Releasing`/`Released` transitions prevent duplicate
transfers even after a process restart. Rate-limit responses pause all GitHub
work until the reset, with a minimum 60-second backoff.

## Required PR evidence

The claimant adds both lines to the PR body before the merged PR is verified:

```text
Fixes #12
GitSettle: <contract-account>/<bounty-id>/<claimant-account>
```

Substitute the actual values from the bounty detail page. Supported issue
references are `#12`, `CodeMasterLabs/gitsettle#12`, or the complete canonical GitHub
issue URL, prefixed by a GitHub closing keyword such as `Fixes` or `Closes` on a
plain body line (an unordered-list item also works). Comments, quoted text,
inline code and fenced/indented examples cannot supply the evidence or binding.

The policy checks:

1. Canonical issue and PR URLs in the bounty repository; requests go only to
   `https://api.github.com` and do not follow redirects.
2. GitHub reports the submitted PR as merged and provides a merge timestamp;
   its base repository and PR number match the bounty. If the optional audit
   commit SHA is absent, the dedicated merge endpoint must independently return
   HTTP 204, and audit evidence honestly keeps `merge_sha: null`. The merge
   cannot precede bounty funding. An older open PR may still finish funded work.
3. The body contains the exact account/contract/bounty binding and issue
   reference; the referenced resource is a real issue, not a PR.
4. A translation changes a non-removed, nonempty file for the exact locale under
   `locales`, `locale`, `i18n`, `l10n`, or `translations`. Both
   `locales/es/messages.json` and `src/i18n/es.json` are supported. Supported
   extensions: json, yaml/yml, po/pot, arb, ftl, toml, xml, properties, md/mdx,
   ts/js. Locale `es` does not match `es-MX`. Traversal and malformed paths fail.
5. Every changed-file page is present, with no duplicates. GitHub's 3000-file
   limit makes larger PRs ineligible for automatic translation verification.
6. The submission snapshot remains unchanged immediately before signing.

The service waits for final transaction execution, then checks the bounty is
`Released`. A transaction hash or successful outer receipt is insufficient: a
failed native transfer callback returns the bounty to `Submitted`, and no points
are awarded. Payout and rejection decisions are written to the shared SQLite
audit store for the UI. Repeated identical pending records are suppressed during
a worker's lifetime.

## Failure and trust boundaries

Unmerged PRs stay pending **after the bounty deadline**; the claimant submitted
in time and may wait for a maintainer to merge. Closed, unmerged PRs can be
reopened, so they also stay pending. GitHub outages, 404/auth/rate-limit errors,
malformed data, and partial file lists never reject a submission or unlock a
refund. They produce an error audit and retry. This intentionally permits funds
to remain locked when evidence cannot be resolved.

Definite evidence mismatches on a merged PR are rejected by default. The
claimant may fix the evidence and resubmit before the original deadline. Set
`VERIFIER_REJECT_INVALID=false` to require manual review instead. Rejection
after the deadline lets the poster refund; operators should review this policy
before handling funds beyond the hackathon.

The marker is a practical GitHub-to-NEAR binding, not cryptographic proof of
GitHub ownership: the PR author and authorized maintainers can edit its body.
Merges to any branch of the target repository are eligible. Closing-keyword
references to the issue are required; actual automatic issue closure by GitHub
is not asserted, because GitHub only closes issues on a default-branch merge.

GitHub responses and the verifier key are trusted. The bounty poster can also
release manually without these checks. A compromised verifier may reject honest
submissions or authorize payments to recorded claimants. Neither a matching
locale path nor a merge proves work quality or absence of bugs. No dispute
arbitration, verifier rotation, multi-replica lease, or automated quality grading
is claimed by this MVP.

The development contract account retains its full-access deployment key. Its
holder can replace the contract code; the current immutable verifier field is
not a guarantee that the account can never be upgraded. Do not use this testnet
deployment as production custody.

## Modules and verification

- `github.ts`: API transport, URL/binding/issue/locale policy and bounded pagination.
- `worker.ts`: injected chain/policy/audit ports, fresh-state check and settlement.
- `agentguard.ts`: pinned upstream risk rules plus exact GitSettle payout cap; holds preserve escrow.
- `near.ts`: pinned `near-api-js` v7 transport, finalized views and transactions.
- `index.ts`: environment, SQLite audit wiring, polling and graceful shutdown.
- `github.test.ts`, `worker.test.ts`, `agentguard.test.ts`: evidence, risk, provenance and settlement failure-path tests.

`WorkerOptions.onlyBountyIds` restricts processing for the live demonstration.
The chain adapter still lists every bounty so duplicate-PR detection sees work
already submitted or paid elsewhere. Filtering the chain list itself would hide
that evidence. Duplicate holds and AgentGuard remain off-chain safeguards; the
contract prevents repeat settlement of one bounty, while posters retain their
documented manual release authority.

```sh
npm test --workspace @gitsettle/verifier
```

The tests mock external services intentionally. A green unit suite is not proof
of a real GitHub merge or testnet payout; live evidence is recorded separately
in the root checkpoint documentation. See [API sources](../../docs/API_SOURCES.md)
for the documentation checked before implementation.
