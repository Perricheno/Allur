import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/control', outputDir: './test-results/control', workers: 1, timeout: 90000,
  expect: { timeout: 20000 },
  use: { baseURL: 'http://127.0.0.1:3283', viewport: { width: 1440, height: 1000 }, launchOptions: { args: ['--enable-unsafe-swiftshader'] }, screenshot: 'only-on-failure' },
  webServer: { command: 'node server/factory-server.js', env: { PORT: '3283', ALLUR_AUTOPLAY: '0', ALLUR_STATE_PATH: '/tmp/allur-control-e2e.json' }, url: 'http://127.0.0.1:3283/healthz', reuseExistingServer: false },
});
