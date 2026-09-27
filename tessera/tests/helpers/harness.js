// Builds a Tessera instance with in-memory storage for tests and scripts.
import { createTessera } from '../../src/services/index.js';
import { createMemoryWorldStore, createMemoryBlobStore, createMemoryKeyStore, createSecretStore } from '../../src/storage/stores.js';

export const FROZEN_AT = Date.UTC(2026, 9, 1, 16, 0, 0);

export async function makeTessera(opts = {}) {
  return createTessera({
    worldStore: createMemoryWorldStore(),
    blobs: createMemoryBlobStore(),
    keystore: createMemoryKeyStore(),
    secrets: createSecretStore(null),
    seed: 'test',
    frozenAt: FROZEN_AT,
    persistDelayMs: 5,
    ...opts,
  });
}
