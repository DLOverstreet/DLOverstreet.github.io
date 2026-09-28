// Boots the prototype: opens browser storage, builds (or seeds) the world, starts the
// worker and renders the app. URL flags, mostly for tests and demos:
//   ?reset=1            start from a fresh seed
//   ?seed=abc           id seed for a fresh world (deterministic ids)
//   ?clock=<ISO time>   freeze a fresh world's clock at that instant
//   ?crowd=off          start with the crowd simulation off
//   ?fast=1             no animations (for screenshots)
import { html, render } from '../../vendor/preact.js';
import { createTessera } from '../services/index.js';
import { openIdb } from '../storage/idb.js';
import { createIdbWorldStore, createIdbBlobStore, createIdbKeyStore, createMemoryWorldStore, createMemoryBlobStore, createMemoryKeyStore, createSecretStore } from '../storage/stores.js';
import { ensureSigningKey } from '../services/profiles.js';
import { TesseraContext } from './state.js';
import { App } from './app.js';
import { applyTheme } from './views/settings.js';

async function boot() {
  const params = new URLSearchParams(location.search);
  try { applyTheme(localStorage.getItem('tessera.theme') || 'system'); } catch { /* storage blocked */ }
  let stores;
  let banner = null;
  try {
    const idb = await openIdb();
    stores = { worldStore: createIdbWorldStore(idb), blobs: createIdbBlobStore(idb), keystore: createIdbKeyStore(idb) };
  } catch (e) {
    console.warn('IndexedDB unavailable, using memory', e);
    stores = { worldStore: createMemoryWorldStore(), blobs: createMemoryBlobStore(), keystore: createMemoryKeyStore() };
    banner = 'This browser won’t let the page store data, so the demo resets when you close the tab.';
  }
  if (params.get('reset') === '1') {
    await stores.worldStore.clear();
    await stores.blobs.clear();
    params.delete('reset');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
  }
  const clockParam = params.get('clock');
  const frozenAt = clockParam ? Date.parse(clockParam) : null;
  const splash = document.getElementById('boot-status');
  if (splash) splash.textContent = 'Setting up the demo world…';
  const T = await createTessera({
    ...stores,
    secrets: createSecretStore(),
    seed: params.get('seed') || `web-${Date.now().toString(36)}`,
    frozenAt: Number.isFinite(frozenAt) ? frozenAt : null,
    crowd: params.get('crowd') === 'off' ? false : undefined,
    swarmPaceMs: params.get('fast') === '1' ? 0 : 1200,
  });
  T.stores = stores;
  if (params.get('crowd') === 'off' && T.db.meta.settings.crowd) T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, crowd: false } }));
  if (params.get('fast') === '1') document.documentElement.classList.add('fast');
  window.tessera = T; // handy in the console, and used by the end-to-end tests
  T.worker.start();
  T.swarm.start();
  ensureSigningKey(T).catch((e) => console.warn('Signing key unavailable:', e.message));

  // A second tab would write over this one's database; warn instead of corrupting it.
  try {
    const ch = new BroadcastChannel('tessera');
    ch.onmessage = (m) => { if (m.data === 'hello') ch.postMessage('here'); if (m.data === 'here') { banner = 'Tessera is open in another tab. Use one tab at a time, or changes may be lost.'; draw(); } };
    ch.postMessage('hello');
  } catch { /* no BroadcastChannel */ }

  const root = document.getElementById('app');
  function draw() {
    render(html`<${TesseraContext.Provider} value=${T}><${App} banner=${banner} /><//>`, root);
  }
  root.innerHTML = '';
  draw();
  window.addEventListener('beforeunload', () => { T.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') T.flush(); });
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('app');
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'card bad';
  box.style.margin = '2rem auto';
  box.style.maxWidth = '640px';
  box.innerHTML = '<h1>Tessera couldn’t start</h1><p class="small" style="margin-top:.5rem"></p><p class="small" style="margin-top:.5rem"><a href="?reset=1">Reset the demo and try again</a></p>';
  box.querySelector('p').textContent = e.message || String(e);
  el.appendChild(box);
});
