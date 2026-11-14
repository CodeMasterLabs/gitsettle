# GitSettle design system

Status: premium workspace revision reviewed on November 14, 2026. The `frontend-design` skill at `/home/ubuntu/.codex/skills/frontend-design/SKILL.md` was applied before implementation and during screenshot review. This document records the current shared UI contract.

## Product and visual idea

GitSettle is a workspace for maintainers, developers, and translators to fund and deliver specific GitHub issues. The premium revision gives that workflow a structured application shell: a graphite navigation rail, crisp breadcrumb and account controls, a continuous escrow summary, and a dense queue with useful quick views. Every summary value comes from the displayed data; example balances are explicitly labeled in demo mode.

The queue is the central visual element. Type-specific icons, visible locale badges, concise issue titles, aligned NEAR amounts, and clear lifecycle labels let contributors compare work without opening each issue. The rest of the interface supports that task with consistent spacing, quiet borders, restrained shadows, and forest-green actions. All exposed controls perform a real operation or link to a real destination.

## Tokens

### Color

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| Canvas | `#F5F7F9` | `#111917` | Neutral application background |
| Surface | `#FFFFFF` | `#19231F` | Work queues, forms, and escrow panels |
| Soft surface | `#F0F4F2` | `#22312A` | Table headers and quiet information panels |
| Ink | `#15251B` | `#EFF5F0` | Primary text |
| Muted ink | `#65716A` | `#B0BDB5` | Supporting copy and metadata |
| Forest | `#006400` | `#94D3A4` | Links, focus, selected controls, affirmative text |

The sidebar retains `#101D17` in both appearances, with `#BDCBC2` navigation labels and `#213C2C` selected backgrounds. The primary button retains `#006400` and white text in both themes. Light borders use `#DDE4DF`; dark borders use `#35433B`. Warning text uses `#804112` on `#FAECD7`; error text uses `#9D2D27` on `#FAE9E7`. The corresponding dark text uses `#F0C48C` and `#F4A29B`. Text and icons carry state meaning independently of color.

### Typography

- **Manrope 600/700:** page titles, navigation, compact actions, issue titles, financial values, and rankings. Headings are purposeful and compact: 34 px desktop / 28 px mobile, with 32 px detailed issue titles where needed.
- **Source Sans 3 400/600:** body copy, supporting information, form values, and long support conversations. Body copy is 15 px with 1.55 line height. Both fonts are bundled locally, avoiding a font CDN dependency.
- Supporting and functional labels are at least **12 px** in every viewport; mobile navigation scrolls inside its own region instead of shrinking text. Issue titles use 13 px desktop / 12 px mobile with generous line height.
- Use `font-variant-numeric: tabular-nums` for NEAR amounts, points, ranks, issue numbers, and dates. Exact review amounts preserve every yoctoNEAR digit and wrap when necessary.
- Left align prose and headings. Right align financial values in comparative tables. Use monospace only for code or copyable account-verification markers.

### Space, shape, and motion

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px, with intermediate values only for compact data alignment. Desktop content padding is 40 px, mobile padding is 16–20 px.
- Desktop shell: 244 px sidebar, reduced to 222 px at narrower desktop widths. Main content has a 1488 px maximum. At 940 px and below, navigation becomes a contained horizontal row above the workspace.
- Main work surfaces use **12 px radii** and a restrained two-part shadow; controls use **8 px**; status pills use a full radius. Small locale badges remain compact rounded rectangles. No gradients, glass panels, decorative blobs, or identical card grids.
- Primary buttons and mobile navigation/theme controls are at least 44 px high. Detail section links also have a 44 px hit area. Focus has a visible 3 px ring with a 3 px offset.
- The detail page has a sticky escrow action panel and real section links. Mobile moves escrow above the detail copy so the reward and next action are immediately reachable.
- Motion is limited to pending transactions and factual leaderboard rank changes. No entry animations or invented activity. Respect `prefers-reduced-motion`.
- Lucide is the only icon family. Decorative icons use `aria-hidden`; actions retain visible text and accessible names.

