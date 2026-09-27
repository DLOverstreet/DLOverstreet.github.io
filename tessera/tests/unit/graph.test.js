import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph, topoSort, layoutGraph, findCycle } from '../../src/domain/graph.js';

const T = (key, dependsOn = [], extra = {}) => ({ key, kind: 'WORK', dependsOn, acceptanceCriteria: [{ id: 'c1' }], ...extra });

test('a valid graph has no issues and sorts upstream first', () => {
  const g = [T('c', ['a', 'b']), T('a'), T('b', ['a'])];
  assert.deepEqual(validateGraph(g), []);
  assert.deepEqual(topoSort(g), ['a', 'b', 'c']);
});

test('finds cycles, missing dependencies and duplicate criterion ids', () => {
  const codes = (g) => validateGraph(g).map((i) => i.code).sort();
  assert.ok(findCycle([T('a', ['b']), T('b', ['a'])]));
  assert.deepEqual(codes([T('a', ['b']), T('b', ['a'])]), ['cycle']);
  assert.deepEqual(codes([T('a', ['zzz'])]), ['missing-dependency']);
  assert.deepEqual(codes([T('a', [], { acceptanceCriteria: [{ id: 'c1' }, { id: 'c1' }] })]), ['duplicate-criterion']);
  assert.deepEqual(codes([T('a'), T('a')]), ['duplicate-key']);
  assert.deepEqual(codes([T('a', [], { kind: 'REVIEW' })]), ['no-work']);
});

test('layout puts every node left of its dependents', () => {
  const g = [T('a'), T('b', ['a']), T('c', ['a']), T('d', ['b', 'c'])];
  const L = layoutGraph(g);
  const x = Object.fromEntries(L.nodes.map((n) => [n.key, n.x]));
  assert.ok(x.a < x.b && x.b === x.c && x.c < x.d);
  assert.equal(L.edges.length, 4);
});
