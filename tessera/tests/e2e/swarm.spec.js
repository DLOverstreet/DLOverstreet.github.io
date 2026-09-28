// The agent swarm: a visitor writes a job and hands it over; agents do every step after
// that, and the visitor gets back the deliverable and a list of what a person must still do.
import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

test('a visitor hands a job to the agent swarm and gets it back done, with the steps left for a person', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page, '#/');
  await page.getByRole('link', { name: 'Hand a job to the agent swarm' }).first().click();
  await expect(page.getByRole('heading', { name: 'Hand a job to the agent swarm' })).toBeVisible();
  await expect(page.getByText(/No model connected/)).toBeVisible();
  await page.getByRole('button', { name: 'Market research' }).click();
  await expect(page.locator('#sw-goal')).toHaveValue(/coffee cart/);
  await page.getByRole('button', { name: 'Hand it to the swarm' }).click();

  await expect(page).toHaveURL(/#\/c\/[^/]+\/swarm/);
  await expect(page.getByRole('heading', { name: 'Agents at work' })).toBeVisible();
  await expect(page.getByText('Swarm running', { exact: true })).toBeVisible();
  await expect(page.getByText('Signed off', { exact: true }).first()).toBeVisible({ timeout: 240000 });

  // Every tile was done by an agent, and the job says what a person still has to do.
  const tiles = await page.evaluate(() => {
    const T = window.tessera;
    const c = T.db.filter('Commission', (x) => x.workforce === 'agents')[0];
    return T.db.filter('Tile', (t) => t.commissionId === c.id).map((t) => ({ status: t.status, agent: !!T.db.get('User', t.claimedById)?.isAgent }));
  });
  expect(tiles.length).toBeGreaterThan(3);
  expect(tiles.every((t) => t.status === 'ACCEPTED' && t.agent)).toBe(true);
  await expect(page.getByRole('heading', { name: 'What a person still needs to do' })).toBeVisible();
  await expect(page.getByText(/outreach kit/i).first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the deliverable' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(page.getByText(/Done by Tessera’s agent swarm/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('a split from the breakdown tool runs with agents straight away', async ({ page }) => {
  await boot(page, '#/breakdown?example=grant');
  await expect(page.getByRole('heading', { name: 'The split' })).toBeVisible();
  await page.getByRole('button', { name: 'Run it with agents' }).click();
  await expect(page).toHaveURL(/#\/c\/[^/]+\/swarm/);
  await expect(page.getByText('Signed off', { exact: true }).first()).toBeVisible({ timeout: 240000 });
  await expect(page.locator('.persona-btn')).toContainText(/Marisol|Tom/);
});
