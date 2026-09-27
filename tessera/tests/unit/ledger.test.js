import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fundingEntry, acceptanceEntries, partialPayEntries, refundEntry, commissionBalance, userEarnings, findOverdraw, platformRevenue } from '../../src/domain/ledger.js';
import { priceGraph, feeCents } from '../../src/domain/pricing.js';
import { prng } from '../../src/lib/util.js';

test('acceptance pays the contributor and the fee out of escrow', () => {
  const tile = { id: 't1', kind: 'WORK', payCents: 3200, title: 'x' };
  const [pay, fee] = acceptanceEntries({ commissionId: 'c', tile, contributorId: 'u' });
  assert.equal(pay.type, 'TILE_PAYOUT');
  assert.equal(pay.amountCents, -3200);
  assert.equal(fee.type, 'PLATFORM_FEE');
  assert.equal(fee.amountCents, -320);
});

test('review tiles pay out as REVIEW_PAYOUT', () => {
  const [pay] = acceptanceEntries({ commissionId: 'c', tile: { id: 'r', kind: 'REVIEW', payCents: 800, title: 'r' }, contributorId: 'u' });
  assert.equal(pay.type, 'REVIEW_PAYOUT');
});

test('partial pay cannot exceed full pay', () => {
  assert.throws(() => partialPayEntries({ commissionId: 'c', tile: { id: 't', payCents: 1000, title: 't' }, contributorId: 'u', amountCents: 1001 }));
});

test('amounts must be integer cents', () => {
  assert.throws(() => fundingEntry({ commissionId: 'c', funderId: 'r', amountCents: 10.5 }));
});

// Property test: random commissions, random outcomes. Escrow in must equal payouts, fees
// and refunds out, and no prefix of the ledger may take the escrow below zero.
test('property: every commission ledger nets to zero and never overdraws', () => {
  const rnd = prng('ledger-property');
  for (let run = 0; run < 400; run++) {
    const n = 1 + Math.floor(rnd() * 12);
    const tiles = Array.from({ length: n }, (_, i) => ({
      id: `t${i}`, key: `t${i}`, title: `t${i}`, kind: rnd() < 0.15 ? 'REVIEW' : rnd() < 0.1 ? 'INTEGRATION' : 'WORK',
      tier: 1 + Math.floor(rnd() * 4), estMinutes: 15 + Math.floor(rnd() * 106),
    }));
    const rush = rnd() < 0.3;
    const priced = priceGraph(tiles, { rush });
    const entries = [];
    let t = 0;
    const post = (es) => { for (const e of [].concat(es)) if (e) entries.push({ ...e, createdAt: t++ }); };
    post(fundingEntry({ commissionId: 'c', funderId: 'req', amountCents: priced.total }));
    let reserveLeft = priced.reserveTotal;
    for (const [i, tile] of tiles.entries()) {
      const pay = priced.lines[i].pay;
      const outcome = rnd();
      if (outcome < 0.1) continue; // cancelled
      if (outcome < 0.2) {
        // partial pay to a first contributor, funded by a top-up, then a second contributor finishes it
        const partial = 1 + Math.floor(rnd() * pay);
        post(fundingEntry({ commissionId: 'c', funderId: 'req', amountCents: partial + feeCents(partial) }));
        post(partialPayEntries({ commissionId: 'c', tile: { ...tile, payCents: pay }, contributorId: 'u1', amountCents: partial }));
      }
      if (tile.kind !== 'REVIEW' && rnd() < 0.6) {
        const rp = priced.lines[i].reserve;
        const need = rp + feeCents(rp);
        if (need > reserveLeft) { post(fundingEntry({ commissionId: 'c', funderId: 'req', amountCents: need - reserveLeft })); reserveLeft = need; }
        post(acceptanceEntries({ commissionId: 'c', tile: { ...tile, kind: 'REVIEW', payCents: rp }, contributorId: 'rev' }));
        reserveLeft -= need;
      }
      post(acceptanceEntries({ commissionId: 'c', tile: { ...tile, payCents: pay }, contributorId: 'u2' }));
    }
    assert.equal(findOverdraw(entries, 'c'), null, `run ${run} overdrew`);
    post(refundEntry({ commissionId: 'c', requesterId: 'req', amountCents: commissionBalance(entries, 'c') }));
    assert.equal(commissionBalance(entries, 'c'), 0, `run ${run} did not net to zero`);
    const funded = entries.filter((e) => e.type === 'ESCROW_FUND').reduce((a, e) => a + e.amountCents, 0);
    const out = -entries.filter((e) => e.type !== 'ESCROW_FUND').reduce((a, e) => a + e.amountCents, 0);
    assert.equal(funded, out);
    assert.equal(userEarnings(entries, 'u2') + userEarnings(entries, 'u1') + userEarnings(entries, 'rev') + platformRevenue(entries) + -entries.filter((e) => e.type === 'REFUND').reduce((a, e) => a + e.amountCents, 0), funded);
  }
});
