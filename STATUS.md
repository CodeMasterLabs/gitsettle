# GitSettle checkpoint tracker

Updated: 2026-11-14. Intended repository: https://github.com/codemaster/gitsettle.

## Build order

1. **In progress: contract.** Verify official SDK, implement bounded escrow state and asynchronous transfer recovery, pass Rust unit tests, build Wasm, deploy to testnet.
2. **Pending: verifier.** Verify merged GitHub PR, target repo, exact issue reference, claimant wallet marker and locale paths; exercise payout and rejection paths.
3. **Pending: web.** Work queue, detail, post, claim/submit, profiles, leaderboard, dashboard; SQLite persistence and wallet signing.
4. **Pending: seed.** Realistic local fixtures plus explicit testnet seed command, clearly distinguished.
5. **Pending: delivery.** Docker clean-clone check, screenshots, end-to-end evidence, architecture and demo docs.

## External dependencies

- The workspace started empty. No earlier product or baseline code was supplied.
- GitHub connector is authenticated as `tonymarma`; shell GitHub is authenticated as `CodeMasterLabs`. Neither proves access to `codemaster/gitsettle`; repository lookup returned 404. Do not silently substitute a repository owner.
- User authorized testnet wallet provisioning and VPS setup. VPS SSH host/domain are pending.
- No NEAR credentials were initially present. Generate development wallets in ignored files, never commit keys. Never create a mainnet prize account on the user's behalf.
- Read current https://nearhackathon.com/HACKATHON.md before submission. Deadline: 2026-11-14T23:59:00Z. Track IDs: `social`, `open`; add `agents` only if the verifier agent ships.
- Publication/push and exact final submission payload require the human's explicit confirmation under the hackathon rules. Draft everything first. Human publishes the X demo and supplies personal fields/consent.

## Resuming

Read this file, `ARCHITECTURE.md`, `docs/CONTRACT_API.md`, and `docs/API_SOURCES.md`. Run the documented checks. Treat a checkpoint as complete only when its recorded evidence exists. Local fixtures and mocked API tests are not a live testnet proof.
