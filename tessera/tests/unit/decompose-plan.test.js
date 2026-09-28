// Property test: every job in the corpus (and the Decomposer eval set) splits into a valid,
// well-wired, checkable plan that simulated contributors can complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disaggregate } from '../../src/decompose/plan.js';
import { ancestors } from '../../src/decompose/ops.js';
import { TileDraft } from '../../src/agents/schemas.js';
import { validateGraph } from '../../src/domain/graph.js';
import { parseRule, runAutoChecks } from '../../src/domain/autochecks.js';
import { generateSampleWork } from '../../src/agents/mock/sample-work.js';
import { priceGraph } from '../../src/domain/pricing.js';
import { JOBS } from '../fixtures/jobs.js';
import { EVAL_FIXTURES } from '../../src/agents/eval.js';

const CORPUS = [
  ...JOBS,
  ...EVAL_FIXTURES.map((f, i) => ({ id: `eval-${i}`, title: f.title, goal: f.goal, privacy: f.privacy })),
  { id: 'wedding', title: 'Wedding for 120 guests', goal: 'Help plan our wedding for 120 guests in June: shortlist venues, get quotes from three caterers, design save-the-dates, build a simple RSVP page, and make a day-of timeline.' },
  { id: 'catalog', title: 'Catalog 800 donated items', goal: 'Photograph and catalog 800 donated auction items with descriptions, categories and estimated values, then build the online auction page.' },
  { id: 'videos', title: 'Training videos', goal: 'Produce 5 short training videos for new cashiers: scripts, filming, editing, and captions in English and Spanish.' },
  { id: 'migration', title: 'Donor database migration', goal: 'Migrate 12,000 donor records from our old spreadsheet into the new CRM, dedupe contacts, and write a data dictionary. Records include names and addresses.' },
  { id: 'onepiece', title: 'Blog post', goal: 'Write a 900-word blog post about our summer reading program for parents.' },
];

const plans = CORPUS.map((j) => ({ j, r: disaggregate(j) }));

test('every plan is valid under the tile schema and the graph rules', () => {
  for (const { j, r } of plans) {
    assert.ok(r.tiles.length >= 1, j.id);
    for (const t of r.tiles) {
      const p = TileDraft.safeParse(t);
      assert.ok(p.success, `${j.id}/${t.key}: ${p.success ? '' : p.error.message}`);
      assert.ok(t.estMinutes >= 15 && t.estMinutes <= 120, `${j.id}/${t.key} is ${t.estMinutes} min`);
      for (const c of t.acceptanceCriteria) if (c.check === 'AUTO') assert.ok(parseRule(c.rule), `${j.id}/${t.key}: ${c.rule}`);
    }
    assert.deepEqual(validateGraph(r.tiles), [], j.id);
    assert.ok(r.tiles.length <= 120, `${j.id} has ${r.tiles.length} tiles`);
  }
});

test('tiles are wired by files: each file has one maker and every input comes from a tile the reader waits for', () => {
  for (const { j, r } of plans) {
    const maker = new Map();
    for (const t of r.tiles) for (const f of t.outputs) {
      assert.ok(!maker.has(f), `${j.id}: ${f} made by ${maker.get(f)} and ${t.key}`);
      maker.set(f, t.key);
    }
    for (const t of r.tiles) {
      const anc = ancestors(r.tiles, t.key);
      for (const f of t.inputs) {
        if (/requester|attached/.test(f)) continue;
        assert.ok(maker.has(f), `${j.id}/${t.key} reads ${f}, which no tile makes`);
        assert.ok(anc.has(maker.get(f)), `${j.id}/${t.key} reads ${f} without waiting for ${maker.get(f)}`);
      }
    }
  }
});

test('every plan grades B or better and covers what the job asked for', () => {
  for (const { j, r } of plans) {
    assert.ok(r.quality.score >= 80, `${j.id} scored ${r.quality.score}: ${r.quality.issues.map((i) => i.message).join(' | ')}`);
    assert.equal(r.quality.metrics.covered, r.quality.metrics.requirements, `${j.id} leaves requirements uncovered`);
    const consumed = new Set(r.tiles.flatMap((t) => t.dependsOn));
    const sinks = r.tiles.filter((t) => !consumed.has(t.key));
    if (sinks.length >= 3) assert.ok(r.tiles.some((t) => t.kind === 'INTEGRATION'), `${j.id} has ${sinks.length} loose ends`);
  }
});

test('shared conventions come first whenever several people work in parallel', () => {
  for (const { j, r } of plans) {
    const work = r.tiles.filter((t) => t.phase === 'work');
    if (work.length < 3) continue;
    const conv = r.tiles.filter((t) => t.phase === 'conventions');
    assert.ok(conv.length, `${j.id} has no conventions tile`);
    for (const t of work) assert.ok(conv.some((c) => ancestors(r.tiles, t.key).has(c.key)), `${j.id}/${t.key} doesn't follow the conventions`);
  }
});

test('simulated contributors can pass every automatic check', () => {
  for (const { j, r } of plans.slice(0, 20)) {
    for (const t of r.tiles) {
      const work = generateSampleWork(t, { seed: `prop:${t.key}` });
      const files = work.files.map((f) => ({ name: f.name, size: (f.text || '').length, text: f.text }));
      const { results } = runAutoChecks(t.acceptanceCriteria, files);
      const failed = results.filter((x) => !x.pass);
      assert.deepEqual(failed.map((x) => `${x.rule}: ${x.reason}`), [], `${j.id}/${t.key}`);
    }
  }
});

test('batches split counts by range and stay parallel; per-item work follows each item', () => {
  const listings = plans.find((p) => p.j.id === 'listings').r;
  const titles = listings.tiles.filter((t) => /^fix-titles-/.test(t.key));
  assert.ok(titles.length > 10);
  titles.reduce((prev, t) => { assert.equal(t.part.from, prev + 1); return t.part.to; }, 0);
  assert.ok(titles.every((t) => t.dependsOn.length === 1 && t.dependsOn[0] === 'conventions'), 'batches wait only for the batch spec');
  const pod = plans.find((p) => p.j.id === 'podcast').r;
  const edit3 = pod.tiles.find((t) => t.key === 'edit-episode-03');
  assert.deepEqual(edit3.dependsOn.filter((d) => /episode|guests/.test(d)).sort(), ['interview-guests-03', 'record-episode-03']);
});

test('a budget is met by cutting nice-to-haves, then trimming batches into a second phase', () => {
  const j = CORPUS.find((x) => x.id === 'listings');
  const r = disaggregate(j, { maxTotalCents: 250000 });
  assert.ok(priceGraph(r.tiles).total <= 250000);
  assert.ok(r.deferred.length >= 1);
  assert.ok(r.cuts.some((c) => /Spot-check/.test(c)), 'the optional spot check is cut first');
  const froms = r.deferred.map((d) => d.from);
  assert.ok(Math.max(...froms) - Math.min(...froms) < 200, 'every operation stops at about the same row');
  const small = disaggregate(CORPUS.find((x) => x.id === 'flyer'), { maxTotalCents: 15000 });
  assert.ok(priceGraph(small.tiles).total <= 15000);
});

test('plans are deterministic', () => {
  for (const j of CORPUS.slice(0, 8)) assert.deepEqual(disaggregate(j).tiles, disaggregate(j).tiles);
});
