import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilePayCents, feeCents, isRush, priceGraph, effectiveHourlyCents, reviewPayCents } from '../../src/domain/pricing.js';
import { HOUR } from '../../src/lib/util.js';

test('pay = minutes/60 × tier rate', () => {
  assert.equal(tilePayCents({ estMinutes: 60, tier: 1 }), 2200);
  assert.equal(tilePayCents({ estMinutes: 30, tier: 2 }), 1600);
  assert.equal(tilePayCents({ estMinutes: 90, tier: 3 }), 7500);
  assert.equal(tilePayCents({ estMinutes: 120, tier: 4 }), 16000);
});

test('rush adds 25%', () => {
  assert.equal(tilePayCents({ estMinutes: 60, tier: 2 }, { rush: true }), 4000);
});

test('rush applies when the deadline is under 72 hours away', () => {
  const now = 1_000_000;
  assert.equal(isRush(now + 71 * HOUR, now), true);
  assert.equal(isRush(now + 72 * HOUR, now), false);
});

test('fee is 10% and money stays in integer cents', () => {
  assert.equal(feeCents(3333), 333);
  const p = tilePayCents({ estMinutes: 25, tier: 3 });
  assert.ok(Number.isInteger(p));
});

test('effective hourly rate matches the tier rate', () => {
  for (const tier of [1, 2, 3, 4]) {
    const t = { estMinutes: 45, tier };
    const pay = tilePayCents(t);
    assert.ok(Math.abs(effectiveHourlyCents({ ...t, payCents: pay }) - { 1: 2200, 2: 3200, 3: 5000, 4: 8000 }[tier]) <= 1);
  }
});

test('graph price = pay + 10% fee + review reserve for work tiles', () => {
  const tiles = [
    { key: 'a', kind: 'WORK', tier: 2, estMinutes: 60 },
    { key: 'b', kind: 'REVIEW', tier: 2, estMinutes: 30 },
    { key: 'c', kind: 'INTEGRATION', tier: 3, estMinutes: 60 },
  ];
  const p = priceGraph(tiles);
  assert.equal(p.payTotal, 3200 + 1600 + 5000);
  assert.equal(p.feeTotal, 320 + 160 + 500);
  const reserve = reviewPayCents(2) + feeCents(reviewPayCents(2)) + reviewPayCents(3) + feeCents(reviewPayCents(3));
  assert.equal(p.reserveTotal, reserve);
  assert.equal(p.total, p.payTotal + p.feeTotal + p.reserveTotal);
});
