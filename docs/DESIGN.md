# GitSettle design system

Status: design reviewed before component implementation. The `frontend-design` skill was read from `/home/ubuntu/.codex/skills/frontend-design/SKILL.md` on 2026-11-14. This document is the shared UI contract, including states that must be reviewed in a browser before the MVP is called complete.

## Product and visual idea

GitSettle is a work desk for maintainers, developers, and translators. Its primary job is to put a concrete GitHub issue, a promised NEAR reward, and the next action next to one another. A contributor should be able to compare work without opening six cards. A maintainer should be able to see exactly what is held, submitted, and settled.

The visual language borrows the precision of a repository issue list and the hierarchy of a technical journal. The memorable element is the work queue itself: generous issue titles, small visible locale chips, a clean numerical reward column, and stateful action guidance. Decoration does not compete with the issue content. Forest green indicates action and successful settlement; type and written labels carry all meaning without depending on color.

## Tokens

### Color

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| Canvas | `#F3F6F4` | `#111E18` | Page background; cool, slightly green paper |
| Surface | `#FFFFFF` | `#192A21` | Queue, input, and transaction surfaces |
| Soft surface | `#E7EEEA` | `#24382C` | Navigation selection and quiet information panels |
| Ink | `#18261F` | `#EAF3ED` | Primary text |
| Muted ink | `#526359` | `#ADBEAF` | Supporting text, labels, inactive navigation |
| Forest | `#006400` | `#9DCDA5` | Links, focus indicator, affirmative status text |

The primary button retains the brand's `#006400` fill and white label in both themes. Borders use `#CCD8D0` in light and `#425348` in dark. Warning text uses `#804112` on `#FAECD7`; error text uses `#9D2D27` on `#FAE9E7`. Dark warning/error states use `#F0C48C` / `#F4A29B` on the dark surface. Do not place muted text over tinted surfaces unless its measured contrast remains at least 4.5:1.

### Typography

- Source Sans 3: navigation, copy, issue titles, forms, tables, numeric data. Bundle fonts with the app so clean builds and self-hosting do not need a font CDN.
- Newsreader: page titles and one editorial statement per screen at most. The body and all controls stay sans serif.
- Fallbacks: `Arial, sans-serif` for Source Sans 3; `Georgia, serif` for Newsreader.
- Type scale: 12, 14, 16, 18, 24, 32, 44 px. Main page titles use 44/48 desktop and 32/36 mobile. Issue titles use 18/24, regular body uses 16/24, metadata uses 14/20. Avoid text below 12 px.
- Use `font-variant-numeric: tabular-nums` for amounts, point values, ranks, issue numbers, and dates. Avoid monospace labels unless the content is an account identifier or exact code to copy.
- Left align prose and headings. Right align amounts, counts, and rank movements within their columns. Keep explanatory prose below 72 characters per line.

### Space, shape, and motion

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px. Desktop page padding 40 px; mobile 20 px.
- Desktop shell: 216 px navigation column, main content width up to 1360 px, with content aligned to a consistent left edge. The board uses its available width; detail/form pages cap prose at 760 px and put escrow facts in a 280 px aside.
- Radius: 6 px controls, 10 px bounded work surfaces, 999 px compact status and locale chips. Table row divisions stay square. No decorative rounded blobs or glass effects.
- Controls target at least 44 px high, including mobile theme/wallet controls. Visible 3 px focus ring with 3 px offset.
- No automatic entry animation. A transaction progress strip can move while waiting; changes to leaderboard rank may briefly highlight the changed row. Honor `prefers-reduced-motion` by removing transitions and animation.
- Lucide is the single icon family; decorative icons have `aria-hidden`. Icons never replace an action's accessible name.

## Layout exploration and review

Option A: a horizontal masthead and full-width issue table would be efficient, but it leaves account actions and maintainer work detached from the board when pages become long.

```text
GitSettle     Work queue   Leaderboard   Dashboard       Wallet
The work queue                                 Post a bounty
Search                  Type     Status       Reward
Issue / repository                Locale     Reward    State
```

Option B, selected: a quiet left navigation column gives each work area a stable home, while the main column uses issue-list density and an editorial heading. It also reserves a reliable location for network identity and theme controls.

```text
+-------------------+--------------------------------------------------+
| GitSettle         | Work queue                            Wallet     |
|                   |                                                  |
| Work queue        | The work queue                    Post a bounty  |
| Leaderboard       | Reward held in escrow until merge                 |
| My contributions  |                                                  |
| Maintainer desk   | Search issues...         Type / Status / Reward  |
|                   | Issue and repository         Reward       State   |
|                   | #24 Fix stale reward display  12.00 NEAR  Open    |
|                   | #31 Translate wallet flow es  18.00 NEAR  Open    |
|                   | #42 Audit refund behavior     30.00 NEAR  Claimed |
|                   |                                                  |
| NEAR Testnet      | Bounties settle to the contributor's NEAR account|
| Theme             |                                                  |
+-------------------+--------------------------------------------------+
```

At widths below 900 px, the navigation becomes a compact header with wrapping text links. Queue rows reflow into issue-first blocks that keep reward and state visible. No fixed sidebar overlays mobile content. The form aside moves under the title. Tables with genuinely comparative content, such as the leaderboard, use a contained horizontal scroll region and retain row headers.

Review against the brief: the sidebar alone is a common application pattern, so visual identity comes from real issue content, visible localization scope, aligned financial values, and a sparse serif heading. The first sketch's oversized aggregate escrow number was removed because it distracted from choosing work. Hairline rules are used only to divide rows or explain a lifecycle; the app is not a newspaper imitation. There are no uniform card grids, gradient fills, ornamental labels, or marketing hero art.

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
