// M6 acceptance: a visitor with no account posts a commission and completes a tile in
// under ten minutes, then signs off, exports a signed record and verifies it against the
// published key. The crowd simulation does the other tiles.
import { test, expect } from '@playwright/test';

test('a visitor runs the guided demo end to end in under ten minutes', async ({ page }) => {
  const started = Date.now();
  await page.goto('?reset=1&fast=1');
  await page.getByRole('button', { name: /Start the guided demo/ }).click();
  await page.getByRole('button', { name: 'Post commission' }).click();
  await page.getByRole('button', { name: 'Use all suggested answers' }).click();
  await page.getByRole('button', { name: /Send answers/ }).click();
  await page.getByRole('button', { name: /Approve and fund/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Fund / }).click();

  const guide = page.locator('.guide');
  await guide.getByRole('button', { name: /^Be / }).click();
  await page.getByRole('button', { name: 'Accept and claim' }).first().click();
  const tileId = await page.evaluate(() => location.hash.split('/')[2]);
  await page.getByRole('button', { name: 'Write my brief' }).click();
  await expect(page.getByRole('heading', { name: 'Checklist' })).toBeVisible();
  await page.getByRole('button', { name: /Fill with sample work/ }).click();
  await page.getByRole('button', { name: /^Submit \d/ }).click();
  await page.waitForFunction((id) => window.tessera.db.get('Tile', id).status === 'ACCEPTED', tileId, { timeout: 120000 });
  const tileDone = Date.now() - started;
  expect(tileDone).toBeLessThan(10 * 60 * 1000);

  // As the guide says: switch back to the requester and let the crowd finish the other tiles.
  const cid = await page.evaluate(() => window.tessera.db.meta.guide.commissionId);
  await expect(guide).toContainText('Sign off as the requester');
  await guide.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.persona-btn')).toContainText('Tom');
  await page.waitForFunction((id) => window.tessera.db.get('Commission', id).status === 'DELIVERED', cid, { timeout: 8 * 60 * 1000 });
  await guide.getByRole('button', { name: 'Go' }).click();
  await page.getByRole('button', { name: 'Accept delivery' }).click();
  await expect.poll(() => page.evaluate((id) => window.tessera.db.get('Commission', id).status, cid)).toBe('ACCEPTED');

  await guide.getByRole('button', { name: 'Go' }).click();
  await page.getByRole('button', { name: 'Export signed record' }).click();
  await page.getByRole('button', { name: 'Verify it now' }).click();
  await page.getByRole('radio', { name: /This instance’s published key/ }).check();
  await page.getByRole('button', { name: 'Verify signature' }).click();
  await expect(page.getByRole('heading', { name: '✓ Valid' })).toBeVisible();

  // Tampering breaks it.
  const text = await page.locator('#rec').inputValue();
  await page.locator('#rec').fill(text.replace(/"accepted": (\d+)/, (m, n) => `"accepted": ${Number(n) + 5}`));
  await page.getByRole('button', { name: 'Verify signature' }).click();
  await expect(page.getByRole('heading', { name: '✗ Not valid' })).toBeVisible();
  console.log(`tile completed after ${(tileDone / 1000).toFixed(1)}s; whole loop ${((Date.now() - started) / 1000).toFixed(1)}s`);
});
