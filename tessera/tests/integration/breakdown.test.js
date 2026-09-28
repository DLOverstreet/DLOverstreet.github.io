import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { disaggregate } from '../../src/decompose/plan.js';
import { draftGraph } from '../../src/services/commissions.js';
import { DAY } from '../../src/lib/util.js';

const T = await makeTessera({ autoSeed: false, crowd: false });
await T.ready?.();

const job = { title: 'Spring gala for 200 guests', goal: 'Plan our annual spring gala for 200 guests: find a venue, get catering quotes, design invitations, set up online registration, recruit 30 volunteers, and write the run-of-show.' };

async function people() {
  if (T.db.get('User', 'usr_marisol')) return;
  const { seedWorld } = await import('../../src/services/seed.js');
  await seedWorld(T, { now: T.clock.now() });
}

test('the breakdown API runs the engine without posting anything', async () => {
  const before = T.db.count('Commission');
  const r = await T.api.breakdown(job, {});
  assert.equal(r.source, 'engine');
  assert.ok(r.tiles.length >= 8);
  assert.equal(r.quality.grade, 'A');
  assert.equal(T.db.count('Commission'), before);
});

test('a plan from the breakdown tool posts straight to the approval step, with its file interfaces', async () => {
  await people();
  const plan = disaggregate(job);
  const c = await T.api.postCommission('usr_marisol', { ...job, budgetCents: 150000, deadline: T.clock.now() + 14 * DAY, privacy: 'PUBLIC', plan: { tiles: plan.tiles, rationale: plan.rationale } });
  assert.equal(c.status, 'PLANNED');
  const tiles = draftGraph(T.db, c.id);
  assert.equal(tiles.length, plan.tiles.length);
  assert.ok(tiles.every((t) => t.outputs?.length && t.stream && t.phase));
  const brief = tiles.find((t) => t.key === 'conventions');
  assert.ok(tiles.filter((t) => t.phase === 'work').every((t) => t.dependsOn.includes('conventions')), 'every piece waits for the event brief');
  assert.ok(brief.outputs.includes('event_brief.md'));
  assert.equal(c.plan.quality.grade, 'A');
  assert.ok(c.plan.analysis.requirements.length >= 6);
});

test('fixes on a planned commission split, merge and repair the draft tiles in place', async () => {
  const c = T.db.find('Commission', (x) => x.status === 'PLANNED' && x.title === job.title);
  const count = () => draftGraph(T.db, c.id).length;
  const n = count();
  T.api.applyPlanFix('usr_marisol', c.id, { op: 'split', key: 'design-invitations' });
  assert.equal(count(), n + 1);
  const halves = draftGraph(T.db, c.id).filter((t) => t.key.startsWith('design-invitations-'));
  assert.equal(halves.length, 2);
  T.api.applyPlanFix('usr_marisol', c.id, { op: 'merge', keys: halves.map((h) => h.key) });
  assert.equal(count(), n);
  assert.throws(() => T.api.applyPlanFix('usr_tom', c.id, { op: 'repair' }), /Only the requester/);
  const edited = T.db.get('Commission', c.id);
  assert.equal(edited.plan.edits.length, 2);
  // The edited plan still funds and opens.
  T.api.fundCommission('usr_marisol', c.id, { acceptOverBudget: true });
  assert.equal(T.db.get('Commission', c.id).status, 'ACTIVE');
  assert.ok(draftGraph(T.db, c.id).some((t) => t.status === 'OPEN'));
});
