// A small transactional store over plain objects. Transactions are synchronous: they
// either commit every change or roll all of them back, like a database transaction.
import { TABLES, APPEND_ONLY, ID_PREFIX } from './schema.js';
import { hashString } from '../lib/util.js';

export class AppendOnlyError extends Error {
  constructor(table, op) { super(`${table} is append-only; ${op} is not allowed`); this.name = 'AppendOnlyError'; }
}

/**
 * @param {object} world a world object from emptyWorld() or a saved snapshot
 * @param {{ now: () => number }} clock
 */
export function createDb(world, clock) {
  const listeners = new Set();
  let current = null; // active transaction
  let version = 0;

  function nextId(table) {
    world.meta.idCounter += 1;
    const n = world.meta.idCounter;
    const tail = hashString(`${world.meta.seed}:${n}`).toString(36).padStart(7, '0').slice(0, 5);
    return `${ID_PREFIX[table] || 'id'}_${n.toString(36)}${tail}`;
  }

  const read = {
    get(table, id) { return id ? world.tables[table][id] || null : null; },
    all(table) { return Object.values(world.tables[table]); },
    filter(table, pred) { return Object.values(world.tables[table]).filter(pred); },
    find(table, pred) { return Object.values(world.tables[table]).find(pred) || null; },
    count(table, pred) { let n = 0; for (const r of Object.values(world.tables[table])) if (!pred || pred(r)) n++; return n; },
    get meta() { return world.meta; },
    now() { return clock.now(); },
  };

  function makeTx(actor) {
    const undo = [];
    const touched = new Set();
    const afterCommit = [];
    const tx = {
      ...read,
      get meta() { return world.meta; },
      actor,
      touched,
      insert(table, row) {
        if (!TABLES.includes(table)) throw new Error(`Unknown table ${table}`);
        const id = row.id || nextId(table);
        if (world.tables[table][id]) throw new Error(`${table} ${id} already exists`);
        const full = { createdAt: clock.now(), ...row, id };
        world.tables[table][id] = full;
        undo.push(() => { delete world.tables[table][id]; });
        touched.add(table);
        return full;
      },
      update(table, id, patch) {
        if (APPEND_ONLY.includes(table)) throw new AppendOnlyError(table, 'update');
        const prev = world.tables[table][id];
        if (!prev) throw new Error(`${table} ${id} not found`);
        const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch), id, updatedAt: clock.now() };
        world.tables[table][id] = next;
        undo.push(() => { world.tables[table][id] = prev; });
        touched.add(table);
        return next;
      },
      remove(table, id) {
        if (APPEND_ONLY.includes(table)) throw new AppendOnlyError(table, 'delete');
        const prev = world.tables[table][id];
        if (!prev) return;
        delete world.tables[table][id];
        undo.push(() => { world.tables[table][id] = prev; });
        touched.add(table);
      },
      setMeta(patch) {
        const prev = world.meta;
        world.meta = { ...prev, ...patch };
        undo.push(() => { world.meta = prev; });
        touched.add('meta');
      },
      enqueue(type, payload = {}, { delayMs = 0, dedupeKey = null } = {}) {
        if (dedupeKey) {
          const existing = Object.values(world.tables.Job).find((j) => j.dedupeKey === dedupeKey && (j.status === 'PENDING' || j.status === 'RUNNING'));
          if (existing) return existing;
        }
        return tx.insert('Job', { type, payload, status: 'PENDING', attempts: 0, runAfter: clock.now() + delayMs, lastError: null, dedupeKey });
      },
      /** Runs after the transaction commits (for work that must not be rolled back into). */
      after(fn) { afterCommit.push(fn); },
      _rollback() { for (let i = undo.length - 1; i >= 0; i--) undo[i](); },
      _afterCommit: afterCommit,
    };
    return tx;
  }

  function tx(fn, { actor = null } = {}) {
    if (current) return fn(current); // nested calls join the open transaction
    const t = makeTx(actor);
    current = t;
    let result;
    try {
      result = fn(t);
      if (result && typeof result.then === 'function') throw new Error('Transactions must be synchronous');
    } catch (e) {
      t._rollback();
      current = null;
      throw e;
    }
    current = null;
    if (t.touched.size) {
      version += 1;
      const change = { version, tables: t.touched };
      for (const l of listeners) { try { l(change); } catch (err) { console.error(err); } }
    }
    for (const fn2 of t._afterCommit) { try { fn2(); } catch (err) { console.error(err); } }
    return result;
  }

  return {
    ...read,
    tx,
    get version() { return version; },
    get meta() { return world.meta; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot() { return world; },
    replaceWorld(next) {
      world = next;
      version += 1;
      for (const l of listeners) l({ version, tables: new Set([...TABLES, 'meta']) });
    },
    get inTransaction() { return !!current; },
  };
}
