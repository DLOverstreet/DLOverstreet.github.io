// The breakdown tool: any job splits into separable tiles, can be edited in place, and
// posts straight to a commission's approval step.
import { test, expect } from '@playwright/test';
import { boot, becomePersona } from './helpers.js';

test('switching persona from the header keeps the last breakdown', async ({ page }) => {
  await boot(page, '#/breakdown?example=gala');
  await expect(page.getByRole('heading', { name: 'The split' })).toBeVisible();
  await becomePersona(page, 'Tom');
  await page.getByRole('link', { name: 'Break down a job' }).first().click();
  await expect(page.getByRole('heading', { name: 'The split' })).toBeVisible();
  await expect(page.locator('#bd-goal')).toHaveValue(/spring gala/);
});

test('a visitor breaks down a job, edits the split and posts it as a commission', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page, '#/');
  await page.getByRole('link', { name: 'Break down a job' }).first().click();
  await expect(page.getByRole('heading', { name: 'Break down any job' })).toBeVisible();

  await page.getByRole('button', { name: 'Podcast season' }).click();
  await expect(page.getByRole('heading', { name: 'The split' })).toBeVisible();
  await expect(page.getByText(/Separability A/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who works when' })).toBeVisible();
  await expect(page.locator('.coverage li.ok')).toHaveCount(6);

  // Your own job, typed in.
  await page.locator('#bd-goal').fill('Translate our 12-page tenant rights guide into Spanish and Arabic, and design a printable one-page summary for each language.');
  await page.getByRole('button', { name: 'Break it down' }).click();
  await expect(page.locator('.reading li')).not.toHaveCount(0);
  await expect(page.getByText(/Spanish, Arabic/)).toBeVisible();

  // Split a tile, then post the edited plan.
  await page.getByRole('button', { name: 'Spring gala' }).click();
  const tilesBefore = Number(await page.locator('.stats .stat .v').first().textContent());
  await page.getByRole('button', { name: 'Design invitations' }).first().click();
  await page.getByRole('button', { name: 'Split in two' }).click();
  await expect(page.locator('.stats .stat .v').first()).toHaveText(String(tilesBefore + 1));
  await expect(page.getByText('Edited', { exact: true })).toBeVisible();

  // Posting needs a requester; the dialog offers to switch without leaving the page.
  await page.getByRole('button', { name: 'Post as a commission' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Be Marisol' }).click();
  await page.getByRole('button', { name: 'Post as a commission' }).click();
  await page.getByRole('button', { name: 'Post with this plan' }).click();
  await expect(page).toHaveURL(/#\/c\/com_[^/]+\/plan/);
  await expect(page.getByRole('heading', { name: 'Proposed plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How the job reads' })).toBeVisible();
  const n = await page.evaluate(() => window.tessera.db.filter('Tile', (t) => t.commissionId === location.hash.split('/')[2]).length);
  expect(n).toBe(tilesBefore + 1);
  expect(errors).toEqual([]);
});
