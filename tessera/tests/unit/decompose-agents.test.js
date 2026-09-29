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

test('a tile that counts from upstream data isn’t mistaken for live-data collection', () => {
  const tiles = [
    { key: 'code', kind: 'WORK', title: 'Code the responses', spec: 'Code every response. '.repeat(3), deliverableFormat: 'coded_all.csv', estMinutes: 60, tier: 2, skillTags: ['survey-coding'], dependsOn: [], inputs: [], outputs: ['coded_all.csv'], acceptanceCriteria: [{ id: 'c1', check: 'AUTO', text: 'CSV', rule: 'file_ext(csv)' }] },
    { key: 'counts', kind: 'WORK', title: 'Collect theme counts by branch', archetype: 'collect', spec: 'Count themes by branch. '.repeat(3), deliverableFormat: 'counts.csv', estMinutes: 30, tier: 2, skillTags: ['data-cleaning'], dependsOn: ['code'], inputs: ['coded_all.csv'], outputs: ['counts.csv'], acceptanceCriteria: [{ id: 'c1', check: 'AUTO', text: 'rows', rule: 'csv_min_rows(3)' }] },
  ];
  const { tiles: out } = adaptForAgents(tiles, { web: true });
  const counts = out.find((t) => t.key === 'counts');
  assert.equal(counts.agentMode, undefined, 'it computes from coded_all.csv; it isn’t sample data');
  assert.ok(counts.acceptanceCriteria.some((c) => c.rule === 'csv_min_rows(3)'));
  assert.ok(!counts.webResearch);
});

test('with the web, fact-finding tiles research and cite sources instead of handing every fact to a person', () => {
  const offline = adaptForAgents(plan('gala'), { web: false }).tiles.find((t) => t.title === 'Get catering quotes');
  const online = adaptForAgents(plan('gala'), { web: true });
  const quotes = online.tiles.find((t) => t.title === 'Get catering quotes');
  assert.equal(offline.agentMode, 'verify');
  assert.ok(offline.handoff);
  assert.equal(quotes.agentMode, 'researched');
  assert.ok(quotes.webResearch);
  assert.equal(quotes.handoff, undefined);
  assert.ok(quotes.acceptanceCriteria.some((c) => /source URL/.test(c.text)));
  assert.ok(online.changes.some((c) => /look up outside facts on the web/.test(c)));
  // Coding the requester's own responses stays offline.
  assert.ok(!adaptForAgents(plan('survey'), { web: true, hasSource: true }).tiles.some((t) => /^code-response/.test(t.key) && t.webResearch));
});

test('costs and recommendations must show where their numbers come from, and checks run on another model', () => {
  const grant = adaptForAgents(plan('grant'), { web: true }).tiles.find((t) => /budget/i.test(t.title));
  assert.ok(grant.acceptanceCriteria.some((c) => /arithmetic/.test(c.text)));
  assert.ok(grant.webResearch, 'rates for a budget are looked up');
  const check = adaptForAgents(plan('survey')).tiles.find((t) => /agreement/i.test(t.title));
  assert.ok(check.independentCheck);
  const ids = grant.acceptanceCriteria.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'criterion ids stay unique');
});

const timing = { tps: 75, targetSeconds: 60, maxParts: 4, split: true, charsPerRow: 120 };

test('tuned for agents’ speed, every corpus plan stays a valid, fully wired graph with an expected time', () => {
  for (const j of JOBS) {
    const { tiles, estimate } = adaptForAgents(disaggregate(j).tiles, { hasSource: true, sourceRows: 90, web: true, timing });
    assert.deepEqual(validateGraph(tiles).filter((i) => i.code !== 'no-work'), [], j.id);
    for (const t of tiles) assert.ok(TileDraft.safeParse(t).success, `${j.id}: ${t.key} parses`);
    const made = new Map(tiles.flatMap((t) => t.outputs.map((f) => [f, t.key])));
    assert.equal(made.size, tiles.flatMap((t) => t.outputs).length, `${j.id}: every file has one maker`);
    for (const t of tiles) for (const f of t.inputs) assert.ok(/requester|attached/.test(f) || made.has(f), `${j.id}: ${t.key} reads ${f}, which some tile makes`);
    assert.ok(tiles.every((t) => t.agentEstimate > 0), `${j.id}: every tile has an expected agent time`);
    assert.ok(estimate.seconds > 0 && estimate.keys.length > 0, j.id);
  }
});

