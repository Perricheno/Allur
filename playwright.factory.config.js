import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/factory',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  use: {
    baseURL: 'http://127.0.0.1:3280',
    viewport: { width: 1600, height: 1000 },
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/factory-server.js',
    url: 'http://127.0.0.1:3280/healthz',
    reuseExistingServer: true,
  },
});
