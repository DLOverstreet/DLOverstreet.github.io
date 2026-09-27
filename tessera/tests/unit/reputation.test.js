import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReputation, smoothedRate } from '../../src/domain/reputation.js';
import { DAY } from '../../src/lib/util.js';

const NOW = Date.UTC(2026, 9, 1);
const ev = (reason, at = NOW - DAY, tag = 'python', tier = 2) => ({ userId: 'u', skillTag: tag, reason, delta: 0, tier, createdAt: at });

test('a new contributor starts at 0.5', () => {
  assert.equal(smoothedRate(0, 0), 0.5);
});

test('R = (accepted + 2) / (attempts + 4)', () => {
  const s = summarizeReputation([ev('ACCEPTED'), ev('ACCEPTED'), ev('REVIEW_FAILED')], 'u', NOW);
  assert.equal(s.skills.python.accepted, 2);
  assert.equal(s.skills.python.attempts, 3);
  assert.equal(s.skills.python.score, 4 / 7);
});

test('events older than 12 months count half', () => {
  const s = summarizeReputation([ev('ACCEPTED', NOW - 400 * DAY), ev('ACCEPTED')], 'u', NOW);
  assert.equal(s.skills.python.accepted, 1.5);
});

test('a first expired claim does not count; later ones do', () => {
  const first = summarizeReputation([ev('CLAIM_EXPIRED_FIRST')], 'u', NOW);
  assert.equal(first.skills.python.attempts, 0);
  const second = summarizeReputation([ev('CLAIM_EXPIRED_FIRST'), ev('CLAIM_EXPIRED')], 'u', NOW);
  assert.equal(second.skills.python.attempts, 1);
});

test('highest tier comes from accepted work only', () => {
  const s = summarizeReputation([ev('ACCEPTED', NOW, 'python', 3), ev('REVIEW_FAILED', NOW, 'python', 4)], 'u', NOW);
  assert.equal(s.skills.python.highestTier, 3);
});

test('a dispute reopening removes the accepted credit', () => {
  const s = summarizeReputation([ev('ACCEPTED'), ev('DISPUTE_REOPENED')], 'u', NOW);
  assert.equal(s.skills.python.accepted, 0);
  assert.equal(s.skills.python.attempts, 1);
});
