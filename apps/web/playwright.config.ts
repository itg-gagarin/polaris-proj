import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Editor smoke tests against `next start` with a throwaway data file (run `pnpm build` first). */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1600, height: 1000 }, launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: {
    command: 'pnpm exec next start -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    env: { DATA_FILE: join(tmpdir(), `bom-e2e-${Date.now()}.json`) },
    timeout: 120_000,
  },
});
