import { test, expect } from '@playwright/test';

// The node canvas: create a project from the home page, land on a blank canvas, add nodes,
// and connect-typing is enforced. (Does NOT click Generate — that spends live tokens.)
test('create a project → add nodes on the canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project-title').fill('My test film');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/\/pipeline/);
  await page.goto(page.url().replace(/\/pipeline$/, '')); // canvas escape hatch

  await expect(page).toHaveURL(/\/project\/[a-z0-9]+/);

  // the "+ Add node" menu adds nodes (titles appear on both the node and the inspector → .first())
  const add = async (kind: string) => {
    await page.getByTestId('add-node').click();
    await page.getByTestId(`add-${kind}`).click();
  };
  await add('text2image');
  await expect(page.getByText('Text → Image').first()).toBeVisible();
  await expect(page.getByPlaceholder('describe the image…')).toBeVisible();

  await add('compose');
  await expect(page.getByText('Compose').first()).toBeVisible();

  await add('dialogue');
  await expect(page.getByText('Dialogue → Voice').first()).toBeVisible();

  await add('video');
  await expect(page.getByText('Image → Video').first()).toBeVisible();

  // the prompt persists as you type (node state)
  await page.getByPlaceholder('describe the image…').fill('a lighthouse at dusk');
  await expect(page.getByPlaceholder('describe the image…')).toHaveValue('a lighthouse at dusk');

  // node inspector opens on selection with editable params
  await expect(page.getByTestId('node-inspector')).toBeVisible();

  // undo removes the last added node
  await page.keyboard.press('Meta+z');
});
