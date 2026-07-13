import { test, expect } from '@playwright/test';

// Sprint 2 exit gate: dragging a rig control changes the compiled prompt text (the demo
// money shot — cinematography vocabulary appears from control state, live, no server call).
test('rig: changing focal length re-compiles the prompt and detected shot size', async ({ page }) => {
  await page.goto('/rig');

  const sentence = page.getByTestId('compiled-sentence');
  const shotSize = page.getByTestId('d-shotsize');
  const before = await sentence.textContent();
  const sizeBefore = await shotSize.textContent();

  // long lens → tighter framing. Set focal to 200mm via the range input.
  const focal = page.getByTestId('cam-focal');
  await focal.fill('200');
  await focal.dispatchEvent('input');

  await expect(page.getByTestId('cam-focal-val')).toHaveText('200mm');
  await expect(sentence).not.toHaveText(before ?? '');
  // tighter lens moves the detected shot size toward a closer size
  await expect(shotSize).not.toHaveText(sizeBefore ?? '');
  await expect(sentence).toContainText('200mm');

  // moving the key light changes the detected lighting setup
  const setup = page.getByTestId('d-setup');
  const setupBefore = await setup.textContent();
  const keyAz = page.getByTestId('key-azimuth');
  await keyAz.fill('90');
  await keyAz.dispatchEvent('input');
  await expect(setup).not.toHaveText(setupBefore ?? '');
  await expect(setup).toHaveText('split');
});