test('drafts split page by page for people fold into one tile an agent writes as one document', () => {
  const { tiles, changes } = adaptForAgents(plan('library'), { hasSource: true, sourceRows: 90, web: true, timing });
  const report = tiles.filter((t) => /report/i.test(t.title) && t.archetype === 'write' && !t.languages.includes('es'));
  assert.equal(report.length, 1);
  assert.equal(report[0].title, 'Write the report');
  assert.deepEqual(report[0].outputs, ['report_library.md']);
  assert.ok(report[0].acceptanceCriteria.some((c) => c.rule === 'word_count(540, 1180)'), 'the word range covers both pages');
  assert.ok(report[0].acceptanceCriteria.some((c) => /main findings/.test(c.text)) && report[0].acceptanceCriteria.some((c) => /differences between branches/.test(c.text)), 'both pages’ contents are still asked for');
  const spanish = tiles.find((t) => t.languages.includes('es'));
  assert.deepEqual(spanish.dependsOn.filter((d) => /report/.test(d)), [report[0].key]);
  assert.ok(spanish.inputs.includes('report_library.md'), 'the summary reads the folded report');
  assert.ok(changes.some((c) => /2 parts of “Write the report” fold into one tile/.test(c)));
  // Many small batches fold into chunks near the target, not into one long tile.
  const hb = adaptForAgents(plan('handbook'), { hasSource: true, web: true, timing });
  const es = hb.tiles.filter((t) => /^translate-.*-es$/.test(t.key));
  assert.ok(es.length >= 5 && es.length < 20, `${es.length} Spanish translation tiles`);
  assert.ok(es.every((t) => t.agentEstimate <= 60));
  assert.match(es[0].title, /^Translate pages 1–\d+ of the handbook$/);
  // Without timing, the plan keeps its human-sized split.
  assert.equal(adaptForAgents(plan('library'), { hasSource: true, sourceRows: 90 }).tiles.filter((t) => /page \d of the report/i.test(t.title)).length, 2);
});

test('a tile expected to run far longer than the rest is marked as one its agent may split', () => {
  const tiles = [
    { key: 'translate-all', kind: 'WORK', title: 'Translate every Spanish comment to English', archetype: 'translate', spec: 'Translate each comment and keep its id.', deliverableFormat: 'comments_en.csv', acceptanceCriteria: [{ id: 'c1', check: 'AUTO', text: 'Columns', rule: 'csv_columns(response_id, text_en)' }], skillTags: ['translation-es'], tier: 2, estMinutes: 60, dependsOn: [], inputs: ['the source file the requester attached'], outputs: ['comments_en.csv'] },
    { key: 'summary', kind: 'WORK', title: 'Write the summary', archetype: 'write', spec: 'Summarize the comments in a page.', deliverableFormat: 'summary.md', acceptanceCriteria: [{ id: 'c1', check: 'AUTO', text: 'Length', rule: 'word_count(300, 600)' }], skillTags: ['technical-writing'], tier: 2, estMinutes: 45, dependsOn: ['translate-all'], inputs: ['comments_en.csv'], outputs: ['summary.md'] },
  ];
  const { tiles: out, changes, estimate } = adaptForAgents(tiles, { hasSource: true, sourceRows: 90, timing: { ...timing, charsPerRow: 150 } });
  const t = out.find((x) => x.key === 'translate-all');
  assert.ok(t.splitHint && t.splitHint.by === 'rows' && t.splitHint.parts >= 2);
  assert.equal(out.find((x) => x.key === 'summary').splitHint, undefined);
  assert.ok(changes.some((c) => /may be split among agents/.test(c)));
  assert.deepEqual(estimate.keys, ['translate-all', 'summary']);
  assert.equal(adaptForAgents(tiles, { hasSource: true, sourceRows: 90, timing: { ...timing, split: false } }).tiles[0].splitHint, undefined, 'not when splitting is off');
});
