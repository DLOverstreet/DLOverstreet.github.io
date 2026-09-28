// App-wide state: the Tessera instance in context, hooks that re-render on database
// changes and clock ticks, hash routing, the active persona, and toasts.
import { createContext, useContext, useEffect, useState } from '../../vendor/preact.js';

export const TesseraContext = createContext(null);
export const useT = () => useContext(TesseraContext);

/** Re-renders the calling component whenever the database commits (at most once per frame). */
export function useDbVersion() {
  const T = useT();
  const [v, setV] = useState(T.db.version);
  useEffect(() => {
    let raf = 0;
    const off = T.db.subscribe(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setV(T.db.version); });
    });
    return () => { off(); cancelAnimationFrame(raf); };
  }, [T]);
  return v;
}

/** The simulated clock's current time, refreshed every `ms`. */
export function useNow(ms = 1000) {
  const T = useT();
  const [now, setNow] = useState(T.clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(T.clock.now()), ms);
    const off = T.clock.onChange(() => setNow(T.clock.now()));
    return () => { clearInterval(id); off(); };
  }, [T, ms]);
  return now;
}

export function parseHash(hash = location.hash) {
  const [p, q = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(q)) };
}

export function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(to) {
  if (location.hash !== to) location.hash = to;
}

export function currentUser(T) {
  return T.db.get('User', T.db.meta.activePersonaId);
}

export function setPersona(T, id) {
  T.db.tx((tx) => {
    const human = new Set(tx.meta.humanPersonaIds || []);
    if (id) human.add(id);
    tx.setMeta({ activePersonaId: id, humanPersonaIds: [...human] });
  });
  // Save now rather than after the usual short delay, so a reload right after switching keeps it.
  T.flush?.();
}

// ---- toasts ----
const toastListeners = new Set();
let toastSeq = 0;
export function toast(message, kind = 'info', ms = 4200) {
  const t = { id: ++toastSeq, message, kind, ms };
  for (const l of toastListeners) l(t);
}
export function onToast(fn) { toastListeners.add(fn); return () => toastListeners.delete(fn); }

/** Runs an action, shows its error as a toast, and optionally a success toast. */
export async function act(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok');
    return r;
  } catch (e) {
    console.warn(e);
    toast(e.message || String(e), 'err', 7000);
    return undefined;
  }
}

export function downloadBytes(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, name, type = 'text/plain') {
  downloadBytes(new TextEncoder().encode(text), name, type);
}
