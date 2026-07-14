import { test, expect } from '@playwright/test';

// The "Finish" editor route: loads the project's video clips into a track, reorder/remove,
// grade + export. Project load and assemble are mocked → deterministic + free.
const PROJECT = {
  id: 'edit-test',
  title: 'Edit Test',
  nodes: [
    { id: 'v1', type: 'recut', position: { x: 0, y: 0 }, data: { kind: 'video', title: 'Shot 1', videoUrl: '/clips/1000.mp4' } },
    { id: 'v2', type: 'recut', position: { x: 0, y: 200 }, data: { kind: 'video', title: 'Shot 2', videoUrl: '/clips/1001.mp4' } },
    { id: 'vo', type: 'recut', position: { x: 0, y: 400 }, data: { kind: 'dialogue', title: 'VO', audioUrl: '/generated/x.wav' } },
  ],
  edges: [],
};

test('film editor loads clips, and export produces a result video', async ({ page }) => {
  await page.route('**/api/projects/edit-test', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROJECT) }));
  await page.route('**/api/assemble', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videoUrl: '/clips/1000.mp4' }) }));

  await page.goto('/project/edit-test/edit');

  // both video clips loaded into the track
  await expect(page.getByTestId('video-track').locator('video')).toHaveCount(2);
  await expect(page.getByText('audio track', { exact: false })).toBeVisible();

  // export → a result video appears
  await page.getByTestId('export-film').click();
  await expect(page.getByTestId('result-video')).toBeVisible();
});
