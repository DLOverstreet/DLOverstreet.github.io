// Tile graph checks and layout. A tile opens once every tile it depends on is accepted.

export function validateGraph(tiles) {
  const issues = [];
  const keys = new Set();
  for (const t of tiles) {
    if (keys.has(t.key)) issues.push({ code: 'duplicate-key', key: t.key, message: `Two tiles share the key "${t.key}"` });
    keys.add(t.key);
    if (!/^[a-z0-9-]+$/.test(t.key)) issues.push({ code: 'bad-key', key: t.key, message: `Key "${t.key}" must be kebab-case` });
  }
  for (const t of tiles) {
    for (const d of t.dependsOn || []) {
      if (d === t.key) issues.push({ code: 'self-dependency', key: t.key, message: `"${t.key}" depends on itself` });
      else if (!keys.has(d)) issues.push({ code: 'missing-dependency', key: t.key, message: `"${t.key}" depends on "${d}", which isn't in the graph` });
    }
    const ids = new Set();
    for (const c of t.acceptanceCriteria || []) {
      if (ids.has(c.id)) issues.push({ code: 'duplicate-criterion', key: t.key, message: `"${t.key}" has two criteria with id "${c.id}"` });
      ids.add(c.id);
    }
    if (!(t.acceptanceCriteria || []).length) issues.push({ code: 'no-criteria', key: t.key, message: `"${t.key}" has no acceptance criteria` });
  }
  const cycle = findCycle(tiles);
  if (cycle) issues.push({ code: 'cycle', key: cycle[0], message: `Dependency loop: ${cycle.join(' → ')}` });
  if (!tiles.some((t) => t.kind === 'WORK')) issues.push({ code: 'no-work', message: 'The graph has no WORK tiles' });
  return issues;
}

export function findCycle(tiles) {
  const deps = new Map(tiles.map((t) => [t.key, (t.dependsOn || []).filter((d) => d !== t.key)]));
  const state = new Map();
  const stack = [];
  function visit(k) {
    state.set(k, 1);
    stack.push(k);
    for (const d of deps.get(k) || []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.get(d)) { const c = visit(d); if (c) return c; }
    }
    stack.pop();
    state.set(k, 2);
    return null;
  }
  for (const t of tiles) {
    if (!state.get(t.key)) { const c = visit(t.key); if (c) return c; }
  }
  return null;
}

/** Keys in dependency order. Throws on a cycle. */
export function topoSort(tiles) {
  if (findCycle(tiles)) throw new Error('Graph has a cycle');
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const out = [];
  const seen = new Set();
  function visit(k) {
    if (seen.has(k)) return;
    seen.add(k);
    for (const d of byKey.get(k)?.dependsOn || []) if (byKey.has(d)) visit(d);
    out.push(k);
  }
  for (const t of tiles) visit(t.key);
  return out;
}

/** Longest-path layer for each key: sources are layer 0. */
export function layerOf(tiles) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const memo = new Map();
  function layer(k, guard = new Set()) {
    if (memo.has(k)) return memo.get(k);
    if (guard.has(k)) return 0;
    guard.add(k);
    const deps = (byKey.get(k)?.dependsOn || []).filter((d) => byKey.has(d));
    const l = deps.length ? 1 + Math.max(...deps.map((d) => layer(d, guard))) : 0;
    memo.set(k, l);
    return l;
  }
  for (const t of tiles) layer(t.key);
  return memo;
}

/**
 * Left-to-right layered layout with one barycenter pass to reduce crossings.
 * @returns {{ nodes: {key: string, x: number, y: number, layer: number}[], edges: {from: string, to: string, d: string}[], width: number, height: number, nodeW: number, nodeH: number }}
 */
export function layoutGraph(tiles, { nodeW = 200, nodeH = 76, gapX = 64, gapY = 22, pad = 16 } = {}) {
  const layers = layerOf(tiles);
  const cols = [];
  for (const t of tiles) (cols[layers.get(t.key)] ||= []).push(t);
  const row = new Map();
  cols.forEach((col, ci) => {
    if (ci > 0) {
      const bary = (t) => {
        const ds = (t.dependsOn || []).filter((d) => row.has(d));
        return ds.length ? ds.reduce((n, d) => n + row.get(d), 0) / ds.length : 0;
      };
      col.sort((a, b) => bary(a) - bary(b) || a.key.localeCompare(b.key));
    }
    col.forEach((t, i) => row.set(t.key, i));
  });
  const maxRows = Math.max(1, ...cols.map((c) => (c ? c.length : 0)));
  const height = pad * 2 + maxRows * nodeH + (maxRows - 1) * gapY;
  const pos = new Map();
  const nodes = [];
  cols.forEach((col, ci) => {
    const colH = col.length * nodeH + (col.length - 1) * gapY;
    const top = pad + (height - pad * 2 - colH) / 2;
    col.forEach((t, i) => {
      const n = { key: t.key, x: pad + ci * (nodeW + gapX), y: top + i * (nodeH + gapY), layer: ci };
      pos.set(t.key, n);
      nodes.push(n);
    });
  });
  const edges = [];
  for (const t of tiles) {
    for (const d of t.dependsOn || []) {
      const a = pos.get(d);
      const b = pos.get(t.key);
      if (!a || !b) continue;
      const x1 = a.x + nodeW; const y1 = a.y + nodeH / 2;
      const x2 = b.x; const y2 = b.y + nodeH / 2;
      const mx = (x1 + x2) / 2;
      edges.push({ from: d, to: t.key, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 6},${y2}` });
    }
  }
  const width = pad * 2 + cols.length * nodeW + Math.max(0, cols.length - 1) * gapX;
  return { nodes, edges, width, height, nodeW, nodeH };
}
