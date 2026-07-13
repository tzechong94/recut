import { test, expect } from '@playwright/test';

// Sprint 5: the continuity report card renders per-take scores; the deliberate wardrobe break
// is visibly off-model (low), and the repaired take recovers.
test('report card shows the break as off-model and the repair recovered', async ({ page }) => {
  await page.goto('/report');

  await expect(page.getByTestId('row-good')).toBeVisible();
  await expect(page.getByTestId('row-break-wardrobe')).toBeVisible();
  await expect(page.getByTestId('row-repaired')).toBeVisible();

  const good = Number(await page.getByTestId('score-good').textContent());
  const brk = Number(await page.getByTestId('score-break-wardrobe').textContent());
  const repaired = Number(await page.getByTestId('score-repaired').textContent());

  expect(brk).toBeLessThan(good); // the break scores worse
  expect(repaired).toBeGreaterThan(brk); // repair recovered
});
