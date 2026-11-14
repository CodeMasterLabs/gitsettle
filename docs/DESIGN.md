# GitSettle design system

Updated November 14, 2026. The reference-led dApp revision uses the `frontend-design` skill at `/home/ubuntu/.codex/skills/frontend-design/SKILL.md`. The user's supplied `original-40832bc1c16be24fc5b91c0f30a25e0f.webp` is a local visual reference, not a redistributed application asset.

## Direction and design review

The supplied reference sets the composition: a yellow outer canvas around a rounded black application, integrated dark navigation, a charcoal working area, black inset surfaces, large financial typography, and one yellow vertical panel. GitSettle translates the financial dashboard into a contribution workspace. Its overview shows the actual escrow balance, open work, submitted PRs, and paid rewards. Work-type tiles summarize currently claimable NEAR. The highlighted panel shows the languages represented in the bounty queue.

The composition uses a visibly framed application, asymmetric locale/queue columns, stronger financial scale, circular work-type markers, and a yellow translation surface. Search, category shortcuts, wallet actions, support conversations, and financial controls work within this layout. Every financial value and summary comes from the returned bounty data.

Forest green is the semantic success color in light mode; mint serves the same role in dark mode. The default appearance is dark to match the reference. An explicitly selected light appearance remains available and persists across navigation.

## Tokens

| Role | Dark/default | Light |
| --- | --- | --- |
| Outer canvas | `#FFEA79` | `#FFEA79` |
| Application frame | `#080808` | `#FDFDF9` |
| Workspace | `#1A1A1A` | `#EFEFE9` |
| Inset surface | `#0A0A0A` | `#FFFFFF` |
| Primary ink | `#F7F7F2` | `#191B16` |
| Supporting ink | `#AAA9A2` | `#5F6357` |
| Main accent | `#F0D957` | `#F0D957` |
| Accent ink | `#14140C` | `#14140C` |
| Success/link | `#64D9B3` | `#006400` |

The navigation stays black in both appearances. The yellow locale panel uses `#17170F` primary text and `#45432A` secondary text; its controls have a dark focus outline. Dark borders are `#353530`, light borders `#CCCEC1`. Warnings and errors include text and icons independently of color.

- **Manrope 600/700:** headings, navigation, issue titles, actions, balances and rankings. The leading escrow balance is 48 px at wide desktop sizes; ordinary page titles are 30 px. Financial values use tabular numerals and intentionally stronger scale than supporting copy.
- **Source Sans 3 400/600:** descriptions, labels, metadata, forms and support messages. Both typefaces are bundled locally.
- **Spacing:** 4, 8, 12, 16, 20, 24, 28 and 32 px. Desktop frame gutter is 28 px; mobile is 8 px. Prose stays left aligned and financial comparison columns right aligned.
- **Shape:** 36 px application frame, 28 px workspace, 24 px board panels, 20–22 px inset surfaces, 12 px controls, circular type/avatar marks and pill status labels. Shape communicates containment and role rather than using one radius everywhere.
- **Motion:** pending transaction feedback and actual rank changes only; reduced-motion preferences are respected. No ambient charts or entrance animation.
- **Icons:** Lucide throughout. Icons supplement visible labels; purely decorative icons have `aria-hidden`.

## Layout

```text
Yellow canvas
+------------------ black application frame -------------------------+
| GitSettle        | Location       Find your next contribution Wallet |
|                  | +--------------- charcoal workspace -----------+ |
| Work queue       | | Work queue                     Post a bounty | |
| Leaderboard      | |                                               | |
| My contributions | | Held in escrow    Open    In review    Paid     | |
| Maintainer desk  | | 48px NEAR amount                               | |
| Support          | |                                               | |
|                  | | [Bug fixes] [Features] [Audits] [Translations] | |
|                  | |                                               | |
|                  | | Yellow locales | Black work queue             | |
|                  | | es Spanish     | All / Open / Translation     | |
|                  | | bn Bengali     | Search, type, status, reward  | |
|                  | | ja Japanese    | Issue     Type  NEAR  Status  | |
| Source / CLI     | |                | Actual bounty rows           | |
| Escrow rules     | +-----------------------------------------------+ |
+--------------------------------------------------------------------+
```

