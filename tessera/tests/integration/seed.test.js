import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { commissionBalance, findOverdraw } from '../../src/domain/ledger.js';
import { effectiveHourlyCents } from '../../src/domain/pricing.js';
import { config } from '../../src/domain/config.js';

const T = await makeTessera();

test('the seed creates 2 requesters, 12 contributors with varied skills and floors, and 3 commissions', () => {
  assert.equal(T.db.count('User', (u) => u.isRequester), 2);
  const contributors = T.db.filter('User', (u) => u.isContributor);
  assert.equal(contributors.length, 12);
  const floors = new Set(T.db.all('ContributorProfile').map((p) => p.payFloorCents));
  assert.ok(floors.size >= 8, 'floors vary');
  const skills = new Set(T.db.all('ContributorProfile').flatMap((p) => p.skills.map((s) => s.tag)));
  assert.ok(skills.size >= 25, 'skills vary');
  assert.equal(T.db.count('Commission'), 3);
  assert.deepEqual(T.db.all('Commission').map((c) => c.status).sort(), ['ACCEPTED', 'ACTIVE', 'PLANNED']);
});

test('no seeded contributor is ever offered a tile below their floor', () => {
  const offers = T.db.all('Offer');
  assert.ok(offers.length > 10);
  for (const o of offers) {
    const tile = T.db.get('Tile', o.tileId);
    const p = T.db.find('ContributorProfile', (x) => x.userId === o.contributorId);
    assert.ok(effectiveHourlyCents(tile) >= Math.max(p.payFloorCents, config.platformFloorCents), `${o.contributorId} offered ${tile.key}`);
  }
  assert.equal(offers.filter((o) => o.contributorId === 'usr_noah').length, 0, 'the $90/h contributor gets no offers');
});

test('ledgers never overdraw, and the finished commission nets to zero', () => {
  const entries = T.db.all('LedgerEntry');
  for (const c of T.db.all('Commission')) assert.equal(findOverdraw(entries, c.id), null);
  const done = T.db.find('Commission', (c) => c.status === 'ACCEPTED');
  assert.equal(commissionBalance(entries, done.id), 0);
});

test('the delivered manifest names every contributor and tile', () => {
  const done = T.db.find('Commission', (c) => c.status === 'ACCEPTED');
  const tiles = T.db.filter('Tile', (t) => t.commissionId === done.id && t.status === 'ACCEPTED');
  const m = done.delivery.manifest;
  for (const t of tiles) assert.ok(m.some((x) => x.tileKey === t.key && x.contributorId === t.claimedById), `manifest is missing ${t.key}`);
  assert.deepEqual(new Set(m.map((x) => x.contributorId)), new Set(tiles.map((t) => t.claimedById)));
});

test('every agent call is logged with its prompt version', () => {
  const runs = T.db.all('AgentRun');
  assert.ok(runs.length > 10);
  for (const r of runs) assert.match(r.promptVersion, /^[a-z-]+\.v\d+$/);
  assert.deepEqual(new Set(runs.map((r) => r.agent)), new Set(['scoping', 'decomposer', 'matcher-note', 'reviewer', 'assembler']));
});
