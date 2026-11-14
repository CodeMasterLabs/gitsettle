# Final GitHub, claims and live verification

Verified **November 14, 2026**. The documented GitSettle testnet capabilities are supported by implementation, fresh CI, existing transaction receipts and live browser checks. No material claim mismatch or functional blocker was found in the reviewed scope. This is functional verification of an unaudited MVP, not a guarantee of every external provider or future condition.

[Machine-readable results](FINAL_VERIFICATION.json) · [Fresh CI](https://github.com/CodeMasterLabs/gitsettle/actions/runs/43627688560) · [Original payout evidence](LIVE_E2E.json) · [Trust model](../README.md#trust-model-and-limitations)

## Source and reproducibility

| Item | Verified value |
| --- | --- |
| Public repository | [CodeMasterLabs/gitsettle](https://github.com/CodeMasterLabs/gitsettle), public, default branch `main`; About description, homepage and 14 topics checked |
| Audited GitHub/CI source | `5b3b1146d13c63d78db10f03d5a7619edb0fbc74` |
| Deployed application source | `5c8dc527b3d6d29f6773ff6ac402c5886083f512` |
| Runtime image | `sha256:6739f4f6407dc3b99a1f5bdf2b7a285bcba1d2fd219f90ae5ef55e779a807bb4` |
| Deployed/local/published Wasm SHA-256 | `88a9d6824ff7b09f107bf7682dea477bd1352dbdb11ab5520abd8cae56170137` |

The audited GitHub commit differs from deployed source only in documentation, visuals and screenshots. Application, contract, dependencies, build and deployment code are identical. Five important runtime files also hash-match the deployed checkout. This report and its documentation corrections do not change that runtime.

Fresh CI ran on the exact audited commit. All three jobs passed: **41 Rust tests**, **182 Node tests**, **146 browser tests passed and one intentional skip**. The global-search scenario is intentionally skipped on mobile because the mobile queue has its own visible search input. TypeScript, production build, Rust formatting/Clippy, locked Wasm build and clean-checkout Docker startup with an empty volume passed. Browser and wallet/AI fixtures remain distinct from live approvals and payments.

## Claims and evidence

| Claim | Verification | Result and limit |
| --- | --- | --- |
| GitHub work can settle a native NEAR reward | Re-read [PR #10](https://github.com/CodeMasterLabs/gitsettle/pull/10), issue #9, exact claimant/issue markers and changed `locales/es/contributing.md`; inspected finalized release receipts | Existing bounty **8** is Released. The recorded transfer of **0.05 NEAR** succeeded to the claimant and the callback returned true. No new payout was sent. |
| Reputation follows successful payment | Finalized CLI profile/leaderboard reads; contract callback implementation and tests | Contributor has **100 points**, **one paid contribution**, **0.05 NEAR earned**. Historical pre-payment balance baselines stay in `LIVE_E2E.json`. |
| Escrow enforces claim, submission, release and refund authority | Contract source and 41 fresh tests, separately matched deployed Wasm | Exact reward/storage validation, authorized settlement, private callbacks and failed-transfer recovery supported. The poster and fixed verifier remain trusted authorities. |
| Automatic GitHub verification checks contribution evidence | Verifier source, regression tests and actual merged PR | Merge after funding, correct repository/issue/claimant, exact locale paths, complete pagination and duplicate-PR holds supported. Checks do not establish code quality, translation accuracy or cryptographic GitHub identity. |
| AgentGuard provides a local risk gate | Compared pinned upstream files/hashes, adapter and worker behavior | Reused MIT recipient/text heuristics and GitSettle's default **5 NEAR per-payout** cap supported. Holds preserve Submitted escrow. AgentGuard vaults, TEE, MCP and daily budgets belong to the separate sister project. |
| Public browser journeys and both appearances work | Fresh Chromium against public HTTPS: **42 route/theme/viewport checks**, plus **11 interaction checks** | All seven routes passed; no outer gaps, horizontal overflow or runtime errors. Filters, category/translation shortcuts, sorting, global/mobile search, empty recovery, picker opening/Escape and final signed-out support/AI states passed. |
| Four wallet providers are offered | Actual live desktop/mobile picker, images and adapter/capability source | MyNearWallet, Meteor Wallet, Intear Wallet and Nightly visible. No provider selected or account approved during this audit. Intear's adapter supports escrow but cannot authenticate private support. |
| Private support uses wallet ownership and access controls | Community implementation, fresh adversarial tests and separately recorded [real HTTP proof](COMMUNITY_E2E.json) | NEP-413 finalized-key checks, replay/CSRF protections, participant ACLs and logout supported. This audit did not repeat authentication or write tickets. Support is operator-readable; appeals are nonbinding. |
| AI is optional and advisory | Source/configuration guards, provider fixtures and final live support view | Hosted AI is **disabled**. AI has no payment authority; no live paid model call verified or claimed. |
| CLI and self-hosting are usable | Fresh finalized CLI reads and CI clean-container job; read-only VPS inspection | CLI show/profile/leaderboard succeeded without credentials. Both live services run with zero restarts; web healthy; UID 1000, read-only filesystems, dropped capabilities and credential isolation preserved. Verifier has no separate Docker healthcheck. |
| README and AI judging links are usable | Original onboarding audit: 45 local targets, seven published anchors, three images; published byte/JSON checks and external probes | No broken documented repository/live-app target found. AgentGuard source/app/video/index and both referenced anchors passed. Nearblocks imposed Cloudflare challenges; chain receipts were checked directly through finalized RPC. The documented `llms.txt` is in the repository/raw GitHub, not hosted at the app's `/llms.txt`. |
| Reuse and licensing are disclosed | Root license, AgentGuard provenance/hashes, wallet source/version/license disclosures | GitSettle application MIT; separately reused wallet executors retain upstream licenses and corresponding-source references. Reused code is not presented as newly authored GitSettle work. |

Live browser combinations: 1440 × 960 dark/light, 375 × 812 dark, 320 × 640 light, 1280 × 720 light and 1024 × 600 light. Each visited queue, settled bounty, posting, leaderboard, contributor, dashboard and support. Short desktop sidebar resources remained reachable by keyboard; footer content remained contained. Additional support checks waited for session/config loading to finish at 1024 × 600 and 320 × 640. Representative captures were visually inspected.

## Corrections made

- Corrected [AgentGuard adapter documentation](AGENTGUARD.md): `recipient=near:<claimant>` and `pay_to=<claimant>` refer to the same account but have different string formats. Runtime behavior was already correct.
- Clarified [GitHub API evidence](API_SOURCES.md): the configured `X-GitHub-Api-Version: 2026-03-10` response omits `merge_commit_sha`; default `gh api` returns `84610be07ae5056a5410272a33b13d8d39a9e3b4` for the same merged PR. Both report `2026-11-14T08:23:02Z`. The recorded payout independently confirmed merge with HTTP 204; its historical null SHA is preserved.
- Linked this fresh report and CI from README, `llms.txt` and the checkpoint tracker.

## Remaining limits

- `npm audit` still reports **12 low-severity findings**, **zero moderate/high/critical**, propagating the documented wallet dependency advisory [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84). Standalone wallet executors are not fully covered by npm audit. See [security review](SECURITY_REVIEW.md).
- Full interactive approval/signing across all external wallets remains unverified. Prior Meteor login was Cloudflare-blocked; provider fixture tests do not prove real approvals. See [wallet verification limits](WALLETS.md).
- The verifier/poster can bypass the local risk gate; the deployment retains an upgrade key. Submitted work can remain locked indefinitely. Reputation is not Sybil resistant. No mainnet, quality-guarantee, trustless-oracle or TEE-custody capability is claimed for GitSettle.
- RPC/GitHub/provider availability, rate limits and GitHub's 3,000-file cap can prevent automatic verification. The initial deployment assumes one verifier process and SQLite on one host.

This audit sent **zero NEAR transactions**, created no accounts/bounties/tickets, requested no wallet signatures, changed no production configuration and made no hackathon submission or X post. Existing public support/payment evidence was preserved. The project owner's submitted fields and X permalink were not supplied, so the external submission itself was not verified.
