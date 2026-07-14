import { test, expect } from '@playwright/test';

// The showrunner builds the graph from a premise. We mock the (live) plan endpoint so the test
// is deterministic + free, and verify the step-by-step approval flow places nodes on the canvas.
const CANNED_GRAPH = {
  graph: {
    title: 'Test Film',
    nodes: [
      { key: 'c0', kind: 'text2image', prompt: 'a weathered keeper', name: 'Elias', x: 40, y: 80, inputs: [], note: 'Cast Elias' },
      { key: 's0', kind: 'edit', prompt: 'Elias lights the lamp, MS', x: 420, y: 60, inputs: ['c0'], note: 'Shot 1: Elias lights the lamp' },
      { key: 'v0', kind: 'video', prompt: 'gentle push-in', x: 800, y: 60, inputs: ['s0'], note: 'Animate shot 1' },
    ],
    edges: [
      { from: 'c0', to: 's0' },
      { from: 's0', to: 'v0' },
    ],
  },
  spentUsd: 0,
};

test('showrun step-mode: proposals approve onto the canvas', async ({ page }) => {
  await page.route('**/api/agent/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANNED_GRAPH) }));

  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Showrun test');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/\/project\//);

  await page.getByTestId('premise').fill('a lighthouse keeper');
  await page.getByTestId('showrun').click();

  // step 1 proposal appears (autonomous unchecked → step mode)
  const proposal = page.getByTestId('proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Cast Elias');

  await page.getByTestId('approve-step').click(); // cast
  await expect(page.getByText('Text → Image').first()).toBeVisible();

  await expect(proposal).toContainText('Shot 1');
  await page.getByTestId('approve-step').click(); // shot (edit)
  await expect(page.getByText('Edit', { exact: true }).first()).toBeVisible();

  await page.getByTestId('approve-step').click(); // video
  await expect(page.getByText('Image → Video').first()).toBeVisible();

  // queue done → proposal closes
  await expect(proposal).toBeHidden();
});

test('showrun autonomous: builds the whole graph at once', async ({ page }) => {
  await page.route('**/api/agent/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANNED_GRAPH) }));
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Auto test');
  await page.getByTestId('create-project').click();
  await page.getByTestId('premise').fill('a lighthouse keeper');
  await page.getByTestId('autonomous').check();
  await page.getByTestId('showrun').click();

  // all three nodes appear without stepping
  await expect(page.getByText('Text → Image').first()).toBeVisible();
  await expect(page.getByText('Edit', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Image → Video').first()).toBeVisible();
  await expect(page.getByTestId('proposal')).toBeHidden();
});
