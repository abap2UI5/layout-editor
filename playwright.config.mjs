// Browser tests of the designer (test/e2e). Two legs: the current UI5 and
// 1.71, the oldest release abap2UI5 supports - every design has to render
// in both. Both boot pinned releases from the OpenUI5 CDN; where the CDN
// is out of reach, local trees stand in (tools/serve.mjs):
//   UI5_RESOURCES=<1.144 tree> UI5_RESOURCES_171=<1.71 tree> npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const current = process.env.UI5_RESOURCES ? 'local' : '1.144.0';
const oldest = process.env.UI5_RESOURCES_171 ? 'local:171' : '1.71.80';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'ui5-current', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ui5: current } },
    { name: 'ui5-1.71', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ui5: oldest }, grep: /@render/ },
  ],
  webServer: {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
