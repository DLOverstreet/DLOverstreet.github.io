import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBatches, settleMerge } from '../../src/services/swarm.js';
import { worker, workerFiles } from '../../src/agents/index.js';
import { WorkResult } from '../../src/agents/schemas.js';
import { parseCsv } from '../../src/lib/csv.js';

const csv = (name, header, rows) => ({ name, text: [header, ...rows].join('\n') + '\n' });

test('numbered batches of one file are stacked in order, exactly', () => {
  const files = [
    csv('coded_02.csv', 'response_id,code', ['r3,B', 'r4,A']),
    csv('coded_01.csv', 'response_id,code', ['r1,A', 'r2,"C, with comma"']),
    { name: 'codebook.csv', text: 'code,label\nA,Repairs\n' },
  ];
  const [m] = mergeBatches({ kind: 'INTEGRATION', outputs: ['report.md', 'coded_all.csv'] }, files);
  assert.equal(m.name, 'coded_all.csv');
  assert.deepEqual(m.from, ['coded_01.csv', 'coded_02.csv']);
  const { columns, rows } = parseCsv(m.text);
  assert.deepEqual(columns, ['response_id', 'code']);
  assert.deepEqual(rows.map((r) => r[0]), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(rows[1][1], 'C, with comma');
});

test('a final merge joins batches of different files on their shared id, onto the attached source', () => {
  const files = [
    csv('titles_01.csv', 'listing_id,title_fixed', ['L1,Blue mug', 'L2,Red mug']),
    csv('titles_02.csv', 'listing_id,title_fixed', ['L3,Green mug']),
    csv('sizes_01.csv', 'listing_id,size', ['L2,12 oz']),
  ];
  const source = [csv('export.csv', 'listing_id,title', ['L1,blue mug!!', 'L2,RED MUG', 'L3,grn mug', 'L4,plate'])];
  const [m] = mergeBatches({ kind: 'INTEGRATION', outputs: ['final.csv', 'change_log.md'] }, files, source);
  const { columns, rows } = parseCsv(m.text);
  assert.deepEqual(columns, ['listing_id', 'title', 'title_fixed', 'size']);
  assert.deepEqual(rows, [['L1', 'blue mug!!', 'Blue mug', ''], ['L2', 'RED MUG', 'Red mug', '12 oz'], ['L3', 'grn mug', 'Green mug', ''], ['L4', 'plate', '', '']]);
});

test('a batch column named differently from the one the tile asks for takes the asked-for name', () => {
  const files = [csv('titles_01.csv', 'listing_id,title_fixed', ['L1,Mug']), csv('coded_01.csv', 'listing_id,category', ['L1,Kitchen'])];
  const tile = { kind: 'INTEGRATION', outputs: ['final.csv'], acceptanceCriteria: [{ id: 'c1', check: 'AUTO', text: 'cols', rule: 'csv_columns(listing_id, title_fixed, taxonomy_new)' }] };
  const [m] = mergeBatches(tile, files);
  assert.deepEqual(parseCsv(m.text).columns, ['listing_id', 'title_fixed', 'taxonomy_new']);
  assert.deepEqual(settleMerge(m, tile.acceptanceCriteria).fails, []);
});

test('a merge that fails the tile’s checks is not handed in as is', () => {
  const files = [csv('coded_01.csv', 'response_id,code', ['r1,A']), csv('coded_02.csv', 'response_id,code', ['r1,B'])];
  const criteria = [{ id: 'c1', check: 'AUTO', text: 'unique', rule: 'csv_unique(response_id)' }];
  const [m] = mergeBatches({ kind: 'INTEGRATION', outputs: ['coded_all.csv'] }, files);
  assert.match(settleMerge(m, criteria).fails[0], /csv_unique/);
});

test('nothing is merged for a tile whose outputs aren’t CSV or when there is only one batch', () => {
  assert.deepEqual(mergeBatches({ kind: 'WORK', outputs: ['memo.md'] }, [csv('coded_01.csv', 'a', ['1']), csv('coded_02.csv', 'a', ['2'])]), []);
  assert.deepEqual(mergeBatches({ kind: 'INTEGRATION', outputs: ['coded_all.csv'] }, [csv('coded_01.csv', 'a', ['1'])]), []);
});

const tile = {
  key: 'code-01', title: 'Code responses 1–40',
  acceptanceCriteria: [
    { id: 'c1', text: 'Has the columns', check: 'AUTO', rule: 'csv_columns(response_id, code)' },
    { id: 'c2', text: 'Codes are sensible', check: 'LLM' },
  ],
};

test('a worker agent’s files must pass the tile’s automatic checks and cover every criterion', () => {
  const good = WorkResult.parse({ approach: ['Coded each response.'], files: [{ name: 'coded_01.csv', content: 'response_id,code\nr1,A\n' }], notes: 'ok', checklist: [{ criterionId: 'c1', done: true, note: '' }, { criterionId: 'c2', done: true, note: '' }] });
  assert.deepEqual(worker.validate(good, { tile }), []);
  const bad = WorkResult.parse({ approach: ['Coded.'], files: [{ name: 'coded_01.xlsx', content: 'x' }, { name: 'notes.md', content: '  ' }], notes: '', checklist: [{ criterionId: 'c1', done: true, note: '' }] });
  const problems = worker.validate(bad, { tile });
  assert.ok(problems.some((p) => /text formats only/.test(p)));
  assert.ok(problems.some((p) => /notes\.md is empty/.test(p)));
  assert.ok(problems.some((p) => /missing criterionId\(s\): c2/.test(p)));
  assert.ok(problems.some((p) => /AUTO check csv_columns/.test(p)));
});

test('files the swarm merged count toward the checks without the agent writing them', () => {
  const t = { ...tile, acceptanceCriteria: [{ id: 'c1', text: 'Merged', check: 'AUTO', rule: 'csv_min_rows(3)' }] };
  const out = WorkResult.parse({ approach: ['Wrote the report.'], files: [{ name: 'report.md', content: '# Report\n' }], notes: '', checklist: [{ criterionId: 'c1', done: true, note: '' }] });
  const input = { tile: t };
  Object.defineProperty(input, 'precomputedFiles', { value: [{ name: 'coded_all.csv', text: 'a\n1\n2\n3\n' }], enumerable: false });
  assert.deepEqual(worker.validate(out, input), []);
  assert.deepEqual(workerFiles(out, input).map((f) => f.name), ['report.md', 'coded_all.csv']);
  assert.ok(!JSON.stringify(input).includes('coded_all'), 'merged files never reach the prompt');
});
