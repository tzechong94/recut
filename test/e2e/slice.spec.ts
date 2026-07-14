import { test, expect } from '@playwright/test';

// Sprint 1 exit gate: the vertical slice walks in a real browser, in replay (zero network),
// and the accepted Take carries complete provenance.
test('produce: 4 candidates → accept a Take → provenance + export', async ({ page }) => {
  // Fail the test if the browser ever tries to reach DashScope (zero-network guarantee).
  await page.route('**/dashscope*/**', (route) => route.abort());
  await page.route('**/*aliyuncs.com/**', (route) => route.abort());

  await page.goto('/produce');

  // batch-of-4 candidates render
  const candidates = page.getByTestId('candidate');
  await expect(candidates).toHaveCount(4);

  // capability badge shows the capability, never a raw model id, on the node face
  await expect(page.getByTestId('capability-badge')).toHaveText('image.edit');
  await expect(page.getByTestId('status')).toHaveText('cached');

  // selecting a candidate reveals the exact prompt sent to the model
  await candidates.first().click();
  const prompt = page.getByTestId('prompt-panel');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('camera framing'); // the real instruction text

  // accept it
  await page.getByTestId('accept').click();

  // provenance is complete
  const prov = page.getByTestId('provenance');
  await expect(prov).toContainText('qwen-image-edit');
  await expect(prov).toContainText('image.edit');
  await expect(prov).toContainText('Cache hash');

  // export points at the accepted frame
  await expect(page.getByTestId('export')).toHaveAttribute('href', /\/takes\/\d+\.png/);
});
