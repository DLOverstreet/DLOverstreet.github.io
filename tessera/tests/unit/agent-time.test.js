// Agent time and splitting: how long a tile takes one agent, when a split into parts done at
// once pays for itself, how a split plan is checked, and how the parts are joined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAgentWork, secondsFor, splitOffer, measuredSpeeds, speedFor, criticalPath, tileRows } from '../../src/decompose/agent-time.js';
import { splitProblems, joinParts } from '../../src/agents/split.js';
import { worker } from '../../src/agents/index.js';
import { WorkResult } from '../../src/agents/schemas.js';
import { parseCsv } from '../../src/lib/csv.js';
import { config } from '../../src/domain/config.js';

const rowTile = (extra = {}) => ({
  key: 'translate-rows', kind: 'WORK', title: 'Translate the Spanish comments to English', archetype: 'translate',
  inputs: ['the source file the requester attached'], outputs: ['comments_en.csv'],
  acceptanceCriteria: [{ id: 'c1', check: 'AUTO', text: 'Columns', rule: 'csv_columns(response_id, text_en)' }, { id: 'c2', check: 'AUTO', text: 'Unique', rule: 'csv_unique(response_id)' }],
  ...extra,
});
const settings = { ...config.swarm };

test('an agent’s time follows what it writes: rows of a table, words of a document, a chart', () => {
  const rows = estimateAgentWork(rowTile(), { sourceRows: 90, charsPerRow: 150 });
  assert.equal(rows.rows, 90, 'a whole-table tile works through the attached table');
  assert.equal(rows.by, 'rows');
  const coding = estimateAgentWork({ ...rowTile({ title: 'Code comments 1–45', archetype: 'code', part: { index: 1, of: 2, from: 1, to: 45 } }) }, { sourceRows: 90 });
  assert.equal(coding.rows, 45, 'a batch works through its own range');
  assert.ok(coding.outTokens < rows.outTokens / 2, 'labeling a row writes far less than translating it');
  const report = estimateAgentWork({ kind: 'WORK', title: 'Write the report', outputs: ['report.md'], acceptanceCriteria: [{ check: 'AUTO', rule: 'word_count(1500, 2500)' }] });
  assert.equal(report.words, 2000);
  assert.equal(report.by, 'sections');
  const merge = estimateAgentWork({ kind: 'INTEGRATION', title: 'Assemble', outputs: ['report.md', 'coded_all.csv'], acceptanceCriteria: [{ check: 'AUTO', rule: 'csv_min_rows(90)' }] });
  assert.equal(merge.by, null, 'a final assembly is never split');
  assert.ok(merge.outTokens < 2000, 'its tables are merged by code');
  assert.ok(secondsFor(6000, 75) > secondsFor(6000, 150), 'a faster model finishes sooner');
  assert.equal(tileRows({ part: { index: 1, of: 1, from: 1, to: 1 }, acceptanceCriteria: [{ rule: 'csv_min_rows(12)' }], outputs: ['x.csv'] }), 12);
});

