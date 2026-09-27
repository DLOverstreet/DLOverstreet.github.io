import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEligibility, scoreCandidate, rankCandidates, claimLockMs } from '../../src/domain/matching.js';
import { summarizeReputation } from '../../src/domain/reputation.js';
import { HOUR, DAY } from '../../src/lib/util.js';

const NOW = Date.UTC(2026, 9, 1, 16, 0, 0); // a Thursday
const allDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '00:00', end: '23:59' }));
const rep0 = summarizeReputation([], 'x', NOW);

function cand(id, over = {}) {
  return {
    user: { id, isContributor: true },
    profile: { skills: [{ tag: 'python', selfLevel: 4 }], languages: ['en'], timezone: 'UTC', availability: allDay, weeklyHoursCap: 10, payFloorCents: 2000, ...over },
    rep: rep0, committedMinutes: 0, earnings7d: 0,
  };
}
const tile = { id: 't', kind: 'WORK', skillTags: ['python'], tier: 2, estMinutes: 60, payCents: 3200, languages: [] };
const ctx = { now: NOW, commission: { requesterId: 'req', language: 'en' }, excludeUserIds: new Set(), medianEarnings7d: 0 };

test('pay floor is a hard filter', () => {
  assert.equal(checkEligibility(tile, cand('a', { payFloorCents: 3200 }), ctx).eligible, true);
  const r = checkEligibility(tile, cand('a', { payFloorCents: 3300 }), ctx);
  assert.equal(r.eligible, false);
  assert.equal(r.reasons[0].code, 'below-floor');
});

test('the platform floor applies even when a contributor sets none', () => {
  const cheap = { ...tile, payCents: 1500 }; // $15/h
  assert.equal(checkEligibility(cheap, cand('a', { payFloorCents: 0 }), ctx).reasons[0].code, 'below-floor');
});

test('needs a listed skill, a shared language, availability and room under the cap', () => {
  assert.equal(checkEligibility(tile, cand('a', { skills: [{ tag: 'r', selfLevel: 5 }] }), ctx).reasons[0].code, 'no-skill');
  assert.equal(checkEligibility({ ...tile, languages: ['es'] }, cand('a'), ctx).reasons[0].code, 'language');
  assert.equal(checkEligibility(tile, cand('a', { availability: [] }), ctx).reasons[0].code, 'no-availability');
  const busy = { ...cand('a'), committedMinutes: 580 };
  assert.equal(checkEligibility(tile, busy, ctx).reasons[0].code, 'over-cap');
});

test('requesters are never offered their own tiles', () => {
  assert.equal(checkEligibility(tile, cand('req'), ctx).reasons[0].code, 'own-commission');
});

test('score follows 0.45S + 0.25R + 0.15A + 0.10F + 0.05G', () => {
  const s = scoreCandidate(tile, cand('a'), ctx);
  // S = 4/5, R = 0.5 (new contributor), A = 1, F = 1 (median 0, earned 0), G = 0 (tier 2 is not one above tier 0)
  assert.deepEqual(s.breakdown, { S: 0.8, R: 0.5, A: 1, F: 1, G: 0 });
  assert.equal(s.score, Math.round((0.45 * 0.8 + 0.25 * 0.5 + 0.15 + 0.1) * 1000) / 1000);
  const g = scoreCandidate({ ...tile, tier: 1 }, cand('a'), ctx);
  assert.equal(g.breakdown.G, 1);
});

test('fair rotation favors people who have earned less than the median', () => {
  const rich = { ...cand('a'), earnings7d: 20000 };
  const poor = { ...cand('b'), earnings7d: 0 };
  const c2 = { ...ctx, medianEarnings7d: 10000 };
  assert.equal(scoreCandidate(tile, rich, c2).breakdown.F, 0);
  assert.equal(scoreCandidate(tile, poor, c2).breakdown.F, 1);
});

test('accepting less money cannot raise a score: pay is not an input', () => {
  const a = scoreCandidate(tile, cand('a', { payFloorCents: 2000 }), ctx).score;
  const b = scoreCandidate(tile, cand('a', { payFloorCents: 3200 }), ctx).score;
  assert.equal(a, b);
});

test('availability: 1 within a day, 0.5 within three days, 0 beyond', () => {
  const inTwoDays = new Date(NOW + 2 * DAY).getUTCDay();
  const inFiveDays = new Date(NOW + 5 * DAY).getUTCDay();
  assert.equal(scoreCandidate(tile, cand('a', { availability: [{ day: inTwoDays, start: '16:00', end: '18:00' }] }), ctx).breakdown.A, 0.5);
  assert.equal(scoreCandidate(tile, cand('a', { availability: [{ day: inFiveDays, start: '16:00', end: '18:00' }] }), ctx).breakdown.A, 0);
});

test('ranking puts eligible people first, best score first', () => {
  const r = rankCandidates(tile, [cand('low', { skills: [{ tag: 'python', selfLevel: 1 }] }), cand('hi'), cand('broke', { payFloorCents: 9000 })], ctx);
  assert.deepEqual(r.map((x) => x.userId), ['hi', 'low', 'broke']);
  assert.equal(r[2].eligible, false);
});

test('claims lock for 3× the estimate or 48 hours, whichever is longer', () => {
  assert.equal(claimLockMs(60), 48 * HOUR);
  assert.equal(claimLockMs(120), 48 * HOUR);
  assert.equal(claimLockMs(15 * 60 + 60), 3 * (15 * 60 + 60) * 60 * 1000);
});
