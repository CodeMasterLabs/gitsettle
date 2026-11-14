# Browser and visual review

**Verified November 14, 2026: 96 of 96 browser checks passed in 2.3 minutes** against the final premium Next.js production build, using Playwright 1.65.1 and Chromium. The build completed without warnings.

The suite uses clearly labeled demo data. Wallet selector checks open its modal but do not connect a real wallet or sign transactions. Confirmation, support-session, ticket, signature callback and AI responses are explicit fixtures. The connected-header layout check substitutes public account markup only; it proves responsive layout, not wallet ownership. Real authentication and settlement evidence are recorded separately in [COMMUNITY_E2E.json](COMMUNITY_E2E.json) and [LIVE_E2E.json](LIVE_E2E.json).

## Coverage and final design review

- All main screens: work queue, bounty detail, posting/review, contributor profile, rankings, maintainer dashboard and support desk.
- Type/status/reward filtering, translation quick view, open-work quick view, conversation search and empty-result recovery.
- Loading skeletons, API retry, expired/settled work, disconnected wallet and terminal-state action hints.
- Exact storage/deposit review, draft preservation, pending/confirmed/failed transaction presentation and retained intent after mismatched evidence.
- Private support sign-in, appeal drafts, accessible/inaccessible threads, replies, resolution, expired sessions, NEP-413 callback validation and fragment scrubbing.
- Duplicate-funding acknowledgement, payout-cap disclosure, optional AI unavailable/failure/reply states.
- Deferred wallet-code loading, recovery despite a failed optional chunk download, and preservation of a pending action after a mismatched return hash.
- Keyboard skip navigation, visible focus, serious/critical Axe WCAG A/AA findings and page overflow.

Main layouts were tested at **1440 × 960**, **375 × 812**, and dark desktop appearance. An additional connected-wallet layout regression checks **320 px and 375 px** in each appearance: header elements cannot overlap, account/theme/disconnect targets are at least 44 px high, form values use at least 16 px text to avoid iOS focus zoom, and testnet identification remains visible.

The premium revision uses a graphite navigation rail, Manrope headings and financial values, Source Sans body text, forest-green actions, a continuous escrow overview, and structured queue/form/inbox surfaces. The final visual pass inspected every main desktop capture plus the mobile queue, connected header, form and support states. Sidebar, breadcrumb, table-column and action alignment are consistent. Mobile navigation scrolls within its own region, the overview uses compact spacing, and the account controls wrap beneath the breadcrumb when necessary. The page itself does not scroll horizontally. Long comparative leaderboard columns retain a labeled, keyboard-focusable scroll region.

The refreshed captures include **78 demo/fixture PNGs**. Each full-page capture scrolls to the top first, preventing sticky navigation and the offscreen skip link from appearing at a misleading scrolled position. No further spacing correction was needed after the final production build.

Automated accessibility checks cannot replace a complete assistive-technology audit. Browser fixture results must not be presented as real escrow or provider activity. The separate `screenshots/live/` directory records the public deployment and is updated independently during deployment verification.

## Main-screen captures

| Screen | Desktop | Mobile | Dark |
| --- | --- | --- | --- |
| Work queue | [View](screenshots/desktop/work-queue.png) | [View](screenshots/mobile/work-queue.png) | [View](screenshots/dark/work-queue.png) |
| Bounty detail | [View](screenshots/desktop/bounty-detail.png) | [View](screenshots/mobile/bounty-detail.png) | [View](screenshots/dark/bounty-detail.png) |
| Post bounty | [View](screenshots/desktop/post-bounty.png) | [View](screenshots/mobile/post-bounty.png) | [View](screenshots/dark/post-bounty.png) |
| Contributor | [View](screenshots/desktop/contributor-profile.png) | [View](screenshots/mobile/contributor-profile.png) | [View](screenshots/dark/contributor-profile.png) |
| Leaderboard | [View](screenshots/desktop/leaderboard.png) | [View](screenshots/mobile/leaderboard.png) | [View](screenshots/dark/leaderboard.png) |
| Maintainer dashboard | [View](screenshots/desktop/maintainer-dashboard.png) | [View](screenshots/mobile/maintainer-dashboard.png) | [View](screenshots/dark/maintainer-dashboard.png) |
| Support sign-in | [View](screenshots/desktop/support-signed-out.png) | [View](screenshots/mobile/support-signed-out.png) | [View](screenshots/dark/support-signed-out.png) |
| Private conversation fixture | [View](screenshots/desktop/support-private-thread-fixture.png) | [View](screenshots/mobile/support-private-thread-fixture.png) | [View](screenshots/dark/support-private-thread-fixture.png) |
| Appeal draft fixture | [View](screenshots/desktop/support-appeal-draft-fixture.png) | [View](screenshots/mobile/support-appeal-draft-fixture.png) | [View](screenshots/dark/support-appeal-draft-fixture.png) |
| Duplicate and payout-cap fixture | [View](screenshots/desktop/post-duplicate-and-cap-fixture.png) | [View](screenshots/mobile/post-duplicate-and-cap-fixture.png) | [View](screenshots/dark/post-duplicate-and-cap-fixture.png) |
| Connected header at 375 px (layout fixture) | [View](screenshots/desktop/connected-wallet-layout-fixture.png) | [View](screenshots/mobile/connected-wallet-layout-fixture.png) | [View](screenshots/dark/connected-wallet-layout-fixture.png) |
| AI reply fixture | [View](screenshots/desktop/support-ai-reply-fixture.png) | [View](screenshots/mobile/support-ai-reply-fixture.png) | [View](screenshots/dark/support-ai-reply-fixture.png) |

Each appearance directory also contains `review-bounty`, `empty-filter-results`,
`loading-queue`, `queue-error`, `expired-bounty`, `wallet-not-connected`, and the
three clearly named `transaction-*-fixture` captures. Fixture text is visible in
the transaction screenshots so they cannot be mistaken for real payouts.

## Reproduce

Run after `npm run build`:

```sh
npm run test:ui
```

Playwright starts a demo-mode server. An existing server must also report demo mode; the browser tests do not target live signing. For a separately started QA server, set `PLAYWRIGHT_BASE_URL`. Screenshots are written to `docs/screenshots/` by appearance. Failure traces and the HTML report remain local artifacts.

The suite lives in `tests/ui.spec.ts`, `tests/community.ui.spec.ts`, and `tests/performance.ui.spec.ts`. Viewport, browser and server configuration is in `playwright.config.ts`. Repeated runs overwrite review captures. Run a single meaningful subset when investigating a regression, for example:

```sh
npx playwright test --grep 'narrow connected-wallet header'
```
