// When each tile can run if everyone starts the moment their inputs exist: earliest start
// and finish, the critical path, how many people can work at once, and rows for a timeline.
import { findCycle } from '../domain/graph.js';

/**
 * @param {{key:string, estMinutes:number, dependsOn?:string[], stream?:string}[]} tiles
 */
export function scheduleGraph(tiles) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const empty = { start: new Map(), finish: new Map(), span: 0, total: 0, critical: new Set(), criticalPath: [], width: 0, speedup: 1, rows: [] };
  if (!tiles.length || findCycle(tiles)) return empty;
  const start = new Map();
  const finish = new Map();
  const via = new Map();
  const visit = (k) => {
    if (finish.has(k)) return finish.get(k);
    const t = byKey.get(k);
    let s = 0;
    let from = null;
    for (const d of t.dependsOn || []) {
      if (!byKey.has(d)) continue;
      const f = visit(d);
      if (f > s) { s = f; from = d; }
    }
    start.set(k, s);
    finish.set(k, s + (t.estMinutes || 0));
    via.set(k, from);
    return finish.get(k);
  };
  for (const t of tiles) visit(t.key);
  const total = tiles.reduce((n, t) => n + (t.estMinutes || 0), 0);
  let end = null;
  for (const t of tiles) if (!end || finish.get(t.key) > finish.get(end)) end = t.key;
  const criticalPath = [];
  for (let k = end; k; k = via.get(k)) criticalPath.unshift(k);
  const span = end ? finish.get(end) : 0;
  // Most tiles running at the same moment.
  const events = tiles.flatMap((t) => [[start.get(t.key), 1], [finish.get(t.key), -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let width = 0;
  for (const [, d] of events) { cur += d; width = Math.max(width, cur); }
  // Timeline rows: each stream packs its tiles into as few rows as overlaps allow.
  const rows = [];
  const streams = [];
  for (const t of tiles) if (!streams.includes(t.stream || 'Work')) streams.push(t.stream || 'Work');
  for (const s of streams) {
    const list = tiles.filter((t) => (t.stream || 'Work') === s).sort((a, b) => start.get(a.key) - start.get(b.key));
    const lanes = [];
    for (const t of list) {
      let lane = lanes.find((l) => l.end <= start.get(t.key));
      if (!lane) { lane = { stream: s, end: 0, keys: [] }; lanes.push(lane); }
      lane.keys.push(t.key);
      lane.end = finish.get(t.key);
    }
    rows.push(...lanes.map((l, i) => ({ stream: s, lane: i, keys: l.keys })));
  }
  return { start, finish, span, total, critical: new Set(criticalPath), criticalPath, width, speedup: span ? total / span : 1, rows };
}

/** Calendar estimate: hours of work on the critical path, spread over working days. */
export function calendarDays(spanMinutes, { hoursPerDay = 3, handoffHours = 12, steps = 1 } = {}) {
  return Math.max(1, Math.ceil((spanMinutes / 60 + Math.max(0, steps - 1) * handoffHours / 3) / hoursPerDay));
}