All category totals derive from open, unexpired bounties. The locale panel counts the returned bounties per locale and does not imply that all are still open. Demo data is explicitly identified in the global notice and escrow/payment labels. Every category tile filters the queue; the locale action opens translation work. Global search submits a shareable `/?q=` query. Existing minimum-reward filtering uses exact decimal parsing.

At intermediate widths the yellow locale panel becomes a horizontal summary above the queue. At mobile widths the type overview becomes one horizontally scrollable row, navigation becomes a contained horizontal strip, and the bounty queue becomes issue-first rows. The locale panel follows the queue so contributors reach actual work sooner. The global desktop search is replaced by the queue's visible search field. No screen requires horizontal page scrolling; the comparative leaderboard remains a labeled, keyboard-focusable scroll region.

## Shared screens

- **Bounty detail:** large issue title with type/status context, rounded description/timeline panels and a sticky escrow action panel with a yellow edge. Mobile places escrow and the next action first. Repository, PR, deadline, claimant, poster and verification routing remain explicit.
- **Post a bounty:** two meaningful stages—work details, then exact escrow review. Rounded inset form surfaces match the workspace. The locale selector appears for translation work. Reward, storage funding and total deposit are separately stated before signing.
- **Contributor and leaderboard:** account identity and financial totals use the same hierarchy as the board; mobile profile earnings occupy their own full-width metric to preserve complete amounts; readable comparative rows preserve actual rank movement without synthetic trends.
- **Maintainer:** account-scoped balances, lifecycle tabs and real bounty rows share the board system. On mobile, the escrow amount occupies a full-width metric above the review and refund counts, preserving complete financial values at 320 px. Refund eligibility and submitted-work checks continue to come from actual state.
- **Support and appeals:** a list beside a readable conversation, with distinct own-message surfaces, explicit private-session identity and meaningful ticket statuses. Off-chain appeals do not pause refunds or reverse payments. AI availability is shown honestly.
- **Wallet dialog:** a separate accessible provider/account dialog follows the black/yellow language. Wallet integrations load on demand. Browser code never asks for private keys. Account management is reachable from the header account control.

## States, safety and accessibility

| State | Presentation and recovery |
| --- | --- |
| Loading | Stable shell and heading, dimensioned skeleton rows, `aria-busy`; no fictional amounts |
| Empty queue | Clear explanation and a working Clear filters action |
| API error | Inline readable error with retry; loaded data remains visible after a refresh failure |
| Disconnected | Explicit wallet notice, Connect wallet action, browsing available |
| Demo | Persistent example-data notice; escrow mutations disabled |
| Expired | Explicit deadline state, only eligible poster refund actions |
| Pending transaction | Status notice and progress feedback; duplicate signing blocked; recovery preserved |
| Confirmed | Verified transaction and refreshed chain data, with explorer link |
| Failed/cancelled | Readable alert; no automatic repeat of signing; draft preserved |
| Verification deferred | Exact unmet GitHub/locale/identity requirement; no promise of a guaranteed payout |
| Settled | Paid amount and contributor identity from settled state |
| No rank history | Accessible “No previous snapshot”; no manufactured movement |

Inputs have visible labels, errors identify affected fields, and status semantics do not depend on color. Focus is visible against the active surface. Primary controls are 44 px high, dialog focus is contained and restored, and support auth remains distinct from signing a financial transaction. Public read caching and lazy wallet SDK loading are preserved.

Screenshot review covers desktop, mobile, light and dark appearances across all main routes plus empty/error/loading/transaction/wallet states. The review record and evidence locations are maintained in `docs/UI_REVIEW.md`; fixture screenshots are not evidence of a real wallet signature or on-chain settlement.
