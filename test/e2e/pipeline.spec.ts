import { test, expect, type Page } from '@playwright/test';

// The Director's Monitor walkthrough: cast (candidates > crown > lock) > draft scenes >
// takes > judge (failing) > one-click taxonomy fix > animate > crown the clip > export.
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
      const payload = judged ? { score: 0.95, verdict: { ...FAIL_VERDICT.verdict, prop_match: 1, framing_match: 0.97 }, spentUsd: 0.5, capUsd: 8 } : FAIL_VERDICT;
      judged = true;
      return route.fulfill({ json: payload });
    }
    if (body.kind === 'video') return route.fulfill({ json: { videoUrl: '/clips/1000.mp4', spentUsd: 0.5, capUsd: 8 } });
    return route.fulfill({ json: { imageUrl: '/takes/1000.png', spentUsd: 0.5, capUsd: 8 } });
  });
  await page.route('**/api/assemble', (r) => r.fulfill({ json: { videoUrl: '/clips/1000.mp4' } }));
}

test('director monitor: cast, script, shots, repair, crown, export', async ({ page }) => {
  await mockModels(page);
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('Monitor e2e');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/\/pipeline/);

  // Cast: batch candidates > crown one > it lands in the rail > lock it IN PLACE
  await page.getByTestId('candidate-prompt').fill('two-panel character sheet of the watchmaker');
  await page.getByTestId('generate-candidates').click();
  await expect(page.locator('[data-testid^=crown-]')).toHaveCount(4, { timeout: 15_000 });
  // iterate affordance exists on candidates
  await expect(page.locator('[data-testid^=iterate-]').first()).toBeVisible();
  await page.locator('[data-testid^=crown-]').first().click();
  await expect(page.locator('[data-testid^=member-]')).toHaveCount(1);
  await expect(page.locator('text=✓ cast')).toBeVisible(); // stage keeps the original
  await page.locator('[data-testid^=lock-]').first().click();
  await expect(page.locator('[data-testid^=member-]').first()).toContainText('Unlock'); // edited in place, no jumping

  // Script: the skill drafts the shots
  await page.getByTestId('step-script').click();
  await page.getByTestId('beats').fill('an old watchmaker closes his shop');
  await page.getByTestId('draft-shotlist').click();
  await expect(page.getByTestId('cell-1A')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('cut-controls')).toBeVisible(); // auto-selected first cut
  await page.getByTestId('cell-2A').click();
  await expect(page.locator('[data-testid=cine-2A] select').first()).toHaveValue('extreme close-up');

  // Takes on 1A: default x2 batch > judge fails > taxonomy fix > new take
  await page.getByTestId('cell-1A').click();
  await page.getByTestId('run-1A').click();
  await expect(page.locator('[data-testid=cut-stage] img')).toHaveCount(2, { timeout: 15_000 });
  await page.locator('[data-testid=cut-stage] button', { hasText: 'judge' }).first().click();
  await expect(page.locator('[data-testid^=diagnosis-]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid^=fix-]').first().click();
  await expect(page.locator('[data-testid=cut-stage] img')).toHaveCount(3, { timeout: 15_000 });

  // Animate (latest frame) > crown the clip > storyboard cell shows the keeper
  await page.getByTestId('animate-1A').click();
  await expect(page.locator('[data-testid=cut-stage] video')).toHaveCount(1, { timeout: 15_000 });
  const videoTake = page.locator('[data-testid^=take-]').filter({ has: page.locator('video') }).first();
  await videoTake.locator('[data-testid^=crown-]').click();
  await expect(page.getByTestId('cell-1A')).toContainText('👑');

  // delete a cut: 2A goes away, storyboard renumbers
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId('cell-2A').click();
  await page.getByTestId('delete-cut-2A').click();
  await expect(page.getByTestId('cell-2A')).toHaveCount(0);

  // Edit: export renders the film
  await page.getByTestId('step-edit').click();
  await expect(page.getByTestId('film-cut')).toBeVisible();
  await page.getByTestId('export-film').click();
  await expect(page.getByTestId('film-result')).toBeVisible({ timeout: 30_000 });
});
