import { test, expect, type Page } from '@playwright/test';

const CANNED_GRAPH = {
  graph: {
    title: 'Test Film',
    nodes: [
      { key: 'c0', kind: 'text2image', prompt: 'a weathered keeper', name: 'Elias', x: 40, y: 80, inputs: [], note: 'Cast Elias' },
      { key: 's0', kind: 'edit', prompt: 'Elias lights the lamp, MS', x: 420, y: 60, inputs: ['c0'], note: 'Shot 1: Elias lights the lamp' },
      { key: 'v0', kind: 'video', prompt: 'gentle push-in', x: 800, y: 60, inputs: ['s0'], note: 'Animate shot 1' },
    ],
    edges: [{ from: 'c0', to: 's0' }, { from: 's0', to: 'v0' }],
  },
  spentUsd: 0,
};

async function mockEndpoints(page: Page) {
  await page.route('**/api/agent/plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANNED_GRAPH) }));
  await page.route('**/api/generate', async (route) => {
    const body = route.request().postDataJSON() as { kind: string };
    const payload = body.kind === 'video' ? { videoUrl: '/clips/1000.mp4' } : { imageUrl: '/takes/1000.png' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...payload, spentUsd: 0.5, capUsd: 8 }) });
  });
}

test('showrun step-mode: confirm/edit each step, it generates, then advances', async ({ page }) => {
  await mockEndpoints(page);
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Showrun test');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/\/project\//);

  await page.getByTestId('premise').fill('a lighthouse keeper');
  await page.getByTestId('showrun').click();

  const proposal = page.getByTestId('proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Cast Elias');

  await page.getByTestId('approve-step').click(); // approves + generates cast
  await expect(page.getByText('Text → Image').first()).toBeVisible();

  await expect(proposal).toContainText('Shot 1');
  await page.getByTestId('approve-step').click();
  await expect(page.getByText('Edit', { exact: true }).first()).toBeVisible();

  await page.getByTestId('approve-step').click(); // video
  await expect(page.getByText('Image → Video').first()).toBeVisible();
  await expect(proposal).toBeHidden();
});

test('fully autonomous: builds AND generates the whole graph', async ({ page }) => {
  await mockEndpoints(page);
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Auto test');
  await page.getByTestId('create-project').click();
  await page.getByTestId('premise').fill('a lighthouse keeper');
  await page.getByTestId('autonomous').check();
  await page.getByTestId('showrun').click();

  await expect(page.getByText('Text → Image').first()).toBeVisible();
  await expect(page.getByText('Image → Video').first()).toBeVisible();
  await expect(page.getByTestId('proposal')).toBeHidden();
  // it auto-generated → spend updated
  await expect(page.getByTestId('spend')).toContainText('$0.500 / $8');
});
