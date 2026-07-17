import { test, expect } from '@playwright/test';

// The judge demo: index lists demo-able projects; a walkthrough steps through the pipeline.
const DOC = {
  projectId: 'demo-e2e', rev: 1, stylePrefix: 'soft watercolor',
  script: 'two birds by the river',
  assets: [{ id: 'a1', slug: 'yoopi', kind: 'character', imageUrl: '/takes/1000.png', locked: true }],
  scenes: [{ title: 'Scene 1', prompts: [{ name: '1A', text: 'yoopi preens on a branch', assetSlugs: ['yoopi'], shotSize: 'close-up' }] }],
  takes: [{ id: 'v1', promptName: '1A', kind: 'video', url: '/clips/1000.mp4', keeper: true }],
};

test('demo walkthrough steps from title to final cut', async ({ page }) => {
  await page.route('**/api/pipeline/demo-e2e', (r) => r.fulfill({ json: DOC }));
  await page.route('**/api/projects/demo-e2e', (r) => r.fulfill({ json: { id: 'demo-e2e', title: 'Demo Film', createdAt: 0 } }));
  await page.goto('/demo/demo-e2e');
  await expect(page.getByTestId('walkthrough')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Demo Film' })).toBeVisible();

  await page.getByTestId('demo-next').click(); // cast
  await expect(page.getByText('🔒 yoopi')).toBeVisible();
  await page.getByTestId('demo-next').click(); // script
  await expect(page.getByText('two birds by the river')).toBeVisible();
  await page.getByTestId('demo-next').click(); // scene 1
  await expect(page.getByText('yoopi preens on a branch')).toBeVisible();
  await expect(page.getByText('★ keeper')).toBeVisible();
  await page.getByTestId('demo-next').click(); // final cut
  await expect(page.getByTestId('final-cut')).toBeVisible();
  await page.getByTestId('demo-next').click(); // end card
  await expect(page.getByText('gives you a')).toBeVisible();
});
