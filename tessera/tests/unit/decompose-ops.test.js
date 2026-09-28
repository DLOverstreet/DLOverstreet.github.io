import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTile, mergeTiles, dropTile, addEdge, repairGraph, OpError } from '../../src/decompose/ops.js';
import { assessQuality } from '../../src/decompose/quality.js';
import { scheduleGraph } from '../../src/decompose/schedule.js';
import { disaggregate, applyFix } from '../../src/decompose/plan.js';
import { validateGraph } from '../../src/domain/graph.js';
import { JOBS } from '../fixtures/jobs.js';

const T = (key, dependsOn = [], extra = {}) => ({
  key, kind: 'WORK', title: key, spec: `Do ${key}. `.repeat(20), deliverableFormat: `${key}.md`, estMinutes: 60, tier: 2, skillTags: ['research'],
  acceptanceCriteria: [{ id: 'c1', text: 'Markdown', check: 'AUTO', rule: 'file_ext(md)' }], dependsOn, inputs: [], outputs: [`${key}.md`], ...extra,
});

test('splitting a batch halves its range and rewires its readers to both halves', () => {
  const r = disaggregate(JOBS.find((j) => j.id === 'survey'));
  const b = r.tiles.find((t) => t.key === 'code-response-01');
  const out = splitTile(r.tiles, b.key);
  const halves = out.filter((t) => t.partOf === b.partOf && t.key.startsWith(b.key));
  assert.equal(halves.length, 2);
  assert.deepEqual(halves.map((h) => [h.part.from, h.part.to]), [[1, 20], [21, 40]]);
  assert.ok(halves.every((h) => h.acceptanceCriteria.some((c) => c.rule === 'csv_min_rows(20)')));
  const readers = out.filter((t) => t.dependsOn.includes(halves[0].key));
  assert.ok(readers.length && readers.every((t) => t.dependsOn.includes(halves[1].key) && !t.dependsOn.includes(b.key)));
  assert.deepEqual(validateGraph(out), []);
});

test('merging keeps one tile under two hours and refuses what would not fit', () => {
  const g = [T('a'), T('b'), T('c', ['a', 'b'])];
  const m = mergeTiles(g, ['a', 'b']);
  assert.equal(m.length, 2);
  assert.equal(m[0].estMinutes, 110);
  assert.deepEqual(m.find((t) => t.key === 'c').dependsOn, ['a']);
  assert.throws(() => mergeTiles([T('x', [], { estMinutes: 90 }), T('y', [], { estMinutes: 90 })], ['x', 'y']), OpError);
});

test('dropping a tile reconnects its readers to its own inputs', () => {
  const out = dropTile([T('a'), T('b', ['a'], { inputs: ['a.md'] }), T('c', ['b'], { inputs: ['b.md'] })], 'b');
  assert.deepEqual(out.find((t) => t.key === 'c').dependsOn, ['a']);
  assert.deepEqual(out.find((t) => t.key === 'c').inputs, ['a.md']);
});

test('an edge that would make a loop is refused', () => {
  assert.throws(() => addEdge([T('a'), T('b', ['a'])], 'b', 'a'), OpError);
});

test('repair fixes loops, missing tiles, oversize tiles and hidden dependencies, and adds an assembly', () => {
  const broken = [
    T('a', ['b']), T('b', ['a']), T('c', ['ghost'], { estMinutes: 200 }),
    T('d', [], { inputs: ['a.md'] }), T('e'),
  ];
  const { tiles, changes } = repairGraph(broken);
  assert.deepEqual(validateGraph(tiles), []);
  assert.ok(tiles.every((t) => t.estMinutes <= 120));
  assert.ok(tiles.find((t) => t.key === 'd').dependsOn.includes('a'), 'd reads a.md, so it waits for a');
  assert.ok(tiles.some((t) => t.kind === 'INTEGRATION'));
  assert.ok(changes.length >= 4);
});

test('the quality report finds a hidden dependency and its fix removes it', () => {
  const g = [T('a'), T('b', [], { inputs: ['a.md'] }), T('c', ['b'])];
  const q = assessQuality(g);
  const issue = q.issues.find((i) => i.code === 'hidden-dependency');
  assert.ok(issue);
  const fixed = applyFix(g, issue.fix);
  assert.ok(!assessQuality(fixed).issues.some((i) => i.code === 'hidden-dependency'));
});

test('the schedule finds the longest chain and how many people can work at once', () => {
  const s = scheduleGraph([T('a'), T('b', ['a']), T('c', ['a']), T('d', ['b', 'c'], { estMinutes: 30 })]);
  assert.equal(s.span, 150);
  assert.equal(s.total, 210);
  assert.equal(s.width, 2);
  assert.equal(s.criticalPath[0], 'a');
  assert.equal(s.criticalPath[s.criticalPath.length - 1], 'd');
});
