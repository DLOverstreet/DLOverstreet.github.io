import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, AppendOnlyError } from '../../src/db/db.js';
import { emptyWorld } from '../../src/db/schema.js';
import { createClock } from '../../src/lib/clock.js';

const mk = () => createDb(emptyWorld({ seed: 't' }), createClock({ mode: 'frozen', frozenAt: 1000 }));

test('a failed transaction rolls back every change', () => {
  const db = mk();
  const u = db.tx((tx) => tx.insert('User', { name: 'a' }));
  assert.throws(() => db.tx((tx) => {
    tx.update('User', u.id, { name: 'b' });
    tx.insert('User', { name: 'c' });
    throw new Error('boom');
  }));
  assert.equal(db.get('User', u.id).name, 'a');
  assert.equal(db.count('User'), 1);
});

test('LedgerEntry and ReputationEvent are append-only', () => {
  const db = mk();
  const e = db.tx((tx) => tx.insert('LedgerEntry', { type: 'ESCROW_FUND', amountCents: 5 }));
  const r = db.tx((tx) => tx.insert('ReputationEvent', { reason: 'ACCEPTED' }));
  assert.throws(() => db.tx((tx) => tx.update('LedgerEntry', e.id, { amountCents: 6 })), AppendOnlyError);
  assert.throws(() => db.tx((tx) => tx.remove('LedgerEntry', e.id)), AppendOnlyError);
  assert.throws(() => db.tx((tx) => tx.update('ReputationEvent', r.id, { reason: 'X' })), AppendOnlyError);
  assert.throws(() => db.tx((tx) => tx.remove('ReputationEvent', r.id)), AppendOnlyError);
});

test('ids are deterministic for a given seed', () => {
  const a = mk().tx((tx) => tx.insert('Tile', {})).id;
  const b = mk().tx((tx) => tx.insert('Tile', {})).id;
  assert.equal(a, b);
});

test('nested transactions join the outer one', () => {
  const db = mk();
  let seen = 0;
  db.subscribe(() => seen++);
  db.tx(() => { db.tx((tx) => tx.insert('User', { name: 'x' })); db.tx((tx) => tx.insert('User', { name: 'y' })); });
  assert.equal(seen, 1);
});
