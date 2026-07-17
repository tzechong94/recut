import { test, expect } from '@playwright/test';

// The judge demo is a SIMULATED live session on the real product: starts empty, types the
// prompts into the real inputs, fakes generation, reveals the pre-made media step by step.
const DOC = {
  projectId: 'tour-e2e', rev: 1, stylePrefix: 'soft watercolor',
  script: 'two birds by the river',
  assets: [{ id: 'a1', slug: 'yoopi', kind: 'character', imageUrl: '/takes/1000.png', locked: true }],
  scenes: [{ title: 'Scene 1', prompts: [{ name: '1A', text: 'yoopi preens on a branch', assetSlugs: ['yoopi'] }] }],
  takes: [{ id: 'v1', promptName: '1A', kind: 'video', url: '/clips/1000.mp4', keeper: true }],
};

test('the tour replays the making of the film on the live UI', async ({ page }) => {
  await page.route('**/api/pipeline/tour-e2e', (r) => r.fulfill({ json: DOC }));
  await page.route('**/api/projects/tour-e2e', (r) => r.fulfill({ json: { id: 'tour-e2e', title: 'Tour Film', createdAt: 0 } }));
  await page.goto('/project/tour-e2e/pipeline?tour=1');
  await expect(page.getByTestId('tour-popup')).toBeVisible();
  await expect(page.getByText('This is Recut, live')).toBeVisible();
  // the stage was stripped bare: no cast in the rail yet
  await expect(page.locator('[data-testid^=member-]')).toHaveCount(0);

  await page.getByTestId('tour-next').click(); // -> casting step
  await expect(page.getByText('Casting: yoopi')).toBeVisible();
  await page.getByTestId('tour-next').click(); // types the prompt, fakes generation, reveals the member
  await expect(page.locator('[data-testid^=member-]')).toHaveCount(1, { timeout: 15_000 });

  await expect(page.getByRole('heading', { name: 'The script' })).toBeVisible();
  await page.getByTestId('tour-next').click(); // types the script, drafts the shots
  await expect(page.getByTestId('cell-1A')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('tour-next').click(); // storyboard -> shooting step
  await expect(page.getByText('Shooting 1A')).toBeVisible();
  await expect(page.locator('[data-testid=cut-stage] video')).toHaveCount(0); // not shot yet
  await page.getByTestId('tour-next').click(); // fake-render reveals the clip
  await expect(page.locator('[data-testid=cut-stage] video')).toHaveCount(1, { timeout: 15_000 });

  await page.getByTestId('tour-next').click(); // edit
  await expect(page.getByTestId('film-cut')).toBeVisible();
  await page.getByTestId('tour-next').click(); // export anchor
  await page.getByTestId('tour-next').click(); // end card restores the full project
  await page.getByTestId('tour-next').click(); // Explore ✓
  await expect(page.getByTestId('tour-popup')).toHaveCount(0);
  await expect(page.getByTestId('export-stage')).toBeVisible();
});
