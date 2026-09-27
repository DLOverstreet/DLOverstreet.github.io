// Storage adapters. The browser uses IndexedDB; tests and scripts use memory. The same
// interfaces let the services run unchanged in both.
import { idbRequest } from './idb.js';

export function createMemoryWorldStore(initial = null) {
  let saved = initial;
  return {
    kind: 'memory',
    async load() { return saved ? JSON.parse(JSON.stringify(saved)) : null; },
    async save(world) { saved = JSON.parse(JSON.stringify(world)); },
    async clear() { saved = null; },
  };
}

export function createIdbWorldStore(idb) {
  return {
    kind: 'indexeddb',
    async load() { return (await idbRequest(idb, 'world', 'readonly', (s) => s.get('current'))) || null; },
    async save(world) { await idbRequest(idb, 'world', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(world)), 'current')); },
    async clear() { await idbRequest(idb, 'world', 'readwrite', (s) => s.delete('current')); },
  };
}

export function createMemoryBlobStore() {
  const map = new Map();
  return {
    async put(key, bytes) { map.set(key, new Uint8Array(bytes)); },
    async get(key) { return map.get(key) || null; },
    async remove(key) { map.delete(key); },
    async clear() { map.clear(); },
    async keys() { return [...map.keys()]; },
  };
}

export function createIdbBlobStore(idb) {
  return {
    async put(key, bytes) { await idbRequest(idb, 'blobs', 'readwrite', (s) => s.put(new Uint8Array(bytes), key)); },
    async get(key) {
      const v = await idbRequest(idb, 'blobs', 'readonly', (s) => s.get(key));
      return v ? new Uint8Array(v) : null;
    },
    async remove(key) { await idbRequest(idb, 'blobs', 'readwrite', (s) => s.delete(key)); },
    async clear() { await idbRequest(idb, 'blobs', 'readwrite', (s) => s.clear()); },
    async keys() { return idbRequest(idb, 'blobs', 'readonly', (s) => s.getAllKeys()); },
  };
}

/** Where the demo platform's signing key lives. In IndexedDB the private key stays non-extractable. */
export function createIdbKeyStore(idb) {
  return {
    async get() { return (await idbRequest(idb, 'keys', 'readonly', (s) => s.get('platform'))) || null; },
    async put(value) { await idbRequest(idb, 'keys', 'readwrite', (s) => s.put(value, 'platform')); },
    async clear() { await idbRequest(idb, 'keys', 'readwrite', (s) => s.delete('platform')); },
  };
}

export function createMemoryKeyStore() {
  let v = null;
  return { async get() { return v; }, async put(x) { v = x; }, async clear() { v = null; } };
}

/**
 * API keys. They live in this browser's localStorage only, under their own prefix, and are
 * never part of the database, its snapshots or its exports.
 */
export function createSecretStore(backend = typeof localStorage !== 'undefined' ? localStorage : null) {
  const PREFIX = 'tessera.secret.';
  const memory = new Map();
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  return {
    get(name) { return backend ? safe(() => backend.getItem(PREFIX + name), null) ?? memory.get(name) ?? null : memory.get(name) ?? null; },
    set(name, value) {
      if (!value) return this.remove(name);
      if (!backend || !safe(() => { backend.setItem(PREFIX + name, value); return true; }, false)) memory.set(name, value);
    },
    remove(name) { memory.delete(name); if (backend) safe(() => backend.removeItem(PREFIX + name)); },
    has(name) { return !!this.get(name); },
  };
}