## Layout exploration and review

The initial journal-like presentation was revised after feedback requested a more polished SaaS workspace. Two arrangements were considered: a horizontal global navigation with a broad dashboard, and a persistent rail with a queue-first workspace. The rail was retained because contribution, funding, and support workflows need predictable navigation even on long pages. The revised design concentrates summary information into one continuous strip instead of repeating cards.

```text
+----------------------+---------------------------------------------------+
| GitSettle            | Workspace / Work queue     Network  Theme  Wallet |
| Community workspace  +---------------------------------------------------+
|                      | Work queue                          Post a bounty |
| Work queue           | Reward held in escrow until merge                 |
| Leaderboard          |                                                   |
| My contributions     | Example rewards    Open work   In review  Locales |
| Maintainer desk      |                                                   |
| Support & appeals    | All work   Open to claim   Translations           |
|                      | Search                 Type   Status   Min reward |
|                      | Issue / repository          Type    Reward  State |
| Escrow explanation   | Translate wallet flow       es     18 NEAR  Open  |
| View source          | Fix stale reward display    Bug    12 NEAR  Open  |
| Command line         |                                                   |
+----------------------+---------------------------------------------------+
```

The product's identity comes from real GitHub work and settlement data: explicit locale scope, exact financial values, transparent verification routing, and clear next actions. The interface avoids decorative charts and fabricated activity. Workspace breadcrumbs, navigation, quick views, filters, conversation search, and CLI links are functional.

At mobile widths the queue becomes issue-first rows with reward, type, locale, deadline, and status still visible. Comparative leaderboard columns use a labeled, keyboard-focusable horizontal scroll region. The page itself must never overflow. The small-screen footer exposes the same CLI and settlement-rule resources as the desktop sidebar.

## Loading and perceived speed

The work-queue title and creation action render immediately, followed by dimensionally stable loading skeletons. Public data can remain visible during background refresh; returning to a recently visited public page uses the short navigation cache. Private support data is never placed in this public cache. Wallet selector code loads when connection is needed, while transaction recovery remains available independently. The UI shows a real loading state instead of hiding its shell behind a wallet SDK or chain request.

## Screens and actions

| Screen | Primary content | Primary action | Required secondary content |
| --- | --- | --- | --- |
| Work queue `/` | Searchable, filterable bounty rows | Post a bounty / open an issue | Type, locale, status, min reward; count of matching results; demo/live disclosure |
| Bounty `/bounties/[id]` | Issue title, repo, description, locale scope | Claim, submit PR, release, or refund as state/account allows | Escrow amount, deadline, poster/claimant, PR link, timeline, trusted verifier notice |
| Post `/bounties/new` | Repository, issue URL, type, reward, deadline | Review and fund escrow | Translation locale selector, storage fee, wallet network, exact amount to sign |
| Submit, within detail | PR URL and proof instructions | Submit PR for verification | Author/account marker, issue reference, expected locale path; validation errors |
| Contributor `/contributors/[account]` | Account's settled rewards and contributions | Open contribution | Points, merged count, total earned, rank if available |
| Leaderboard `/leaderboard` | Ranked contributor rows | Open contributor | Points, merges, earnings, change since saved snapshot; no invented rank movement |
| Maintainer `/dashboard` | Posted bounties grouped or filtered by lifecycle | Review a submission / post bounty | Funds held, submitted PRs, deadline/refund eligibility, account scoping |

The post flow has two meaningful steps: enter work details, then review the escrow transaction. Preserve the draft on wallet cancellation. Display the reward and any storage funding separately, and show the full required deposit before signing. Never ask the user to type a private key into a web form.

## Complete state matrix

