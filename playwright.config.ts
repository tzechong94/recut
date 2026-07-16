import { defineConfig, devices } from '@playwright/test';

// Port is configurable so tests can run against a dedicated recut dev server (127.0.0.1) and
// never collide with other local apps (e.g. HealthHub on :3000). Use 127.0.0.1 not localhost to
// force IPv4 and avoid an IPv6 [::1] server on the same port.
const PORT = process.env.RECUT_PORT ?? '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Tests write projects to an isolated store so they never pollute the real .recut/projects
    // the app reads, and run in replay so they cost nothing.
    env: { RECUT_DATA_DIR: '.recut-test/projects', RECUT_MODE: 'replay' },
  },
});
