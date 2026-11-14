# GitSettle demo and submission handoff

## Browse and present without spending

The [README judge walkthrough](README.md#judge-walkthrough) is the fastest way to explore the product: live queue → paid bounty 8 → real issue/merged PR → release receipt → contributor profile. It takes about four minutes, requires no wallet, and shows the existing completed payout rather than creating another bounty. [llms.txt](llms.txt) maps the same claims to source files, public JSON and verification evidence for AI reviewers.

For a short recording, open the paid bounty, PR and transaction in separate tabs, show the **0.05 NEAR / 100 points** result, then demonstrate live queue filters and the local Docker fallback. Introduce [AgentGuard](https://github.com/CodeMasterLabs/agentguard) as CodeMaster Labs' sister hackathon project for AI-agent spending controls. Explain that GitSettle reuses its pinned MIT recipient/text checks locally; AgentGuard's vault, TEE and MCP are a separate product. [AgentGuard's published 1:56 demo](https://agentguard-beryl.vercel.app/agentguard-demo.mp4) is available for that project's walkthrough.

## Recorded live proof

Public app: https://gitsettle.89.167.109.196.sslip.io. On November 14, 2026 at 09:06 UTC, bounty **8** settled through the production verifier with AgentGuard enabled:

- Issue [#9](https://github.com/CodeMasterLabs/gitsettle/issues/9), merged Spanish guide [PR #10](https://github.com/CodeMasterLabs/gitsettle/pull/10), file `locales/es/contributing.md`.
- [Release transaction](https://testnet.nearblocks.io/txns/Fe2qi4XGHsd5CvGZMdWq9Tr53MGg5WXyoce12ZnRyyCC): **0.05 NEAR** exact contributor balance increase, **100 points**, one paid contribution, leaderboard updated.
- Full transaction hashes, balance/profile baselines and final values: [docs/LIVE_E2E.json](docs/LIVE_E2E.json). During the recorded payout, the PR response requested with GitHub REST version `2026-03-10` omitted the merge SHA. The verifier independently confirmed merge with HTTP 204; historical evidence preserves that observed null even though the default API response can return the same PR's merge SHA.

The existing bounty is already paid. For a new live recording, create a fresh issue/bounty/PR with a separate script journal; do not replay the paid bounty or describe a recorded result as a new payment. A walkthrough can show the recorded issue, PR, on-chain transaction and final profile without spending more tokens.

## 60–90 second video script

Record the live testnet deployment, not the labeled local demo. Use a pre-funded
bounty and a prepared small PR so the visible sequence fits in 90 seconds. Keep
private keys, shell history and environment files out of the recording.

| Time | Action | Narration |
| --- | --- | --- |
| 0–12s | Open the work queue; filter Translation and show the `es` badge. | “Open-source work needs a clear scope and a reliable reward. GitSettle puts the issue, locale and NEAR escrow in one work queue.” |
| 12–25s | Open the bounty; show reward, storage charge and on-chain state. | “A maintainer has funded this issue on NEAR testnet. The reward stays in escrow until an authorized payout. The storage charge is separate.” |
| 25–40s | Claim with the contributor wallet and submit the prepared PR URL. | “The contributor claims the work and submits a pull request. Its body references the issue and names the exact bounty and recipient account.” |
| 40–58s | Show the actual PR, locale file and merged badge. | “The verifier checks the merge, repository, issue reference, recipient marker and Spanish locale path. This is a trusted oracle; it does not judge translation quality.” |
| 58–75s | Return to the bounty as it becomes Released; open transaction and profile. | “The worker signs the release. NEAR transfers the reward, and only a successful transfer callback adds points and earnings.” |
| 75–90s | Show leaderboard and repository setup command. | “Duplicate and spam checks help triage new work. Wallet-authenticated support handles appeals; optional AI gives advice. Anyone can self-host with Docker.” |

The maintainer can also release a submitted bounty directly. Mention this if
showing that action; do not present a manual release as automatic verification.
If the worker is delayed by GitHub/RPC, leave the waiting state visible and cut to
the recorded finalized result with a clear time transition rather than faking it.

## Reproduce the actual GitHub-to-NEAR loop

Use the testnet wallet file created by `npm run wallets`, or configure the poster,
contributor and verifier environment variables. Supply a **real issue** in
`CodeMasterLabs/gitsettle`. The script validates that it is an issue, not a PR.

```sh
LIVE_ISSUE_URL=https://github.com/CodeMasterLabs/gitsettle/issues/ISSUE_NUMBER \
LIVE_BOUNTY_TYPE=Translation LIVE_TARGET_LOCALE=es \
npx tsx scripts/live-loop.ts --prepare
```

Preparation creates a 0.05 NEAR bounty, claims it, and prints the exact PR marker.
Create a real PR adding a useful Spanish locale file. Put the printed marker and
`Fixes #ISSUE_NUMBER` on separate plain lines in its body, and merge it **after**
the bounty has been created. Then:

```sh
LIVE_PR_URL=https://github.com/CodeMasterLabs/gitsettle/pull/PR_NUMBER \
npx tsx scripts/live-loop.ts --settle
```

The settlement phase runs the production policy against GitHub, submits the PR,
executes the verifier, checks the finalized bounty, balance delta, points, merged
count, earned total and leaderboard, then writes `docs/LIVE_E2E.json`. Check the
script's `--help` for the exact configuration. It keeps a private local checkpoint
so a retry does not blindly fund another bounty. Do not delete that checkpoint
after an ambiguous broadcast; inspect the chain first.

## X post draft

> Open-source work deserves a clear reward. Built GitSettle at NEAR HACKATHON: fund GitHub issues in NEAR, verify merged PRs, and pay contributors—including translators.
>
> @NEARProtocol #NEARHackathon
> https://github.com/CodeMasterLabs/gitsettle
>
> What would you fund?

Attach the 60–90 second demo video. The human publishes this post. If needed,
shorten the prose to fit the account's X character limit; keep the event mention,
`@NEARProtocol`, `#NEARHackathon`, repository link and video.

## Final submission checklist

**The user will submit manually and instructed the agent not to submit anything to the hackathon.** The following is a human handoff, not authorization for an API request.

Read https://nearhackathon.com/HACKATHON.md again immediately before submission.
Deadline: **2026-11-14T23:59:00Z**. Submit once only; do not retry a 403 or make a
second project link to bypass a 409. Reuse the same generated requestId for
network/503 retries. Do not commit the submission payload or personal data.

Confirmed project identity: GitSettle. Repository selected by the user:
https://github.com/CodeMasterLabs/gitsettle. Proposed track IDs:
`["social", "open", "agents"]` (the deterministic verification/payout agent ships). AgentGuard is the same developer’s already-submitted independent project; both READMEs disclose the relationship and reused baseline.

The human must provide lead name, contact email, team size, their mainnet prize
account, and the public X demo URL. The human creates/selects the prize account;
the supplied tooling only creates testnet development wallets. Confirm that GitSettle itself has not already been submitted. The user confirmed AgentGuard is their other submitted project; the two-project limit is therefore material, and no third project should be submitted under the same person.

Read this consent notice verbatim and record an affirmative answer:

> I agree that the organizers may use these details to review our submission and contact us about this hackathon.

Proposed project description for human review:

> GitSettle is a self-hosted escrow platform for GitHub bug fixes, features,
> audits and translations. Maintainers deposit native NEAR into a bounty;
> contributors claim an issue and submit a pull request. A deterministic verifier
> checks the real GitHub merge, repository, issue reference, contributor-account
> marker and requested locale path before releasing the reward. The NEAR contract
> controls escrow, authorized refunds, transfer recovery and contribution points.
> AgentGuard rules check recipients, PR text and payout size before automatic release.
> Duplicate/spam checks, signed-wallet appeals/support and optional bring-your-own-LLM
> triage help participants; AI never authorizes escrow. A Next.js dashboard, wallet
> signing, SQLite history and Docker deployment make the system reproducible. The trusted-oracle and upgrade-key limits are
> documented, and live testnet evidence accompanies the public repository.

Build the exact API JSON only from confirmed values, print it for review, and
wait for the human's explicit yes before sending it. If a saved submission needs
correction, the human uses https://nearhackathon.com/request-changes.