| State | Treatment and copy | Recovery/action |
| --- | --- | --- |
| Initial load | Stable title plus skeleton lines matching queue/form dimensions; `aria-busy` | No fake amounts or artificial progress percentage |
| Empty queue | “No bounties match these filters.” | Clear filters; post a bounty |
| Empty account | “No contributions yet.” or “You haven't posted a bounty yet.” | Open queue or post bounty |
| Fetch error | Visible inline error: “The bounty queue could not be loaded.” | Retry; preserve filters |
| Wallet disconnected | Quiet explicit banner: “Connect your NEAR wallet to claim work or fund a bounty.” | Connect wallet; browsing remains available |
| Demo mode | Persistent honest notice: “Demo data. These rewards are examples, not funded escrows.” | Explain how to configure a deployed testnet contract; mutations disabled |
| Wrong/missing configuration | “Testnet escrow is not configured on this instance.” | Link setup instructions; do not offer a signing button |
| Expired, no submission | “Deadline passed.” Show refund eligibility only to the poster | Refund if contract permits |
| Submitted after deadline | Explain that an existing submitted PR remains under verification | Show PR, verification result; do not promise automatic refund |
| Transaction pending | `role=status`, descriptive text, progress strip, disable duplicate action | Keep page usable; do not imply wallet signing is a confirmed transaction |
| Transaction confirmed | Explicit confirmation plus transaction explorer link | Refresh on-chain state; action changes with lifecycle |
| Transaction failed/cancelled | `role=alert`, readable reason, preserve entered data | Retry when appropriate; never silently repeat a signing action |
| Verification deferred | “Waiting for the pull request to merge.” or exact unmet check | Open PR / fix reference or locale change |
| Verification error | “GitHub could not be checked. Verification will retry.” | Link source PR; separate provider errors from invalid work |
| Settled | “Reward paid to [account].” Show final amount and credited points | Open transaction or contributor |
| No previous rank | Em dash with accessible “No previous snapshot” | Never manufacture an up/down movement |

All inputs have visible labels. Per-field errors associate through `aria-describedby`; validation summary receives focus after an invalid submit. Active navigation exposes `aria-current`. Statuses include readable text; color and icons are supplementary. Global errors use a page error boundary with retry.

## Review checklist and evidence

Before completion, capture desktop and mobile screenshots of the queue, detail, post, contributor, leaderboard, and maintainer screens. Capture dark mode and at least one error/empty/transaction state. Check that no horizontal page overflow appears at 375 px; text wrapping does not hide amounts or actions; keyboard focus reaches and activates every control; modal focus is contained and restored; reduced-motion mode stops the progress animation; and primary text/control contrasts meet WCAG AA.

Store the review notes and screenshot locations in `docs/UI_REVIEW.md`. Browser evidence must distinguish fixture/demo interactions from signed testnet transactions. A screenshot of a fake transaction is not evidence of settlement.

## Support and review extension

The support desk extends the same work-desk pattern: a compact conversation list beside a readable message thread. A signed wallet message opens a private web session; it is visually separate from an escrow transaction and does not use transaction progress messages. Creator, bounty poster, and authorized support maintainers are the only intended readers. A ticket includes explicit open, in-review, and resolved states; a resolved conversation remains readable and cannot accept new replies.

Appeal links appear for a claimant on submitted or rejected work. Every appeal entry point explains that it is an off-chain request and does not pause expiry, refunds, or reverse payments. The UI does not portray a support ticket as a dispute court.

Post review includes deterministic preflight findings, links to matching bounties, and a separate acknowledgement before deliberately funding an already matched issue. Optional AI review requires an explicit request and authenticated session. The AI helper uses the same quiet surface and text hierarchy; it never receives a private ticket automatically, never asks for an API key, and cannot authorize payouts. An unconfigured AI provider is an explicit available-support state, not a broken chat input.

Automated payout limits are shown in the escrow review when they affect the reward and on the bounty detail. A reward above the configured limit clearly requires maintainer approval. This disclosure does not imply that a lower reward is guaranteed to pass other risk checks.
