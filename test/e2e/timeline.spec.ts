import { test, expect } from '@playwright/test';

// Sprint 6 exit gate + demo beat: changing the series LUT restyles every clip instantly with
// ZERO network calls (colour grading never touches a model).
test('timeline: changing the series LUT restyles clips instantly, no network', async ({ page }) => {
  let externalCalls = 0;
  page.on('request', (r) => {
    if (/dashscope|aliyuncs/.test(r.url())) externalCalls++;
  });

  await page.goto('/timeline');
  const frame = page.getByTestId('clip-frame').first();
  const before = await frame.evaluate((el) => getComputedStyle(el).filter);

  await page.getByTestId('lut-cold-noir').click();
  const after = await frame.evaluate((el) => getComputedStyle(el).filter);

  expect(after).not.toBe(before); // restyled
  expect(after).not.toBe('none');
  expect(externalCalls).toBe(0); // zero API calls
});
