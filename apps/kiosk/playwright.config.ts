import { defineConfig } from '@playwright/test';

/** Kiosk e2e: the built Electron app (`pnpm build`) + FakeReader + an in-memory mock API (S11 Verify). */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/.results',
});
