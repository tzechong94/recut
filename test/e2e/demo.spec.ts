import { test, expect } from '@playwright/test';

// The guided demo IS the canvas: nodes reveal as you click Next, and clicking a node inspects
// its real prompt / model / continuity axes (all from committed fixtures, zero network).
test('guided demo reveals nodes on Next and inspects them', async ({ page }) => {
  await page.route('**/*aliyuncs.com/**', (r) => r.abort()); // zero network

  await page.goto('/demo');
  await expect(page.getByTestId('demo-step')).toHaveText('step 1/6');
  await expect(page.getByText('Cast · Mei').first()).toBeVisible();

  // the first node's prompt/detail is inspectable
  await expect(page.getByTestId('demo-inspector')).toContainText('Canon');

  // Next reveals the keyframe node + auto-selects it, showing the real compiled prompt
  await page.getByTestId('demo-next').click();
  await expect(page.getByTestId('demo-step')).toHaveText('step 2/6');
  await expect(page.getByText('Keyframe · Take').first()).toBeVisible();
  await expect(page.getByTestId('inspect-prompt')).toContainText('camera framing');

  // step to the continuity node and confirm the wardrobe break axis is shown
  await page.getByTestId('demo-next').click(); // break
  await page.getByTestId('demo-next').click(); // continuity
  await expect(page.getByTestId('demo-step')).toHaveText('step 4/6');
  await expect(page.getByTestId('demo-inspector')).toContainText('wardrobe');
  await expect(page.getByTestId('demo-inspector')).toContainText('0.30');
});
