import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;

// Runs against the production build served by the Go binary (`make e2e` builds both first).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'], channel: 'chrome' } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: `rm -f ../data/e2e.db* && ../bin/post-checklist -addr 127.0.0.1:${PORT} -db ../data/e2e.db -rate-limit=false`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
  },
});
