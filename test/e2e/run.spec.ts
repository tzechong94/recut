import { test, expect } from '@playwright/test';

const CANNED_GRAPH = {
  graph: {
    title: 'Run Test',
    nodes: [
      { key: 'c0', kind: 'text2image', prompt: 'a keeper', name: 'Elias', x: 40, y: 80, inputs: [], note: 'Cast' },
      { key: 's0', kind: 'edit', prompt: 'the shot', x: 420, y: 60, inputs: ['c0'], note: 'Shot' },
      { key: 'v0', kind: 'video', prompt: 'motion', x: 800, y: 60, inputs: ['s0'], note: 'Animate' },
    ],
    edges: [{ from: 'c0', to: 's0' }, { from: 's0', to: 'v0' }],
  },
};

test('run all executes the wired graph in order and updates the budget bar', async ({ page }) => {
  await page.route('**/api/agent/plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANNED_GRAPH) }));
  await page.route('**/api/generate', async (route) => {
    const body = route.request().postDataJSON() as { kind: string };
    const payload = body.kind === 'video' ? { videoUrl: '/clips/1000.mp4' } : { imageUrl: '/takes/1000.png' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...payload, spentUsd: 0.5, capUsd: 8 }) });
  });

  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Run test');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/\/pipeline/);
  await page.goto(page.url().replace(/\/pipeline$/, '')); // canvas escape hatch
  await page.getByTestId('premise').fill('a keeper');
  await page.getByTestId('autonomous').check(); // Agent mode: builds AND auto-runs the graph
  await page.getByTestId('showrun').click();

  // agent mode builds the graph then generates it autonomously (no manual run-all)
  await expect(page.getByText('Text → Image').first()).toBeVisible();
  // budget bar reflects the auto-run
  await expect(page.getByTestId('spend')).toContainText('$0.500 / $8');
  // the video node produced a clip (last in the chain ran)
  await expect(page.locator('video').first()).toBeVisible();
});
