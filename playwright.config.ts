import { defineConfig } from '@playwright/test';

/** Browser checks use the labeled demo; no test ever connects a real wallet. */
const externalServer = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalServer || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/ui.spec.ts', '**/community.ui.spec.ts', '**/performance.ui.spec.ts', '**/wallet.ui.spec.ts', '**/wallet-bridge.ui.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 }, colorScheme: 'light' } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: 'light' } },
    { name: 'dark', use: { viewport: { width: 1440, height: 960 }, colorScheme: 'dark' } },
  ],
  webServer: externalServer ? undefined : {
    command: 'npm start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: {
      DEMO_MODE: 'true',
      NEAR_CONTRACT_ID: '',
      DATABASE_PATH: process.env.UI_DATABASE_PATH || '/tmp/gitsettle-ui.sqlite',
      APP_ORIGIN: baseURL,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
