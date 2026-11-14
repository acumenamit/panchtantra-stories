import { defineConfig, devices } from '@playwright/test'

const PORT = 3005

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // Spec §10.2: Chromium and WebKit; tablet portrait and landscape; phone.
  projects: [
    { name: 'chromium-tablet', use: { ...devices['Galaxy Tab S9'] } },
    { name: 'chromium-tablet-landscape', use: { ...devices['Galaxy Tab S9 landscape'] } },
    { name: 'chromium-phone', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-ipad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'pnpm start',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
