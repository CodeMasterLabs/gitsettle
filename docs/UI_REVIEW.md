# Browser and visual review

**Verified November 14, 2026: all 143 executed browser checks pass** against the dApp Next.js production build, using Playwright 1.65.1 and Chromium. [GitHub run 43614903721](https://github.com/CodeMasterLabs/gitsettle/actions/runs/43614903721) passed the full suite on published source `a63ff25c6d69733ce253da15546c22b3142150c2`; local full and focused runs verified the same scenarios. Playwright discovers 144 scenarios; the desktop global-search scenario is intentionally skipped on mobile, which has its own queue search. The production build completed without warnings.

The suite uses clearly labeled demo data. Wallet checks use the real selector modules and NEAR Connect sandbox with injected Nightly, popup-boundary and sandbox-executor fixtures; they do not approve a real account or sign transactions. Confirmation, support-session, ticket, signature callback and AI responses are explicit fixtures. The connected-header layout check substitutes public account markup only; it proves responsive layout, not wallet ownership. Real HTTP authentication and settlement evidence are recorded separately in [COMMUNITY_E2E.json](COMMUNITY_E2E.json) and [LIVE_E2E.json](LIVE_E2E.json).

## Coverage and final design review

- All main screens: work queue, bounty detail, posting/review, contributor profile, rankings, maintainer dashboard and support desk.
- Type/status/reward filtering, translation quick view, open-work quick view, conversation search and empty-result recovery.
- Loading skeletons, API retry, expired/settled work, disconnected wallet and terminal-state action hints.
- Exact storage/deposit review, draft preservation, pending/confirmed/failed transaction presentation and retained intent after mismatched evidence.
- Private support sign-in, appeal drafts, accessible/inaccessible threads, replies, resolution, expired sessions, NEP-413 callback validation and fragment scrubbing.
- Duplicate-funding acknowledgement, payout-cap disclosure, optional AI unavailable/failure/reply states.
- Deferred wallet-code loading, recovery despite a failed optional chunk download, and preservation of a pending action after a mismatched return hash.
- Four-provider connection dialog, account management, cancellation/retry, no-key MyNearWallet connection, Nightly account changes and complete NEP-413 challenge fields.
- Meteor/Intear sandbox network and identity requests, explicit Intear support limitations, and refusal to sign while a wallet switch is unfinished.
- Startup/cancellation of the shipped Intear executable, stale signature rejection after extension account changes, and revocation of delayed session responses after disconnect.
- Reward-category totals excluding expired work, translation discovery resetting filters, shared global search, and persisted appearance selection.
- Keyboard skip navigation, visible focus, serious/critical Axe WCAG A/AA findings and page overflow.

Main layouts were tested at **1440 × 960**, **375 × 812**, and dark desktop appearance. An additional connected-wallet layout regression checks **320 px and 375 px** in each appearance: header elements cannot overlap, account/theme/disconnect targets are at least 44 px high, form values use at least 16 px text to avoid iOS focus zoom, and testnet identification remains visible.

The dApp revision follows the user's reference: a yellow canvas around a rounded black frame, integrated navigation, charcoal workspace, black inset queue and a yellow translation panel. Manrope carries headings and financial values; Source Sans carries body text. Escrow, category and locale summaries come from real queue data. The first visit uses dark appearance; a saved light choice persists. Mobile navigation and category tiles scroll within their own regions, account controls wrap beneath the breadcrumb, and the comparative leaderboard retains a labeled, keyboard-focusable scroll region.

The refreshed captures include **90 demo/fixture PNGs**. Each full-page capture scrolls to the top first, preventing sticky navigation and the offscreen skip link from appearing at a misleading scrolled position. Native dialogs use viewport captures because their top-layer backdrop covers the viewport. The visual review inspected all seven main routes, both desktop appearances, mobile layouts, 320 px layouts and long-account wallet dialogs. It corrected hidden-label overflow in the category strip and a split decimal in mobile maintainer totals; the final checks verify the corrected layout.

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
| Wallet provider picker | [View](screenshots/desktop/wallet-provider-picker.png) | [View](screenshots/mobile/wallet-provider-picker.png) | [View](screenshots/dark/wallet-provider-picker.png) |
| Wallet account fixture | [View](screenshots/desktop/wallet-account-modal-fixture.png) | [View](screenshots/mobile/wallet-account-modal-fixture.png) | [View](screenshots/dark/wallet-account-modal-fixture.png) |
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

The suite lives in `tests/ui.spec.ts`, `tests/community.ui.spec.ts`, `tests/performance.ui.spec.ts`, `tests/wallet.ui.spec.ts`, and `tests/wallet-bridge.ui.spec.ts`. Viewport, browser and server configuration is in `playwright.config.ts`. Repeated runs overwrite review captures. Run a single meaningful subset when investigating a regression, for example:

```sh
npx playwright test --grep 'narrow connected-wallet header'
```

## Final public deployment captures

The same app source was deployed at `https://gitsettle.89.167.109.196.sslip.io` and all seven main routes loaded without browser runtime errors or page overflow. These captures show real testnet data and signed-out public pages, not mocked account sessions: [queue](screenshots/live/work-queue.png), [mobile queue](screenshots/live/work-queue-mobile.png), [paid translation](screenshots/live/paid-translation.png), [posting](screenshots/live/post-bounty.png), [leaderboard](screenshots/live/leaderboard.png), [contributor](screenshots/live/contributor.png), [maintainer](screenshots/live/maintainer.png), [support](screenshots/live/support.png), and [provider picker](screenshots/live/wallet-provider-picker.png). No provider was selected in the live picker check, and opening it downloaded no additional signing scripts. The refreshed captures were visually rechecked after deployment.
