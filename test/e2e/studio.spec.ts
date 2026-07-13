import { test, expect } from '@playwright/test';

// Sprint 4 exit gate + demo beat: edit an entity's wardrobe in the bible and every take that
// referenced it flags stale, instantly, on the canvas.
test('studio: change scarf colour → bible version bumps, shot flags stale', async ({ page }) => {
  await page.goto('/studio');

  await expect(page.getByTestId('bible-version')).toHaveText('v1');
  await expect(page.getByTestId('stale-count')).toHaveText('0');
  await expect(page.getByTestId('shot-status')).toHaveText('accepted');

  await page.getByTestId('scarf-blue').click();

  await expect(page.getByTestId('bible-version')).toHaveText('v2');
  // all 4 candidate takes for the shot referenced Mei, so all 4 flag stale
  await expect(page.getByTestId('stale-count')).toHaveText('4');
  await expect(page.getByTestId('shot-status')).toHaveText('stale');
});
