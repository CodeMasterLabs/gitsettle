# GitSettle checkpoint tracker

Updated: 2026-11-14. Canonical repository: https://github.com/CodeMasterLabs/gitsettle.

## README and judging navigation — published

- Reworked the README around a one-minute product overview, a six-step no-wallet judge walkthrough, real payout evidence, runnable Docker/CLI quickstarts, source mapping and explicit trust limits. Added `llms.txt` with direct raw JSON evidence links for AI reviewers and a read-only presentation path in `DEMO.md`.
- Added the GitSettle mark, a genuine live-UI crop including the paid translation row, and a CodeMaster Labs sister-project visual. AgentGuard has app/video/source links and a clear explanation of its separate vault/TEE/MCP scope and the pinned MIT heuristics reused by GitSettle. GitHub About now includes a product description, live website and discovery topics.
- GitHub GFM desktop/mobile previews, Mermaid rendering, all 56 local README references, SVG/image loading and five raw evidence/index links passed review. The application runtime and its verified test counts are recorded below.

## Light-mode layout correction — deployed

- Kept the appearance toggle and fixed the short-screen sidebar overflow visible in light mode. Desktop spacing compacts below 820 px of height, shorter screens scroll within the black sidebar, and navigation links keep their size. Footer copy stacks on mobile; the queue count stays above sorting rather than wrapping into a narrow column.
- Runtime source: `5c8dc527b3d6d29f6773ff6ac402c5886083f512`, published and deployed from the clean public clone. Both services use `sha256:6739f4f6407dc3b99a1f5bdf2b7a285bcba1d2fd219f90ae5ef55e779a807bb4` with zero restarts; web is healthy. Existing environment, data, testnet contract and loopback binding were preserved.
- Production build, TypeScript and 33 relevant local browser checks passed, including a new regression for actual appearance toggling, short-screen keyboard navigation and mobile text. Independent inspection passed 72 route/theme/viewport combinations across nine sizes from 320 × 640 to 1440 × 960, both locally and on public HTTPS. Seven live routes, the mobile queue, light-mode queue captures and provider picker were verified and refreshed in `docs/screenshots/live/`.
- CI: [43619439586](https://github.com/CodeMasterLabs/gitsettle/actions/runs/43619439586) passed application, contract and clean-container jobs on this source: 182 Node, 41 Rust and 146 browser checks passed, with one intentional mobile global-search skip.

## Earlier full-viewport layout — deployed

- Removed the outer yellow canvas, page margins, maximum shell width and outer rounded corners. The application reaches all four viewport edges in both themes; mobile short pages use the full available height.
- Runtime source: `09b644a6dff716df02886a1b42cb1b63159d138c`, published and deployed from the clean public clone. Both services use image `sha256:aef4ccc04c203647e02d7e6bfae978b60ab8dd0a1ad4cdd4f9b81fb53971d18c` with zero restarts; web health passed.
- Production build and 27 existing layout/accessibility/browser checks passed. Geometry inspection passed 24 theme/page/viewport combinations at 320, 375, 940, 1180, 1440 and 2560 px. All seven public routes, the mobile queue and provider picker were checked and recaptured with no outer gaps, page overflow or runtime errors.
- CI: [43617582625](https://github.com/CodeMasterLabs/gitsettle/actions/runs/43617582625) passed all contract, application and container jobs, including the full 143-check browser suite. The performance observations below record their original source.

## Completed and verified

- **Contract:** near-sdk 5.30.2, Rust 1.97.1. All 41 unit tests, fmt, Clippy and locked Wasm build pass. Deployed artifact SHA-256: `88a9d6824ff7b09f107bf7682dea477bd1352dbdb11ab5520abd8cae56170137`. The contract is unchanged by support/AI additions.
- **Testnet:** contract `gitsettle-ac1b0f23f4.testnet`, verifier `verifier.gitsettle-ac1b0f23f4.testnet`, funded contributor account. Public deployment evidence in `docs/DEPLOYMENT.json`; private keys remain ignored mode-0600 files.
- **Publication:** public repository exists. Real issues #1–#9 and merged Spanish-guide PR #10 are published. Eight initial seed bounties plus the real-loop bounty are on-chain; `docs/SEED_ISSUES.json` and `docs/SEED_RESULTS.json` contain evidence.
- **Real end-to-end payout:** bounty **8**, issue **#9**, PR **#10** settled automatically at **2026-11-14T09:06:24Z**, using the production verifier and AgentGuard gate. Contributor balance increased by exactly **0.05 NEAR**, points by **100**, paid count by **1**, and leaderboard updated. Release: `Fe2qi4XGHsd5CvGZMdWq9Tr53MGg5WXyoce12ZnRyyCC`. Full baselines and hashes: `docs/LIVE_E2E.json`. Do not rerun preparation or create duplicate deposits.
- **GitHub API compatibility:** current API omits `merge_commit_sha`; absent/null SHA requires an independent HTTP 204 merge confirmation. Real read-only policy and real payout passed; public evidence represents SHA as null rather than inventing one.
- **AgentGuard:** pinned MIT risk rules, exact per-payout cap, held submissions stay protected, no raw PR text persisted. `docs/AGENTGUARD.md` documents local trust boundary and baseline reuse. Approved reciprocal README disclosure published to AgentGuard commit `fe8a64d`; user confirmed it is their other submitted hackathon project.
- **Community and triage:** NEP-413 wallet sessions, private support/appeal conversations, ticket ACLs/status/replies, atomic spam/duplicate limits, deterministic issue preflight, duplicate-PR holds, optional BYO-LLM advice with quotas and bounded context. No LLM key configured and no live paid AI call claimed.
- **Initial application checks:** combined Node suite passed 136 tests and TypeScript passed after the auth/AI review. Expanded Next production build passed. All 78 browser scenarios pass across desktop/mobile/dark; screenshots reviewed. Worker-scoped processing retains the full contract list for duplicate detection.
- **Initial expanded deployment:** public source revision `5665b616cb0bae4a513bcb9a46727b51a5603c10` was verified on the VPS before the premium/CLI release below. Both services healthy; HTTPS config reports testnet and AgentGuard enabled. Board shows eight Open bounties and bounty 8 Released; leaderboard shows 100 points / 0.05 NEAR earned. Optional AI reports `configured: false`.
- **Initial real support proof:** at 09:22 UTC, `scripts/verify-support.ts` passed against public HTTPS using actual finalized testnet FullAccess keys. It verified NEP-413 signatures, nonce replay, CSRF, session-derived identity, unrelated-wallet isolation, ticket reply/resolution and logout. No NEAR transactions sent. Evidence: `docs/COMMUNITY_E2E.json`.
- **Original containers:** clean public clone `9ca2b56` built and started on VPS using Docker Compose without credentials, with persistent SQLite and HTTPS verified. Details: `docs/DOCKER_VERIFICATION.md`. Latest live checks are recorded alongside that baseline.

## Earlier reference dApp / multi-wallet release

- **Design:** the supplied black/yellow dashboard composition now spans all main routes, with real escrow/category/locale summaries, global search, a default dark appearance and a saved light choice. Mobile category labels stay inside their scroll region; maintainer amounts occupy a full-width metric. All main route and wallet screenshots reviewed.
- **Wallets:** custom accessible MyNearWallet, Meteor, Intear and Nightly picker; lazy provider SDK loading, account management, Testnet identity connection without new function-call keys, pinned sandbox executors and preserved transaction recovery. Intear supports escrow only; its complete callback-bound support message is unavailable. Provider/site and fixture verification limits are in `docs/WALLETS.md`.
- **Safety fixes:** the shipped Intear executor uses its required upstream compile-time flag. Message signing locks wallet switching, rejects stale account results, and delayed HTTP authentication cannot recreate a signed-out private identity.
- **Validation:** TypeScript and production build pass; **182 Node tests** and **143 executed browser checks** pass (144 discovered, one intentional mobile global-search skip). GitHub CI passed the full suite on the published source; local full/focused runs verified the same scenarios. Local isolated Docker startup, CLI, credential isolation, source matching and executable hash checks pass. Contract/backend/CLI behavior is unchanged.
- **Runtime source:** `a63ff25c6d69733ce253da15546c22b3142150c2`, committed and pushed as CodeMasterLabs, then deployed from the clean public VPS clone. Both services use `sha256:6e2c9fc6f20b11a5469027f27789a7663817c5fbd2223b6057c9e7a56c4137d0`, with zero restarts and read-only runtime filesystems. Web is healthy at the existing HTTPS address and remains bound to loopback. Its environment has no NEAR signer or GitHub token; CLI version is `0.1.0`.
- **Live support:** actual finalized-key NEP-413 authentication, replay/CSRF/ACL checks, ticket reply/resolution and logout passed on the new deployment. Evidence: `docs/COMMUNITY_E2E.json`. No new NEAR transaction, funded account or bounty was created.
- **Live browser/performance:** all seven main routes, the 375 px queue and provider picker passed without runtime errors or page overflow. Refreshed captures are in `docs/screenshots/live/`. One fresh Chromium visit reached the first bounty row in **2.142 s**, with **15 script requests / 203,428 transferred bytes**; opening the picker loaded no signing scripts. Five-round API observations were all successful: board median **251 ms**, detail **233 ms**, leaderboard **225 ms**. These are diagnostic observations, not latency percentiles or a controlled comparison. Current and historical evidence is linked from `docs/PERFORMANCE.md`.
- **CI:** [43614903721](https://github.com/CodeMasterLabs/gitsettle/actions/runs/43614903721) passed all contract, application and container jobs on this exact source, including Rust checks, the full browser suite and Docker startup from a fresh checkout with an empty volume.

## Earlier premium workspace / CLI release — complete

- **Runtime source:** `85c4c3bab27f37d1fce19d5987d2f8913e88a42c`, committed and published as CodeMasterLabs, deployed from the public clone to the VPS. Subsequent commits contain handoff documentation/evidence only.
- **Design:** Manrope/Source Sans, graphite navigation, forest-green actions, structured queues/forms/inbox, mobile layouts, light/dark themes and CLI documentation links. Production build passed. **96/96 browser checks** pass, including connected-wallet layout at 320/375 px. All main-screen screenshots are reviewed; current public captures are in `docs/screenshots/live/`.
- **Backend/CLI:** **182/182 Node tests** and TypeScript pass. CLI has 25 focused tests, real finalized/API read proof, exact transaction previews and duplicate-create acknowledgement. No new CLI transaction was needed; `docs/CLI_E2E.json` separates live reads from fake-port signing tests.
- **Performance:** FASTNEAR is the configured testnet RPC. Public API medians: board **222 ms**, bounty detail **221 ms**, leaderboard **225 ms**, all 20 measured requests successful. Cached and first observed samples are separately recorded in `docs/PERFORMANCE_LIVE.json`. A fresh browser observation reached the first bounty row in **3.092 s**, with 16 JS requests / 199,312 transferred bytes (`docs/BROWSER_PERFORMANCE.json`); this is a single observation, not a percentile or an instant-load claim.
- **Live support:** the real HTTPS NEP-413 session, private ticket, reply/resolution, ACL, replay, CSRF and logout proof passed again on this deployment. Updated evidence: `docs/COMMUNITY_E2E.json`. No NEAR transactions sent by the support check.
- **Docker/CI:** local production image/startup and CLI execution pass. Both VPS containers are healthy, loopback-bound behind HTTPS; web credential isolation passed. GitHub run [43599590656](https://github.com/CodeMasterLabs/gitsettle/actions/runs/43599590656) passed **contract, application and clean-clone container jobs** on this exact runtime source, including the unchanged 41-test contract suite.
- **Handoff:** README, architecture, design, CLI, performance, security, Docker and demo docs are current. AgentGuard reciprocal disclosure is already public. No engineering deployment checkpoint remains for this requested release.

## Human-owned next steps

The user explicitly instructed: **“I will submit, do not submit anything to the Hackathon.”** The human owns the X post and manual application. No submission request is authorized or has been sent by this agent. Optional AI is implemented and fixture-tested, but remains disabled on the VPS until the operator supplies `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`; no paid live LLM call is claimed.

## Deployment and credential map

- Public HTTPS: https://gitsettle.89.167.109.196.sslip.io. SSH alias: `hetzner`.
- VPS source: `/opt/gitsettle/source`; data: `/opt/gitsettle/data`; root-only runtime env: `/opt/gitsettle/env/production.env`.
- Only the dedicated verifier private key is installed in the VPS runtime environment. Deployer/contributor keys and the local GitHub CLI token are not transferred. Web receives no NEAR key or GitHub token. Optional LLM credentials belong only to web.
- Bind app port to `127.0.0.1:3000` behind Caddy. `APP_ORIGIN` equals the public HTTPS origin; `TRUST_PROXY_HEADERS=true` only with that isolation.
- Local Docker demo uses port 3001. Playwright defaults to port 3000; this revision used a separate native QA server on port 3015. Coordinate before rebuilding `.next`.

## Session constraints and decisions

- Workspace began empty on November 14, 2026. User corrected inaccessible `codemaster/gitsettle` to **CodeMasterLabs/gitsettle**; never revert it.
- Every commit uses `CodeMasterLabs <344671343+CodeMasterLabs@users.noreply.github.com>`, without an AI coauthor. User authorized public GitSettle pushes, real demo issues/merge, testnet wallets/deployment and VPS setup. AgentGuard README-only disclosure was separately approved.
- Testnet only. Do not create or choose the human's mainnet prize account. Never commit secrets, signatures, cookies or private submission payloads.
- Track IDs: `social`, `open`, `agents`. Read https://nearhackathon.com/HACKATHON.md again before submission. Deadline: **2026-11-14T23:59:00Z**. AgentGuard already occupies the user's other permitted project slot; disclose both independent products and shared baseline.
- Trusted oracle, poster override, retained upgrade key, nonrefundable storage, submitted-work liveness, off-chain/nonbinding appeals, AI/provider limits and dependency advisory chain are documented honestly.

## Resuming

Read this file, `ARCHITECTURE.md`, `docs/CONTRACT_API.md`, `docs/API_SOURCES.md`, `docs/COMMUNITY.md`, `docs/TRIAGE.md` and `docs/SECURITY_REVIEW.md`. Use existing ignored `.secrets/testnet-wallets.json`, `.env.testnet` and `.secrets/live-loop.json`; never recreate funded accounts or duplicate deposits after an ambiguous outcome. Run only checks affected by new changes or unresolved issues. Fixtures are not live wallet/LLM/payout evidence; public proof files name what actually ran.
