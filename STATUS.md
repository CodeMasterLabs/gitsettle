# GitSettle checkpoint tracker

Updated: 2026-11-14. Canonical repository: https://github.com/CodeMasterLabs/gitsettle.

## Completed and verified

- **Contract:** near-sdk 5.30.2, Rust 1.97.1. All 41 unit tests, fmt, Clippy and locked Wasm build pass. Deployed artifact SHA-256: `88a9d6824ff7b09f107bf7682dea477bd1352dbdb11ab5520abd8cae56170137`. The contract is unchanged by support/AI additions.
- **Testnet:** contract `gitsettle-ac1b0f23f4.testnet`, verifier `verifier.gitsettle-ac1b0f23f4.testnet`, funded contributor account. Public deployment evidence in `docs/DEPLOYMENT.json`; private keys remain ignored mode-0600 files.
- **Publication:** public repository exists. Real issues #1–#9 and merged Spanish-guide PR #10 are published. Eight initial seed bounties plus the real-loop bounty are on-chain; `docs/SEED_ISSUES.json` and `docs/SEED_RESULTS.json` contain evidence.
- **Real end-to-end payout:** bounty **8**, issue **#9**, PR **#10** settled automatically at **2026-11-14T09:06:24Z**, using the production verifier and AgentGuard gate. Contributor balance increased by exactly **0.05 NEAR**, points by **100**, paid count by **1**, and leaderboard updated. Release: `Fe2qi4XGHsd5CvGZMdWq9Tr53MGg5WXyoce12ZnRyyCC`. Full baselines and hashes: `docs/LIVE_E2E.json`. Do not rerun preparation or create duplicate deposits.
- **GitHub API compatibility:** current API omits `merge_commit_sha`; absent/null SHA requires an independent HTTP 204 merge confirmation. Real read-only policy and real payout passed; public evidence represents SHA as null rather than inventing one.
- **AgentGuard:** pinned MIT risk rules, exact per-payout cap, held submissions stay protected, no raw PR text persisted. `docs/AGENTGUARD.md` documents local trust boundary and baseline reuse. Approved reciprocal README disclosure published to AgentGuard commit `fe8a64d`; user confirmed it is their other submitted hackathon project.
- **Community and triage:** NEP-413 wallet sessions, private support/appeal conversations, ticket ACLs/status/replies, atomic spam/duplicate limits, deterministic issue preflight, duplicate-PR holds, optional BYO-LLM advice with quotas and bounded context. No LLM key configured and no live paid AI call claimed.
- **Initial application checks:** combined Node suite passed 136 tests and TypeScript passed after the auth/AI review. Expanded Next production build passed. All 78 browser scenarios pass across desktop/mobile/dark; screenshots reviewed. Worker-scoped processing retains the full contract list for duplicate detection.
- **Live expanded deployment:** public source revision `5665b616cb0bae4a513bcb9a46727b51a5603c10` is running on the VPS. Both services healthy; HTTPS config reports testnet and AgentGuard enabled. Board shows eight Open bounties and bounty 8 Released; leaderboard shows 100 points / 0.05 NEAR earned. Optional AI reports `configured: false`.
- **Real support proof:** at 09:22 UTC, `scripts/verify-support.ts` passed against public HTTPS using actual finalized testnet FullAccess keys. It verified NEP-413 signatures, nonce replay, CSRF, session-derived identity, unrelated-wallet isolation, ticket reply/resolution and logout. No NEAR transactions sent. Evidence: `docs/COMMUNITY_E2E.json`.
- **Original containers:** clean public clone `9ca2b56` built and started on VPS using Docker Compose without credentials, with persistent SQLite and HTTPS verified. Details: `docs/DOCKER_VERIFICATION.md`. Latest live checks are recorded alongside that baseline.

## Current refinement requested by the user

The user requested a premium SaaS/PaaS design, faster loading, and a CLI after the verified initial deployment. The redesign is in `apps/web` (Manrope/Source Sans, graphite navigation, forest-green actions, structured surfaces). A real CLI is implemented under `apps/cli`, and performance changes remove repeated RPC reads and blocking GitHub metadata fetches. The VPS already uses the verified FASTNEAR RPC; new source/UI deployment follows final browser review. Combined Node suite now passes **182 tests** and typecheck passes. Live read-only CLI evidence is in `docs/CLI_E2E.json`. Do not submit a hackathon application; the user handles it manually.

## In progress / remaining

1. Build and visually review the premium redesign, including all screens and existing/new browser checks; keep the previous public deployment healthy until this passes.
2. Rebuild/publish/deploy the reviewed source; measure public loading again, rerun support proof for the new UI/runtime, and record CI/Docker evidence.
3. Publish final CLI/performance/design docs and evidence. The human owns the X post and manual application. **No hackathon submission action is authorized.**

## Deployment and credential map

- Public HTTPS: https://gitsettle.89.167.109.196.sslip.io. SSH alias: `hetzner`.
- VPS source: `/opt/gitsettle/source`; data: `/opt/gitsettle/data`; root-only runtime env: `/opt/gitsettle/env/production.env`.
- Only the dedicated verifier private key is installed in the VPS runtime environment. Deployer/contributor keys and the local GitHub CLI token are not transferred. Web receives no NEAR key or GitHub token. Optional LLM credentials belong only to web.
- Bind app port to `127.0.0.1:3000` behind Caddy. `APP_ORIGIN` equals the public HTTPS origin; `TRUST_PROXY_HEADERS=true` only with that isolation.
- Local baseline demo Docker uses port 3001. Browser QA owns port 3000 temporarily. Coordinate before starting another server or rebuilding `.next`.

## Session constraints and decisions

- Workspace began empty on November 14, 2026. User corrected inaccessible `codemaster/gitsettle` to **CodeMasterLabs/gitsettle**; never revert it.
- Every commit uses `CodeMasterLabs <344671343+CodeMasterLabs@users.noreply.github.com>`, without an AI coauthor. User authorized public GitSettle pushes, real demo issues/merge, testnet wallets/deployment and VPS setup. AgentGuard README-only disclosure was separately approved.
- Testnet only. Do not create or choose the human's mainnet prize account. Never commit secrets, signatures, cookies or private submission payloads.
- Track IDs: `social`, `open`, `agents`. Read https://nearhackathon.com/HACKATHON.md again before submission. Deadline: **2026-11-14T23:59:00Z**. AgentGuard already occupies the user's other permitted project slot; disclose both independent products and shared baseline.
- Trusted oracle, poster override, retained upgrade key, nonrefundable storage, submitted-work liveness, off-chain/nonbinding appeals, AI/provider limits and dependency advisory chain are documented honestly.

## Resuming

Read this file, `ARCHITECTURE.md`, `docs/CONTRACT_API.md`, `docs/API_SOURCES.md`, `docs/COMMUNITY.md`, `docs/TRIAGE.md` and `docs/SECURITY_REVIEW.md`. Use existing ignored `.secrets/testnet-wallets.json`, `.env.testnet` and `.secrets/live-loop.json`; never recreate funded accounts or duplicate deposits after an ambiguous outcome. Run only checks affected by new changes or unresolved issues. Fixtures are not live wallet/LLM/payout evidence; public proof files name what actually ran.
