# GitSettle checkpoint tracker

Updated: 2026-11-14. Canonical repository: https://github.com/CodeMasterLabs/gitsettle.

## Completed and verified

- **Contract:** near-sdk 5.30.2, Rust 1.97.1. All 41 unit tests pass; formatting, Clippy and locked release Wasm build pass. Source rebuild SHA-256 matches deployed artifact: `88a9d6824ff7b09f107bf7682dea477bd1352dbdb11ab5520abd8cae56170137`.
- **Testnet deployment:** `gitsettle-ac1b0f23f4.testnet`, atomically initialized with `verifier.gitsettle-ac1b0f23f4.testnet`. Funded contributor subaccount exists. Public receipt and config in `docs/DEPLOYMENT.json`; keys are ignored, mode-0600 files only.
- **Verifier:** 44 tests pass for GitHub evidence, locale pagination, issue/account binding, rate limits, stale work, and callback recovery. Testnet read-only startup/config check passes. The complete root Node suite has 49 passing tests, including currency and transaction confirmation.
- **Web:** all requested screens and wallet flows implemented; Next.js production build and TypeScript pass without warnings. Runtime config is allowlisted, and wallet-return hashes are verified before confirmation.
- **Containers:** Docker build, empty-volume demo startup, both services running, web health and credential isolation verified locally on port 3001. Native SQLite compilation dependencies included only in the build stage.
- **VPS preparation:** Docker and Caddy installed on authorized SSH alias `hetzner`. HTTPS certificate and redirect verified for `https://gitsettle.89.167.109.196.sslip.io`; app deployment pending publication/clean clone.
- **Handoff:** README, architecture guide, contract/API/design/security notes, demo script and X draft are written. Final live evidence and actual browser counts still to be appended.

## In progress / remaining

1. Finish final 45-check browser/visual review on desktop, mobile and dark theme. Preliminary screen checks pass; a skip-link focus issue and spacing fixes are implemented. `docs/UI_REVIEW.md` owns final evidence.
2. Publish the reviewed commits to public `CodeMasterLabs/gitsettle` after explicit permission required by the hackathon rules. User changed the original `codemaster` identity to `CodeMasterLabs` and requested GitHub-only commit identity; all commits use `CodeMasterLabs <344671343+CodeMasterLabs@users.noreply.github.com>`.
3. Create actual demo GitHub issues, write `docs/SEED_ISSUES.json`, run the idempotent seed script, and record real testnet transactions.
4. Run the two-phase real PR loop in `scripts/live-loop.ts`: prepare bounty/claim, merge a real translation PR, submit it, run the production oracle and prove exact payout/profile/leaderboard changes in `docs/LIVE_E2E.json`.
5. Clone the public repository on the fresh VPS, verify default Docker startup, then apply the separately stored live environment and test the public HTTPS app. Never copy deployer/contributor keys into the web container.
6. Human records/publishes X video and provides final team/contact/prize account fields and consent. Final submission requires review of the exact payload. No submission has been sent by this agent.

## Session constraints and decisions

- Workspace started empty on November 14, 2026. No earlier product or baseline code was supplied.
- Original requested repo `codemaster/gitsettle` was inaccessible. User explicitly selected `CodeMasterLabs/gitsettle` instead; do not revert that correction.
- User authorized testnet wallet provisioning and VPS setup. User selected SSH alias `hetzner`. An automatic HTTPS hostname is used because no custom domain was supplied.
- Commit as the GitHub account only. Never commit secrets or private keys. Local `.env.testnet` and `.secrets/` are ignored; GitHub authentication tokens must not enter images or logs.
- Track IDs: `social`, `open`, `agents` for the shipped deterministic verification/payout worker. Read live https://nearhackathon.com/HACKATHON.md before submitting. Deadline: 2026-11-14T23:59:00Z.
- Hackathon rules require explicit permission for publication/push and the final submission payload. Human publishes X and selects the mainnet prize account; generated wallets are testnet only.
- Trusted oracle, poster override, retained contract upgrade key, nonrefundable storage, permanent submitted-work liveness limits, and one low-severity dependency advisory chain are documented honestly.

## Resuming

Read this file, `ARCHITECTURE.md`, `docs/CONTRACT_API.md`, `docs/API_SOURCES.md`, and `docs/SECURITY_REVIEW.md`. Run only the checks affected by new changes or unresolved issues. Use existing ignored wallet/live-loop checkpoints; never recreate funded accounts or duplicate deposits after an ambiguous transaction. Local fixtures and mocked API/browser tests are not a live merge/payout proof.
