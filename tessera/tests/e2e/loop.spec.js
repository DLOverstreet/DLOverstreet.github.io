// M4/M5 acceptance: a requester and three contributors run every tile to payout, and the
// commission reaches ACCEPTED on the mock provider, all through the UI with the crowd off.
import { test, expect } from '@playwright/test';
import { boot, becomePersona, waitIdle, postExampleAndFund, doHeldTile } from './helpers.js';

test('a requester and three contributors take every tile to payout and sign-off', async ({ page }) => {
  await boot(page, '?reset=1&crowd=off&fast=1&seed=e2e-loop');
  await becomePersona(page, 'Tom Adeyemi');
  const cid = await postExampleAndFund(page, 'flyer');
  const people = new Map();

  for (let step = 0; step < 60; step++) {
    await waitIdle(page);
    const s = await page.evaluate((id) => {
      const T = window.tessera;
      const db = T.db;
      const tiles = db.filter('Tile', (t) => t.commissionId === id);
      const offers = db.filter('Offer', (o) => o.commissionId === id && o.response === 'PENDING').map((o) => ({ tileId: o.tileId, who: o.contributorId, name: db.get('User', o.contributorId).name }));
      const stalled = tiles.find((t) => t.status === 'IN_REVIEW' && t.pendingReviewTileId && db.get('Tile', t.pendingReviewTileId).status === 'OPEN');
      return { status: db.get('Commission', id).status, offers, stalled: stalled && stalled.id };
    }, cid);
    if (s.status === 'DELIVERED') break;
    if (s.offers.length) {
      // Spread the work: take the offer held by whoever has done the least so far.
      s.offers.sort((a, b) => (people.get(a.who) || 0) - (people.get(b.who) || 0) || a.who.localeCompare(b.who));
      const o = s.offers[0];
      await becomePersona(page, o.name);
      await page.goto(`#/t/${o.tileId}`);
      await page.getByRole('button', { name: 'Accept and claim' }).first().click();
      const kind = await doHeldTile(page);
      if (kind === 'work') people.set(o.who, (people.get(o.who) || 0) + 1);
      continue;
    }
    if (s.stalled) {
      await becomePersona(page, 'Tom Adeyemi');
      await page.goto(`#/t/${s.stalled}`);
      await page.getByText('Review it myself').click();
      await page.getByRole('button', { name: 'Mark all pass (demo)' }).click();
      await page.getByRole('button', { name: 'Record my verdict' }).click();
      continue;
    }
    // A tile back in revision: its holder resubmits.
    const rev = await page.evaluate((id) => { const db = window.tessera.db; const t = db.find('Tile', (x) => x.commissionId === id && x.status === 'REVISION'); return t && { id: t.id, name: db.get('User', t.claimedById).name }; }, cid);
    if (rev) { await becomePersona(page, rev.name); await page.goto(`#/t/${rev.id}`); await doHeldTile(page); continue; }
    throw new Error(`Stuck: ${JSON.stringify(s)}`);
  }

  await becomePersona(page, 'Tom Adeyemi');
  await page.goto(`#/c/${cid}/delivery`);
  await expect(page.getByRole('heading', { name: 'Credits manifest' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept delivery' }).click();
  await expect(page.locator('.callout.good', { hasText: 'Every contributor was paid' })).toBeVisible();

  const result = await page.evaluate((id) => {
    const db = window.tessera.db;
    const c = db.get('Commission', id);
    const tiles = db.filter('Tile', (t) => t.commissionId === id && !t.dynamic);
    const ledger = db.filter('LedgerEntry', (e) => e.commissionId === id);
    return {
      status: c.status,
      balance: ledger.reduce((n, e) => n + e.amountCents, 0),
      allAccepted: tiles.every((t) => t.status === 'ACCEPTED'),
      paidEveryTile: tiles.every((t) => ledger.some((e) => e.tileId === t.id && ['TILE_PAYOUT', 'REVIEW_PAYOUT'].includes(e.type) && e.userId === t.claimedById && -e.amountCents === t.payCents)),
      manifestCoversAll: tiles.every((t) => c.delivery.manifest.some((m) => m.tileKey === t.key && m.contributorId === t.claimedById)),
      workers: [...new Set(tiles.map((t) => t.claimedById))].length,
    };
  }, cid);
  expect(result).toEqual({ status: 'ACCEPTED', balance: 0, allAccepted: true, paidEveryTile: true, manifestCoversAll: true, workers: result.workers });
  expect(result.workers).toBeGreaterThanOrEqual(3);
});
