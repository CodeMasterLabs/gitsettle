# AgentGuard integration

GitSettle uses [AgentGuard](https://github.com/CodeMasterLabs/agentguard)'s
deterministic recipient and text-risk rules as a **local check before automatic
payout**. It is enabled by default in both the verifier service and the live
end-to-end script. GitSettle's existing NEAR escrow remains responsible for
custody, access control, transfers and reputation.

The integration checks the recorded claimant against an operator denylist and
optional trusted-recipient lookalikes, scans the same raw PR body that passed
GitHub verification, and applies an additional GitSettle per-payout amount cap.
It can pause automatic settlement for inspection. It neither changes the payee
nor routes funds through another contract.

## What happens before release

1. The ordinary verifier proves the PR is merged after bounty funding, belongs
   to the right repository, references the issue, contains the claimant marker,
   and changes the expected locale path when required.
2. Finalized on-chain state must still describe that exact submission.
3. The adapter builds a native-NEAR `SpendRequest` with `recipient=near:<claimant>`
   and identical `pay_to`. Its deterministic purpose contains the bounty ID, not
   addresses. The raw GitHub PR body is supplied only as ephemeral risk context.
4. Exact pinned upstream `assess()` and `scanContext()` run locally. GitSettle
   separately checks the exact integer reward against its configured cap.
5. `allow` permits another fresh-state check and the existing `release` call.
   `review`, `deny`, missing context, or a gate error leaves the bounty
   **Submitted**. The audit message identifies the hold; no rejection/refund path
   is opened by a risk hold. A dry run also reports risk holds accurately.
6. The poster may inspect a held PR and use the existing manual release action.
   Correcting the PR text or operator policy allows a later worker scan to retry.

Raw PR bodies and upstream signal details are never written to the audit log,
SQLite read model, live-loop checkpoint or public evidence file. Only score,
signal IDs and a short decision message are retained. The live-loop serializer
explicitly allowlists public evidence fields.

## Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `AGENTGUARD_ENABLED` | `true` | `false` explicitly bypasses the local gate; audit text says it was disabled. |
| `AGENTGUARD_MAX_PAYOUT_NEAR` | `5` | Maximum amount for one automatic release, inclusive; exact decimal with up to 24 places, greater than zero and at most 1,000,000 NEAR. |
| `AGENTGUARD_DENIED_RECIPIENTS` | empty | Comma-separated NEAR accounts, optionally prefixed `near:`; normalized to lowercase. |
| `AGENTGUARD_KNOWN_RECIPIENTS` | empty | Explicit trusted accounts used for lookalike detection. Empty means that check has no trusted comparison list. |

Invalid booleans, decimal amounts or recipient settings stop service startup.
There is no floating-point currency comparison. The rule thresholds are fixed
at review score 35 and deny score 70, matching the reviewed upstream examples;
the adapter does not allow operator thresholds that would neutralize the
upstream 1000-point recipient checks. A body larger than 100,000 characters is
held rather than silently truncated.

The amount cap is **GitSettle adapter logic**. The reused upstream `assess()`
does not evaluate `amount`, `token`, `nonce`, period budgets or cumulative spend.
The cap is per payout, with no daily/hourly budget or persistent rate limiter.

## Trust and false positives

This is a local defense within the trusted verifier process. A compromised
verifier key can bypass it and call the escrow directly. The bounty poster's
manual release authority also bypasses it intentionally. The contract owner
still retains the upgrade power described in the main trust model.

GitSettle does not execute PR prose as instructions or send it to an LLM. The
concrete additional controls are recipient restrictions, lookalike warnings,
an amount ceiling, and a conservative pause when payment context looks unusual.
Heuristics can miss suspicious content and can flag legitimate work. Security
PRs discussing prompt-injection examples can trigger an instruction signal.
Bengali/RTL text with legitimate ZWJ, ZWNJ or bidi controls can also trigger
review. Only PR prose is scanned, **not translation file contents**. Those cases
need human inspection, not a claim that the contribution is invalid.

No AgentGuard vault is created or funded. GitSettle does not request an upstream
oracle signature, run an OutLayer/TEE workload, verify remote attestation, apply
on-chain AgentGuard limits, call its LLM, or perform cross-chain settlement.
Moving escrow custody through the separate AgentGuard vault would change the
current contract's transfer/callback model and requires a distinct design.

## Provenance and hackathon disclosure

Reused project: https://github.com/CodeMasterLabs/agentguard

Pinned upstream commit, dated 2026-11-11:
[`4ec34e69bc7c6cfd17a3e027bf9727a67eab97f6`](https://github.com/CodeMasterLabs/agentguard/tree/4ec34e69bc7c6cfd17a3e027bf9727a67eab97f6).

The following MIT-licensed files are copied without edits under
`vendor/agentguard/`: `oracle/src/rules.ts`, `oracle/src/injection.ts`,
`sdk/src/types.ts`, and the upstream `LICENSE`. The original copyright notice
is retained. `UPSTREAM.json` records the commit and exact SHA-256 file digests.
The type bridge is GitSettle glue; it resolves an erased SDK type import without
installing the full upstream package or any new runtime dependency.

This upstream code is **reused baseline**, disclosed under hackathon Q-005.
GitSettle's new work is its contribution escrow, GitHub evidence verification,
the bounty-to-risk adapter, local hold/retry behavior, tests and product flows.
AgentGuard is a separate project from the same developer, disclosed for Q-015;
its vault/risk-oracle product is not being claimed as newly written GitSettle
code. If both projects are submitted, each repository must name the other and
describe this distinction; the event permits at most two independent projects
per person. No second submission is made by this integration.

## Tests and upgrade procedure

```sh
npm test --workspace @gitsettle/verifier
npm run typecheck
```

The verifier suite has **64 passing tests** at this integration checkpoint.
Coverage includes ordinary real-format claimant markers, raw-context provenance,
visible/hidden instruction signals, legitimate localized-text holds, denylist
normalization, lookalikes, exact cap boundaries, explicit disable, invalid config,
gate errors, dry-run holds, post-gate state changes, absence of rejection on a
hold, public-evidence redaction and vendored-source hashes.

To update the reused code, inspect and pin a new upstream commit, replace exact
files together, retain its license, regenerate the hash manifest, review its
type/rule changes, then rerun the policy/worker/privacy tests. Do not silently
patch upstream heuristic files or claim newly added upstream features unless
GitSettle actually wires and verifies them.
