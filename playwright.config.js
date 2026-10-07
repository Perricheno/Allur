import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3174', viewport: { width: 1440, height: 1100 } },
  webServer: {
    command: 'node server/index.js',
    env: { PORT: '3174', KTZ_AUTOPLAY: '0' },
    url: 'http://127.0.0.1:3174/api/state',
    reuseExistingServer: false,
  },
});
