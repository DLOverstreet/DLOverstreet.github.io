// IndexedDB plumbing for the browser build: one database with three object stores.
//   world: the whole database snapshot (key "current")
//   blobs: uploaded and generated files, by storage key
//   keys:  the demo platform's Ed25519 signing key pair (non-extractable CryptoKeys)

const DB_NAME = 'tessera';
const DB_VERSION = 1;

export function openIdb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ['world', 'blobs', 'keys']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

export function idbRequest(idb, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}
