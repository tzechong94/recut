import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Capture-only: screenshots every key screen to test-results/screens/ for `pnpm eval:ui`.
// Runs under Playwright's managed webServer (reliable), so no hand-rolled server races.
const SCREENS = [
  { name: 'landing', path: '/' },
  { name: 'produce', path: '/produce' },
  { name: 'rig', path: '/rig' },
  { name: 'studio', path: '/studio' },
  { name: 'report', path: '/report' },
];

test.use({ viewport: { width: 1440, height: 900 } });

for (const s of SCREENS) {
  test(`capture ${s.name}`, async ({ page }) => {
    const dir = resolve('test-results/screens');
    mkdirSync(dir, { recursive: true });
    await page.goto(s.path, { waitUntil: 'load' });
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(dir, `${s.name}.png`) });
  });
}
