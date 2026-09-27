// Shared steps for the end-to-end tests. Actions go through the UI; the tests only read
// state through window.tessera to decide what to do next and to check results.
import { expect } from '@playwright/test';

export async function boot(page, query) {
  await page.goto(query);
  await page.waitForFunction(() => window.tessera && document.querySelector('main h1'));
}

export async function becomePersona(page, name) {
  await page.locator('.persona-btn').click();
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
  await expect(page.locator('.persona-btn')).toContainText(name.split(' ')[0]);
}

export async function waitIdle(page) {
  await page.waitForFunction(() => {
    const T = window.tessera;
    return T && !T.db.filter('Job', (j) => j.status === 'PENDING' || j.status === 'RUNNING').length;
  }, null, { timeout: 60000 });
}

export async function postExampleAndFund(page, example = 'flyer') {
  await page.goto(`#/post?example=${example}`);
  await page.getByRole('button', { name: 'Post commission' }).click();
  await page.getByRole('button', { name: 'Use all suggested answers' }).click();
  await page.getByRole('button', { name: /Send answers/ }).click();
  await page.getByRole('button', { name: /Approve and fund/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Fund / }).click();
  await expect(page.getByRole('heading', { name: 'The mosaic' })).toBeVisible();
  return page.evaluate(() => location.hash.split('/')[2]);
}

/** Does the held tile in the workspace: a peer review, or brief + sample work + submit. */
export async function doHeldTile(page) {
  const markAll = page.getByRole('button', { name: 'Mark all pass (demo)' });
  const brief = page.getByRole('button', { name: 'Write my brief' });
  await expect(markAll.or(brief)).toBeVisible();
  if (await markAll.isVisible()) {
    await markAll.click();
    await page.getByRole('button', { name: 'Submit review' }).click();
    return 'review';
  }
  await brief.click();
  await expect(page.getByRole('heading', { name: 'Checklist' })).toBeVisible();
  await page.getByRole('button', { name: /Fill with sample work/ }).click();
  await page.getByRole('button', { name: /^Submit \d/ }).click();
  await expect(page.getByRole('heading', { name: 'Being checked' }).or(page.getByText('Round 1 didn’t pass'))).toBeVisible();
  return 'work';
}
