import { test, expect, type Page } from '@playwright/test';

// The full three-stage pipeline walkthrough: candidates > board > lock > scenes (skill-drafted)
// > take > judge (failing) > one-click taxonomy fix > animate > keeper > film export.
// Model + assemble calls are mocked (deterministic + free); the pipeline store is real
// (isolated under RECUT_DATA_DIR).

const PLAN = {
  plan: {
    title: 'Watchmaker',
    style: '35mm film grain, desaturated amber palette',
    characters: [{ name: 'Elias', description: 'old watchmaker, wire-rimmed glasses' }],
    shots: [
      { description: 'Elias flips the sign to CLOSED, dusk through the window', characters: ['Elias'], animate: true, dialogue: null, shotSize: 'medium shot', angle: 'eye level', lens: '35mm lens', light: 'natural window light' },
      { description: 'extreme close-up on his hands opening the watch case', characters: ['Elias'], animate: true, dialogue: null, shotSize: 'extreme close-up', angle: 'overhead', lens: '85mm portrait lens', light: 'golden hour' },
    ],
  },
  spentUsd: 0,
};

const FAIL_VERDICT = {
  score: 0.55,
  verdict: {
    identity_match: 0.9, wardrobe_match: 1, prop_match: 0.3, location_match: 0.9, palette_match: 0.9, framing_match: 0.6,
    verdict: 'repair', repair_instruction: 'Lock the watch to the exact reference; recenter.',
  },
  spentUsd: 0.5, capUsd: 8,
};

async function mockModels(page: Page) {
  await page.route('**/api/agent/plan', (r) => r.fulfill({ json: PLAN }));
  let judged = false;
  await page.route('**/api/generate', async (route) => {
    const body = route.request().postDataJSON() as { kind: string };
    if (body.kind === 'critique') {
      // first judgement fails (exercises the taxonomy card), later ones pass
      const payload = judged ? { score: 0.95, verdict: { ...FAIL_VERDICT.verdict, prop_match: 1, framing_match: 0.97 }, spentUsd: 0.5, capUsd: 8 } : FAIL_VERDICT;
      judged = true;
      return route.fulfill({ json: payload });
    }
    if (body.kind === 'video') return route.fulfill({ json: { videoUrl: '/clips/1000.mp4', spentUsd: 0.5, capUsd: 8 } });
    return route.fulfill({ json: { imageUrl: '/takes/1000.png', spentUsd: 0.5, capUsd: 8 } });
  });
  await page.route('**/api/assemble', (r) => r.fulfill({ json: { videoUrl: '/clips/1000.mp4' } }));
}

test('three-stage pipeline: curate, direct, iterate, repair, assemble', async ({ page }) => {
  await mockModels(page);
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Pipeline e2e');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/\/pipeline/);

  // Stage 1: batch candidates > drag one onto the board > lock it
  await page.getByTestId('candidate-prompt').fill('two-panel character sheet of the watchmaker');
  await page.getByTestId('generate-candidates').click();
  await expect(page.locator('[data-testid^=candidate-][draggable]')).toHaveCount(4, { timeout: 15_000 });
  await page.locator('[data-testid^=candidate-][draggable]').first().dragTo(page.getByTestId('board'), { targetPosition: { x: 500, y: 300 } });
  await expect(page.locator('[data-testid^=board-]')).toHaveCount(1);
  await page.locator('[data-testid^=lock-]').first().click();
  await expect(page.locator('[data-testid^=board-]').first()).toContainText('Unlock');

  // Stage 2: skill-drafted scenes arrive with camera presets pre-set
  await page.getByTestId('tab-scenes').click();
  await page.getByTestId('beats').fill('an old watchmaker closes his shop');
  await page.getByTestId('draft-shotlist').click();
  await expect(page.getByTestId('cut-1A')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid=cine-2A] select').first()).toHaveValue('extreme close-up');

  // take > judge fails > taxonomy card with one-click fix
  await page.getByTestId('run-1A').click();
  await expect(page.locator('[data-testid=takes-1A] img')).toHaveCount(1, { timeout: 15_000 });
  await page.locator('[data-testid=takes-1A] button', { hasText: 'Judge' }).click();
  await expect(page.locator('[data-testid^=diagnosis-]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid^=diagnosis-]')).toContainText('prompt'); // layer badge (CSS uppercases visually)
  await page.locator('[data-testid^=fix-]').first().click();
  await expect(page.locator('[data-testid=takes-1A] img')).toHaveCount(2, { timeout: 15_000 });

  // animate the repaired take > it becomes a video take (mocked, instant)
  await page.locator('[data-testid=takes-1A] [title="Animate (i2v)"]').first().click();
  await expect(page.locator('[data-testid=takes-1A] video')).toHaveCount(1, { timeout: 15_000 });

  // Stage 3: film gate opens, export renders the result
  await page.getByTestId('tab-film').click();
  await expect(page.getByTestId('film-cut')).toBeVisible();
  await page.getByTestId('export-film').click();
  await expect(page.getByTestId('film-result')).toBeVisible({ timeout: 30_000 });
});
