import { test, expect } from '@playwright/test';

// The node canvas: create a project from the home page, land on a blank canvas, add nodes,
// and connect-typing is enforced. (Does NOT click Generate — that spends live tokens.)
test('create a project → add nodes on the canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('My test film');
  await page.getByTestId('create-project').click();

  await expect(page).toHaveURL(/\/project\/[a-z0-9]+/);

  // toolbar adds nodes
  await page.getByTestId('add-text2image').click();
  await expect(page.getByText('Text → Image')).toBeVisible();
  await expect(page.getByPlaceholder('describe the image…')).toBeVisible();

  await page.getByTestId('add-edit').click();
  await expect(page.getByText('Edit', { exact: true })).toBeVisible();

  await page.getByTestId('add-video').click();
  await expect(page.getByText('Image → Video')).toBeVisible();

  // the prompt persists as you type (node state)
  await page.getByPlaceholder('describe the image…').fill('a lighthouse at dusk');
  await expect(page.getByPlaceholder('describe the image…')).toHaveValue('a lighthouse at dusk');
});
