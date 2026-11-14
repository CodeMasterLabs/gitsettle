# Browser and visual review

**Verified November 14, 2026: 45 of 45 browser checks passed in 51.8 seconds**
against the production Next.js build, using Playwright 1.65.1 and Chromium 159.
The browser suite uses explicitly labeled demo data and never connects a real wallet.
Transaction-state tests intercept read-only confirmation responses to exercise
presentation; they do not prove a signed transaction, merge or payout.

Completed coverage:

- Work queue, bounty detail, post flow, contributor profile, leaderboard and
  maintainer dashboard at 1440 px, 375 px and a dark desktop appearance.
- Type, locale, reward and status filtering, including recovery from empty results.
- Loading skeletons, API errors and retry, expired work and disconnected wallet.
- Form validation, storage reserve review and preservation of unsent drafts.
- Pending, confirmed and failed transaction messages using response fixtures.
- Axe WCAG A/AA serious/critical findings, keyboard skip navigation, and page overflow.
- Visual inspection of every main-screen capture for spacing and alignment.

All six main routes were inspected at desktop 1440 × 960, mobile 375 × 812,
and desktop dark appearance. These 18 main-screen checks found no serious or
critical Axe WCAG A/AA violations, horizontal page overflow, or browser runtime
exceptions. Additional state captures bring the committed total to 45 PNGs
(approximately 5.6 MB).

Review found and corrected a keyboard defect: activating “Skip to content” did
not move focus into the main region. The main region now accepts programmatic
focus, and the keyboard test passes in all three projects. The mobile header
caption was separated into clear lines, and desktop work-queue rows were reduced
from 107 px to 87 px while retaining the mobile touch layout. Those changes were
rebuilt and the full suite rerun successfully.

The final visual pass checked the work queue, translation detail, both posting
steps, contributor statistics/history, leaderboard and maintainer filters. Column
alignment, locale badges, financial typography, form spacing and light/dark
surfaces remain consistent. On small screens the leaderboard intentionally
scrolls inside a labeled, keyboard-focusable region; it does not widen the page.
Maximum-precision NEAR amounts retain every digit and wrap within the mobile
review panel rather than being rounded.

Automated accessibility checks cover detectable rules and do not constitute a
complete assistive-technology audit. The wallet and confirmation fixtures test
UI recovery only; real testnet settlement evidence is recorded separately.

## Main-screen captures

| Screen | Desktop | Mobile | Dark |
| --- | --- | --- | --- |
| Work queue | [View](screenshots/desktop/work-queue.png) | [View](screenshots/mobile/work-queue.png) | [View](screenshots/dark/work-queue.png) |
| Bounty detail | [View](screenshots/desktop/bounty-detail.png) | [View](screenshots/mobile/bounty-detail.png) | [View](screenshots/dark/bounty-detail.png) |
| Post bounty | [View](screenshots/desktop/post-bounty.png) | [View](screenshots/mobile/post-bounty.png) | [View](screenshots/dark/post-bounty.png) |
| Contributor | [View](screenshots/desktop/contributor-profile.png) | [View](screenshots/mobile/contributor-profile.png) | [View](screenshots/dark/contributor-profile.png) |
| Leaderboard | [View](screenshots/desktop/leaderboard.png) | [View](screenshots/mobile/leaderboard.png) | [View](screenshots/dark/leaderboard.png) |
| Maintainer dashboard | [View](screenshots/desktop/maintainer-dashboard.png) | [View](screenshots/mobile/maintainer-dashboard.png) | [View](screenshots/dark/maintainer-dashboard.png) |

Each appearance directory also contains `review-bounty`, `empty-filter-results`,
`loading-queue`, `queue-error`, `expired-bounty`, `wallet-not-connected`, and the
three clearly named `transaction-*-fixture` captures. Fixture text is visible in
the transaction screenshots so they cannot be mistaken for real payouts.

## Reproduce

Run after `npm run build`:

```sh
npm run test:ui
```

The Playwright server starts in demo mode; an existing server is allowed only if
its `/api/config` also reports demo mode. To review a separately started server,
set `PLAYWRIGHT_BASE_URL`. Screenshots are written to `docs/screenshots/` by
viewport/theme. Test failure traces and the HTML report remain local artifacts.

The suite lives in `tests/ui.spec.ts`; viewport, browser and server configuration
live in `playwright.config.ts`. Repeated test runs overwrite their review captures.
