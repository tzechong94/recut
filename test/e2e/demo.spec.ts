import { test, expect } from '@playwright/test';

// The judge demo is the REAL product with a guided tour (?tour=1): coach-marks anchored to
// the actual controls, steering the Monitor through the stages.
const DOC = {
  projectId: 'tour-e2e', rev: 1, stylePrefix: 'soft watercolor',
  script: 'two birds by the river',
  assets: [{ id: 'a1', slug: 'yoopi', kind: 'character', imageUrl: '/takes/1000.png', locked: true }],
  scenes: [{ title: 'Scene 1', prompts: [{ name: '1A', text: 'yoopi preens on a branch', assetSlugs: ['yoopi'] }] }],
  takes: [{ id: 'v1', promptName: '1A', kind: 'video', url: '/clips/1000.mp4', keeper: true }],
};

test('guided tour steers the real Monitor through the stages', async ({ page }) => {
  await page.route('**/api/pipeline/tour-e2e', (r) => r.fulfill({ json: DOC }));
  await page.route('**/api/projects/tour-e2e', (r) => r.fulfill({ json: { id: 'tour-e2e', title: 'Tour Film', createdAt: 0 } }));
  await page.goto('/project/tour-e2e/pipeline?tour=1');
  await expect(page.getByTestId('tour-popup')).toBeVisible();
  await expect(page.getByText('This is Recut')).toBeVisible();

  await page.getByTestId('tour-next').click(); // cast: steers to casting, anchors the rail
  await expect(page.getByText('1 · The cast')).toBeVisible();
  await expect(page.getByTestId('rail')).toBeVisible();

  await page.getByTestId('tour-next').click(); // casting prompt anchor
  await expect(page.getByTestId('candidate-prompt')).toBeVisible();

  await page.getByTestId('tour-next').click(); // script: steers to the script stage
  await expect(page.getByTestId('beats')).toBeVisible();

  await page.getByTestId('tour-next').click(); // storyboard: selects the first cut
  await expect(page.getByText('3 · The storyboard')).toBeVisible();
  await page.getByTestId('tour-next').click(); // cut controls
  await expect(page.getByTestId('cut-controls')).toBeVisible();
  await page.getByTestId('tour-next').click(); // stage
  await page.getByTestId('tour-next').click(); // edit: steers to the timeline
  await expect(page.getByTestId('film-cut')).toBeVisible();
  await page.getByTestId('tour-next').click(); // export anchor
  await page.getByTestId('tour-next').click(); // end card
  await page.getByTestId('tour-next').click(); // Explore ✓ exits
  await expect(page.getByTestId('tour-popup')).toHaveCount(0);
  // the product is fully live after the tour
  await expect(page.getByTestId('cut-controls')).toBeVisible();
});
