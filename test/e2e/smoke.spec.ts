import { test, expect } from '@playwright/test';

// Sprint 0 smoke: the app renders and the harness status is visible. The full
// demo happy-path walk lands in Sprint 1's vertical slice.
test('landing renders the product line and project creation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Recut gives you a series');
  await expect(page.getByTestId('create-project')).toBeVisible();
});
