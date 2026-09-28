import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptForAgents } from '../../src/decompose/agents.js';
import { disaggregate } from '../../src/decompose/plan.js';
import { validateGraph } from '../../src/domain/graph.js';
import { TileDraft } from '../../src/agents/schemas.js';
import { JOBS } from '../fixtures/jobs.js';

const plan = (id) => disaggregate(JOBS.find((j) => j.id === id)).tiles;
const byTitle = (tiles, re) => tiles.filter((t) => re.test(t.title));

test('every corpus plan stays a valid, fully wired graph after adapting it for agents, with or without a file', () => {
  for (const j of JOBS) {
    for (const hasSource of [true, false]) {
      const { tiles } = adaptForAgents(disaggregate(j).tiles, { hasSource });
      assert.deepEqual(validateGraph(tiles).filter((i) => i.code !== 'no-work'), [], `${j.id} (${hasSource ? 'file' : 'no file'})`);
      for (const t of tiles) assert.ok(TileDraft.safeParse(t).success, `${j.id}: ${t.key} parses`);
      const made = new Set(tiles.flatMap((t) => t.outputs));
      for (const t of tiles) for (const f of t.inputs) assert.ok(/requester|attached/.test(f) || made.has(f), `${j.id}: ${t.key} reads ${f}, which some tile makes`);
    }
  }
});

test('steps that need a person in the real world become the kit a person needs, with a handoff', () => {
  const { tiles, handoffs } = adaptForAgents(plan('podcast'));
  const guides = byTitle(tiles, /^Write the interview guide/);
  assert.equal(guides.length, 6, 'one interview guide per episode');
  assert.equal(byTitle(tiles, /^Write the script and run sheet/).length, 6);
  const editing = byTitle(tiles, /^Write the editing guide/);
  assert.equal(editing.length, 1, 'six edits collapse into one editing guide');
  assert.equal(editing[0].collapsed, 6);
  for (const t of [...guides, ...editing]) {
    assert.equal(t.agentMode, 'prepare');
    assert.ok(t.handoff && handoffs.some((h) => h.key === t.key));
    assert.ok(t.outputs[0].endsWith('_kit.md'));
    assert.ok(t.acceptanceCriteria.some((c) => c.rule === 'file_ext(md)'));
    assert.ok(t.acceptanceCriteria.some((c) => c.check === 'LLM' && /real-world step/.test(c.text)));
  }
  assert.ok(!byTitle(tiles, /^(Interview|Record|Edit) /).length, 'no tile still asks an agent to record or edit audio');
});

test('readers of collapsed real-world batches wait for the one kit', () => {
  const { tiles } = adaptForAgents(plan('transcribe'));
  const kit = tiles.find((t) => t.agentMode === 'prepare');
  assert.match(kit.title, /transcription guide/);
  const summaries = byTitle(tiles, /summary/i).filter((t) => t.kind === 'WORK');
  assert.ok(summaries.length >= 5);
  for (const s of summaries) {
    assert.ok(s.dependsOn.includes(kit.key), `${s.key} waits for the kit`);
    assert.ok(s.inputs.includes(kit.outputs[0]), `${s.key} reads the kit`);
  }
});

test('outreach, publishing and fact-finding hand off to a person; ordinary writing does not', () => {
  const gala = adaptForAgents(plan('gala')).tiles;
  const outreach = gala.find((t) => /outreach kit/.test(t.title));
  assert.ok(outreach.outputs.includes('tracking.csv'));
  assert.equal(gala.find((t) => t.title === 'Get catering quotes').agentMode, 'verify');
  assert.ok(gala.find((t) => t.title === 'Get catering quotes').acceptanceCriteria.some((c) => /\(verify\)/.test(c.text)));
  const pantry = adaptForAgents(plan('pantry')).tiles;
  assert.match(pantry.find((t) => /publish/.test(t.title)).handoff, /uploads the final files/);
  const grant = adaptForAgents(plan('grant')).tiles;
  assert.ok(grant.find((t) => /budget narrative/.test(t.title)) && !grant.some((t) => t.agentMode === 'prepare'), 'a budget narrative is writing, not narration');
  const calls = adaptForAgents(plan('calls311')).tiles;
  assert.ok(!calls.some((t) => /outreach/.test(t.title)), '“311 call data” is data, not calling people');
});

test('live-data batches become one collection script on a labeled sample, and row counts downstream are dropped', () => {
  const { tiles, changes } = adaptForAgents(plan('calls311'));
  const collect = tiles.filter((t) => t.agentMode === 'sample-data');
  assert.equal(collect.length, 1);
  assert.equal(collect[0].title, 'Collect the data');
  assert.ok(collect[0].acceptanceCriteria.some((c) => /SAMPLE/.test(c.text)));
  assert.ok(changes.some((c) => /collection script/.test(c)));
  assert.ok(!tiles.some((t) => t.acceptanceCriteria.some((c) => /^csv_min_rows/.test(c.rule || ''))));
});

test('with no file attached, parallel batches over the requester’s material run once on a sample', () => {
  const withFile = adaptForAgents(plan('listings'), { hasSource: true }).tiles;
  const without = adaptForAgents(plan('listings'), { hasSource: false });
  assert.ok(withFile.length > 60, 'with the export attached, every batch stays');
  assert.ok(without.tiles.length <= 10, `${without.tiles.length} tiles`);
  const fix = without.tiles.find((t) => t.title === 'Fix titles');
  assert.equal(fix.agentMode, 'sample-data');
  assert.equal(fix.part, null);
  const merge = without.tiles.find((t) => t.kind === 'INTEGRATION');
  assert.ok(!merge.acceptanceCriteria.some((c) => /^csv_min_rows/.test(c.rule || '')), 'the merge no longer demands 5,000 rows');
  assert.ok(merge.inputs.includes(fix.outputs[0]));
});

test('row batches are fitted to the attached table: ranges past its end go, the last one ends with it', () => {
  const { tiles, changes } = adaptForAgents(plan('survey'), { hasSource: true, sourceRows: 70 });
  const batches = tiles.filter((t) => t.part?.of > 1);
  assert.deepEqual(batches.map((t) => [t.part.from, t.part.to]), [[1, 40], [41, 70]]);
  assert.ok(batches[1].acceptanceCriteria.some((c) => c.rule === 'csv_min_rows(30)'));
  assert.ok(changes.some((c) => /70 rows/.test(c)));
  assert.ok(!tiles.some((t) => t.acceptanceCriteria.some((c) => /^csv_min_rows\((\d+)\)/.test(c.rule || '') && Number(/\d+/.exec(c.rule)[0]) > 70)), 'no tile asks for more rows than the table has');
  assert.deepEqual(validateGraph(tiles).filter((i) => i.code !== 'no-work'), []);
});
