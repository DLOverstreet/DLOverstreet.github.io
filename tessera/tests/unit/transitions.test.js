import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileTransitions, commissionTransitions, canTransition, assertTileTransition, assertCommissionTransition, TransitionError } from '../../src/domain/transitions.js';

/** @type {[string, Record<string, readonly string[]>, (from: string, to: string) => void][]} */
const MACHINES = [['tile', tileTransitions, assertTileTransition], ['commission', commissionTransitions, assertCommissionTransition]];
for (const [name, map, assertFn] of MACHINES) {
  const states = Object.keys(map);
  test(`${name}: every allowed transition is accepted`, () => {
    let n = 0;
    for (const from of states) for (const to of map[from]) { assert.ok(canTransition(map, from, to)); assert.doesNotThrow(() => assertFn(from, to)); n++; }
    assert.ok(n > 0);
  });
  test(`${name}: every disallowed transition is rejected`, () => {
    let n = 0;
    for (const from of states) {
      for (const to of states) {
        if (map[from].includes(to)) continue;
        assert.equal(canTransition(map, from, to), false, `${from} -> ${to}`);
        assert.throws(() => assertFn(from, to), TransitionError);
        n++;
      }
    }
    assert.equal(n, states.length * states.length - Object.values(map).reduce((a, v) => a + v.length, 0));
  });
  test(`${name}: unknown states are rejected`, () => {
    assert.throws(() => assertFn('NOPE', states[0]), TransitionError);
    assert.throws(() => assertFn(states[0], 'NOPE'), TransitionError);
  });
}

test('terminal states have no exits', () => {
  assert.deepEqual(tileTransitions.ACCEPTED, []);
  assert.deepEqual(tileTransitions.CANCELLED, []);
  assert.deepEqual(commissionTransitions.ACCEPTED, []);
  assert.deepEqual(commissionTransitions.CANCELLED, []);
});