test('a split is offered only for long work that divides, and only when the extra cost stays within the allowance', () => {
  const work = estimateAgentWork(rowTile(), { sourceRows: 90, charsPerRow: 150 });
  const offer = splitOffer({ tile: rowTile(), work, inputTokens: 7000, model: 'claude-sonnet-5-5', tps: 75, settings });
  assert.ok(offer, 'ninety rows to translate take one agent well over the target');
  assert.ok(offer.parts >= 2 && offer.parts <= settings.maxParts);
  assert.ok(offer.savedSeconds >= 15 && offer.splitSeconds < offer.estSeconds);
  assert.ok(offer.extraUsd <= offer.baseUsd * settings.splitMaxExtraPct / 100);
  assert.equal(splitOffer({ tile: rowTile(), work, inputTokens: 7000, model: 'claude-sonnet-5-5', tps: 75, settings: { ...settings, splitMaxExtraPct: 0 } }), null, 'no allowance, no split');
  assert.equal(splitOffer({ tile: rowTile(), work, inputTokens: 7000, model: 'claude-sonnet-5-5', tps: 75, settings: { ...settings, split: false } }), null, 'off in Settings');
  assert.equal(splitOffer({ tile: rowTile(), work, inputTokens: 7000, model: 'claude-sonnet-5-5', tps: 75, settings: { ...settings, spendCapUsd: 0.01 }, spentUsd: 0 }), null, 'a split that would pass the spend cap is not offered');
  const short = estimateAgentWork(rowTile({ part: { index: 1, of: 4, from: 1, to: 20 }, archetype: 'code', title: 'Code rows 1–20' }), {});
  assert.equal(splitOffer({ tile: rowTile(), work: short, inputTokens: 7000, model: 'claude-sonnet-5-5', tps: 75, settings }), null, 'a short tile does not split');
  for (const tile of [rowTile({ phase: 'conventions' }), rowTile({ independentCheck: true }), rowTile({ kind: 'INTEGRATION' }), rowTile({ agentMode: 'prepare' })]) {
    assert.equal(splitOffer({ tile, work, inputTokens: 7000, model: 'claude-sonnet-5-5', tps: 75, settings }), null, 'conventions, checks, assembly and kits stay with one agent');
  }
  // Without the prompt cache (Haiku needs a 4,096-token prefix), every part pays full price for the context.
  const cached = splitOffer({ tile: rowTile(), work, inputTokens: 3000, model: 'claude-sonnet-5-5', tps: 75, settings: { ...settings, maxParts: 2 } });
  const uncached = splitOffer({ tile: rowTile(), work, inputTokens: 3000, model: 'claude-haiku-4-5', tps: 75, settings: { ...settings, maxParts: 2 } });
  assert.ok(cached && uncached && uncached.extraUsd / uncached.baseUsd > cached.extraUsd / cached.baseUsd);
});

test('writing speed is measured from real worker runs, ignoring the mock, failures and short replies', () => {
  const run = (model, tokensOut, latencyMs, extra = {}) => ({ agent: 'worker', provider: 'anthropic', model, tokensOut, latencyMs, error: null, ...extra });
  const runs = [run('claude-sonnet-5-5', 3000, 45000), run('claude-sonnet-5-5', 6000, 85000), run('claude-sonnet-5-5', 1500, 25000),
    run('claude-sonnet-5-5', 9000, 1000, { provider: 'mock' }), run('claude-sonnet-5-5', 50, 9000), run('claude-sonnet-5-5', 4000, 60000, { error: 'x' }), run('claude-opus-5-5', 2000, 40000)];
  const speeds = measuredSpeeds(runs);
  assert.ok(speeds['claude-sonnet-5-5'] > 60 && speeds['claude-sonnet-5-5'] < 90);
  assert.equal(speeds['claude-opus-5-5'], undefined, 'one run is not enough to go on');
  assert.equal(speedFor('claude-opus-5-5', speeds), 55, 'the model’s rough default until measured');
  assert.equal(speedFor('claude-sonnet-5-5', speeds), speeds['claude-sonnet-5-5']);
});

test('the longest chain of tiles is the job’s expected time with enough agents', () => {
  const tiles = [{ key: 'a', dependsOn: [] }, { key: 'b', dependsOn: ['a'] }, { key: 'c', dependsOn: ['a'] }, { key: 'd', dependsOn: ['b', 'c'] }];
  const secs = { a: 10, b: 50, c: 20, d: 5 };
  assert.deepEqual(criticalPath(tiles, (t) => secs[t.key]), { seconds: 65, keys: ['a', 'b', 'd'] });
});

