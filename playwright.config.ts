import { defineConfig, devices } from '@playwright/test';

// End-to-end tests. They start their own server (:8790, TOWERS_TEST=1 = fixed seed, creator
// plays Red, Red starts, forced opening dice) and Vite (:5190) so they never clash with
// `npm run dev`. Run one spec at a time: `npm run e2e -- e2e/pvp.spec.ts`.
const SERVER_PORT = 8790;
const CLIENT_PORT = 5190;

export default defineConfig({
  testDir: './e2e',
  // Playwright wipes its outputDir on every run; screenshots live next to it in test-results/screens.
  outputDir: './test-results/playwright',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'npx tsx packages/server/src/local/main.ts',
      url: `http://localhost:${SERVER_PORT}/config.json`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        TOWERS_SERVER_PORT: String(SERVER_PORT),
        TOWERS_TEST: '1',
        TOWERS_TEST_SEED: 'e2e',
        TOWERS_TEST_SEAT: 'red',
        TOWERS_TEST_FIRST: 'red',
        // First engagement: stale 1+2, Commander reroll of die 1 -> 1 (still stale), Press, then 3+4 = 7.
        TOWERS_TEST_DICE: '1,2,1,3,4',
      },
    },
    {
      command: 'npm run dev -w @towers/client',
      url: `http://localhost:${CLIENT_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        TOWERS_CLIENT_PORT: String(CLIENT_PORT),
        TOWERS_SERVER_PORT: String(SERVER_PORT),
      },
    },
  ],
});
