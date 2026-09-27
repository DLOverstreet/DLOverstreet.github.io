// The injectable clock. Every time-based rule (offer windows, claim expiry, rush pricing,
// seven-day auto-acceptance) reads time from here, so the demo can fast-forward and
// tests can freeze time.

export function createClock(state = {}) {
  const st = { mode: state.mode || 'running', offsetMs: state.offsetMs || 0, frozenAt: state.frozenAt || null };
  const listeners = new Set();
  return {
    now() {
      return st.mode === 'frozen' ? st.frozenAt + st.offsetMs : Date.now() + st.offsetMs;
    },
    advance(ms) {
      st.offsetMs += ms;
      for (const fn of listeners) fn(this.state());
    },
    freeze(at) {
      st.mode = 'frozen';
      st.frozenAt = at ?? Date.now();
      st.offsetMs = 0;
      for (const fn of listeners) fn(this.state());
    },
    /** Back to real time, shifted by offsetMs. */
    run(offsetMs = 0) {
      st.mode = 'running';
      st.frozenAt = null;
      st.offsetMs = offsetMs;
      for (const fn of listeners) fn(this.state());
    },
    state() { return { ...st }; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