test('a split plan must cover every file and row once, in the parts allowed', () => {
  const input = { delegation: { maxParts: 3, by: 'rows', files: ['out.csv', 'notes.md', 'chart.svg'], rows: { from: 1, to: 90 } } };
  const good = { reason: 'Rows divide evenly.', parts: [{ brief: 'Rows 1 to 45 of the table.', files: ['out.csv', 'notes.md', 'chart.svg'], rows: { from: 1, to: 45 } }, { brief: 'Rows 46 to 90 of the table.', files: ['out.csv', 'notes.md'], rows: { from: 46, to: 90 } }] };
  assert.deepEqual(splitProblems(good, input), []);
  const problems = (split) => splitProblems(split, input).join(' | ');
  assert.match(splitProblems(good, {})[0], /may not be split/);
  assert.match(problems({ ...good, parts: [good.parts[0]] }), /2 to 3 parts/);
  assert.match(problems({ ...good, parts: [good.parts[0], { ...good.parts[1], files: ['other.csv'] }] }), /isn't one of this tile's files/);
  assert.match(problems({ ...good, parts: [{ ...good.parts[0], files: ['out.csv'] }, good.parts[1]] }), /no part writes chart\.svg/);
  assert.match(problems({ ...good, parts: [good.parts[0], { ...good.parts[1], files: ['out.csv', 'notes.md', 'chart.svg'] }] }), /chart\.svg can't be joined/);
  assert.match(problems({ ...good, parts: [good.parts[0], { ...good.parts[1], rows: { from: 40, to: 90 } }] }), /overlap/);
  assert.match(problems({ ...good, parts: [good.parts[0], { ...good.parts[1], rows: { from: 46, to: 80 } }] }), /cover 80 of the 90 rows/);
  assert.match(problems({ ...good, parts: [good.parts[0], { ...good.parts[1], rows: { from: 46, to: 95 } }] }), /fall outside/);
  // The worker's validator sends split problems back; a part may never split again.
  const four = { ...good, parts: [...good.parts, ...good.parts] };
  assert.match(worker.validate(WorkResult.parse({ approach: ['Split.'], files: [], notes: '', checklist: [], split: four }), { ...input, tile: { acceptanceCriteria: [] } }).join(' '), /2 to 3 parts, not 4/);
  const part = { tile: { acceptanceCriteria: [] }, part: { index: 1, of: 2, files: ['out.csv'] } };
  assert.match(worker.validate(WorkResult.parse({ approach: ['Did it.'], files: [{ name: 'out.csv', content: 'a\n1\n' }, { name: 'x.md', content: 'hi' }], notes: '', checklist: [] }), part).join(' '), /writes only out\.csv/);
  assert.deepEqual(worker.validate(WorkResult.parse({ approach: ['Did it.'], files: [{ name: 'out.csv', content: 'a\n1\n' }], notes: '', checklist: [] }), part), [], 'a part is not held to the whole tile’s checks');
});

test('parts are joined by code: tables stacked under one header, documents in order, JSON lists concatenated', () => {
  const parts = [
    { files: [{ name: 'out.csv', content: 'response_id,text_en\nR1,Hello\nR2,"Yes, please"\n' }, { name: 'notes.md', content: '## Part one\n\nFirst.' }, { name: 'items.json', content: '[1,2]' }, { name: 'chart.svg', content: '<svg/>' }] },
    { files: [{ name: 'out.csv', content: 'response_id,text_en,flag\nR3,Bye,x\nR2,Dup,\n' }, { name: 'notes.md', content: '## Part two\n\nSecond.' }, { name: 'items.json', content: '[3]' }] },
  ];
  const j = joinParts(parts, { expected: ['out.csv', 'notes.md', 'items.json', 'chart.svg'], idColumn: 'response_id' });
  assert.deepEqual(j.problems, []);
  const table = parseCsv(j.files.find((f) => f.name === 'out.csv').content);
  assert.deepEqual(table.columns, ['response_id', 'text_en', 'flag']);
  assert.deepEqual(table.rows.map((r) => r[0]), ['R1', 'R2', 'R3'], 'a row an earlier part handed in is dropped');
  assert.equal(table.rows[1][1], 'Yes, please');
  assert.match(j.files.find((f) => f.name === 'notes.md').content, /Part one[\s\S]*Part two/);
  assert.deepEqual(JSON.parse(j.files.find((f) => f.name === 'items.json').content), [1, 2, 3]);
  assert.equal(j.files.find((f) => f.name === 'chart.svg').content, '<svg/>');
  assert.match(j.report.join(' '), /out\.csv: 3 rows from 2 parts \(1 repeated response_id dropped\)/);
  assert.match(joinParts([{ files: [] }, { files: [] }], { expected: ['out.csv'] }).problems[0], /no part handed in out\.csv/);
});
