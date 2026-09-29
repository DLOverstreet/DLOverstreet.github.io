// Edits to a tile graph that keep it valid: split a tile in two, merge tiles, drop a tile
// and reconnect its neighbors, add or remove an edge, and repair a graph from any source
// (a model, an old plan, a hand edit). Every function returns new tiles and leaves its input alone.
import { findCycle } from '../domain/graph.js';
import { LIMITS, TILE_OVERHEAD, clampMinutes } from './rates.js';

const clone = (tiles) => tiles.map((t) => ({ ...t, dependsOn: [...(t.dependsOn || [])], acceptanceCriteria: (t.acceptanceCriteria || []).map((c) => ({ ...c })), inputs: [...(t.inputs || [])], outputs: [...(t.outputs || [])] }));
const kebab = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tile';
const renumber = (criteria) => criteria.map((c, i) => ({ ...c, id: `c${i + 1}` }));

export class OpError extends Error {}

function uniqueKey(tiles, base) {
  const keys = new Set(tiles.map((t) => t.key));
  let k = kebab(base);
  let n = 2;
  while (keys.has(k)) k = `${kebab(base)}-${n++}`;
  return k;
}

/** Ancestors of a key (every tile it waits on, directly or not). */
export function ancestors(tiles, key) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const seen = new Set();
  const walk = (k) => { for (const d of byKey.get(k)?.dependsOn || []) if (!seen.has(d)) { seen.add(d); walk(d); } };
  walk(key);
  return seen;
}

/** Removes a tile and reconnects its dependents to its own upstream tiles. */
export function dropTile(input, key) {
  const tiles = clone(input);
  const gone = tiles.find((t) => t.key === key);
  if (!gone) return tiles;
  const out = tiles.filter((t) => t.key !== key);
  for (const t of out) {
    if (!t.dependsOn.includes(key)) { t.inputs = t.inputs.filter((f) => !gone.outputs.includes(f)); continue; }
    t.dependsOn = [...new Set([...t.dependsOn.filter((d) => d !== key), ...gone.dependsOn])].filter((d) => d !== t.key);
    t.inputs = [...new Set([...t.inputs.filter((f) => !gone.outputs.includes(f)), ...gone.inputs.filter((f) => !/requester/.test(f))])];
  }
  return out;
}

export function addEdge(input, from, to) {
  const tiles = clone(input);
  const a = tiles.find((t) => t.key === from);
  const b = tiles.find((t) => t.key === to);
  if (!a || !b) throw new OpError('Both tiles must exist.');
  if (from === to) throw new OpError('A tile can’t wait on itself.');
  if (b.dependsOn.includes(from)) return tiles;
  b.dependsOn.push(from);
  if (findCycle(tiles)) throw new OpError(`“${b.title}” can’t wait on “${a.title}”: that would make a loop.`);
  b.inputs = [...new Set([...b.inputs, ...a.outputs])];
  return tiles;
}

export function removeEdge(input, from, to) {
  const tiles = clone(input);
  const b = tiles.find((t) => t.key === to);
  const a = tiles.find((t) => t.key === from);
  if (!b) return tiles;
  b.dependsOn = b.dependsOn.filter((d) => d !== from);
  if (a) b.inputs = b.inputs.filter((f) => !a.outputs.includes(f));
  return tiles;
}

const suffixFile = (f, s) => f.replace(/(\.[a-z0-9]+)$/i, `_${s}$1`);

function scaleRule(rule, share) {
  return String(rule || '')
    .replace(/csv_min_rows\((\d+)\)/, (m, n) => `csv_min_rows(${Math.max(1, Math.floor(Number(n) * share))})`)
    .replace(/word_count\((\d+),\s*(\d+)\)/, (m, a, b) => `word_count(${Math.max(20, Math.round(Number(a) * share))}, ${Math.max(40, Math.round(Number(b) * share))})`)
    .replace(/min_files\((\d+)\)/, (m, n) => `min_files(${Math.max(1, Math.ceil(Number(n) * share))})`);
}

/**
 * Splits a tile into two that different people can do at the same time. A batch splits
 * its range; any other tile splits into two halves of the same spec.
 */
export function splitTile(input, key) {
  const tiles = clone(input);
  const i = tiles.findIndex((t) => t.key === key);
  if (i < 0) throw new OpError('No such tile.');
  const t = tiles[i];
  if (t.kind === 'INTEGRATION') throw new OpError('The final assembly is one person’s job; split the work before it instead.');
  if (t.estMinutes < 30) throw new OpError('This tile is already under 30 minutes; splitting it would cost more in handoffs than it saves.');
  const part = t.part && t.part.to > t.part.from ? t.part : null;
  const mid = part ? Math.floor((part.from + part.to) / 2) : 0;
  const halves = [0, 1].map((h) => {
    const share = part ? (h === 0 ? (mid - part.from + 1) : (part.to - mid)) / (part.to - part.from + 1) : 0.5;
    const range = part ? { ...part, from: h === 0 ? part.from : mid + 1, to: h === 0 ? mid : part.to } : null;
    const label = range ? relabel(part.label, range) : `part ${h + 1} of 2`;
    const suffix = h === 0 ? 'a' : 'b';
    return {
      ...t,
      key: uniqueKey(tiles, `${t.key}-${suffix}`),
      title: range && part.label ? t.title.replace(part.label, label) : `${t.title.replace(/:\s*part \d+ of \d+$/i, '')} (${label})`.slice(0, 80),
      spec: range ? t.spec.replace(new RegExp(escapeRe(part.label), 'g'), label) : `This is ${label} of one piece of work split between two people. Do the ${h === 0 ? 'first' : 'second'} half of what follows (by section, row or item order) and say in your notes where you started and stopped.\n\n${t.spec}`,
      estMinutes: clampMinutes(Math.max(LIMITS.min, (t.estMinutes - TILE_OVERHEAD) * share + TILE_OVERHEAD)),
      acceptanceCriteria: renumber(t.acceptanceCriteria.map((c) => (c.rule ? { ...c, rule: scaleRule(c.rule, share) } : c))),
      outputs: t.outputs.map((f) => suffixFile(f, suffix)),
      deliverableFormat: t.outputs.reduce((d, f) => d.split(f).join(suffixFile(f, suffix)), t.deliverableFormat),
      part: range ? { ...range, label, index: h + 1, of: 2 } : { index: h + 1, of: 2, from: h + 1, to: h + 1, label },
      partOf: t.partOf || t.key,
    };
  });
  tiles.splice(i, 1, ...halves);
  for (const o of tiles) {
    if (!o.dependsOn.includes(key)) continue;
    o.dependsOn = [...new Set([...o.dependsOn.filter((d) => d !== key), ...halves.map((h) => h.key)])];
    o.inputs = [...new Set([...o.inputs.filter((f) => !t.outputs.includes(f)), ...halves.flatMap((h) => h.outputs)])];
  }
  return tiles;
}

function relabel(label, range) {
  if (!label) return range.from === range.to ? `item ${range.from}` : `items ${range.from}–${range.to}`;
  const m = /^(.*?)(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)(.*)$/.exec(label);
  const fmt = (n) => n.toLocaleString('en-US');
  if (!m) return range.from === range.to ? `${label} ${range.from}` : `${label} ${range.from}–${range.to}`;
  const noun = m[1].trim();
  if (range.from === range.to) return `${noun.replace(/s$/, '')} ${fmt(range.from)}${m[4]}`.trim();
  return `${noun} ${fmt(range.from)}–${fmt(range.to)}${m[4]}`.trim();
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Merges tiles into one person's job, if the result still fits in a tile. */
export function mergeTiles(input, keys) {
  if (!Array.isArray(keys) || keys.length < 2) throw new OpError('Pick at least two tiles to merge.');
  const tiles = clone(input);
  const parts = keys.map((k) => tiles.find((t) => t.key === k));
  if (parts.some((p) => !p)) throw new OpError('Every tile to merge must exist.');
  if (parts.some((p) => p.kind === 'INTEGRATION')) throw new OpError('The final assembly can’t be merged into another tile.');
  const minutes = parts.reduce((n, p) => n + p.estMinutes, 0) - TILE_OVERHEAD * (parts.length - 1);
  if (minutes > LIMITS.max) throw new OpError(`Together these are about ${minutes} minutes, over the ${LIMITS.max}-minute limit for one tile.`);
  const set = new Set(keys);
  // Merging a tile with one that waits on it through a third tile would make a loop.
  for (const p of parts) for (const a of ancestors(tiles, p.key)) if (!set.has(a) && [...ancestors(tiles, a)].some((x) => set.has(x))) throw new OpError('These tiles have another tile between them, so merging them would make a loop.');
  const first = parts[0];
  const outputs = [...new Set(parts.flatMap((p) => p.outputs))];
  const merged = {
    ...first,
    title: mergedTitle(parts),
    spec: parts.map((p, i) => (i === 0 ? p.spec : `Also, as part of the same tile — ${p.title}:\n\n${p.spec.split('\n\n').filter((line) => !/^Context:/.test(line)).join('\n\n')}`)).join('\n\n'),
    deliverableFormat: parts.map((p) => p.deliverableFormat).join('; plus '),
    acceptanceCriteria: renumber(parts.flatMap((p) => p.acceptanceCriteria)),
    skillTags: [...new Set(parts.flatMap((p) => p.skillTags))].slice(0, 4),
    tier: Math.max(...parts.map((p) => p.tier)),
    estMinutes: clampMinutes(minutes),
    dependsOn: [...new Set(parts.flatMap((p) => p.dependsOn))].filter((d) => !set.has(d)),
    inputs: [...new Set(parts.flatMap((p) => p.inputs))].filter((f) => !outputs.includes(f)),
    outputs,
    sensitiveInputs: [...new Set(parts.flatMap((p) => p.sensitiveInputs || []))],
    languages: [...new Set(parts.flatMap((p) => p.languages || []))],
    covers: [...new Set(parts.flatMap((p) => p.covers || []))],
    part: null,
    partOf: parts.every((p) => p.partOf && p.partOf === first.partOf) ? first.partOf : null,
    priority: Math.min(...parts.map((p) => p.priority || 1)),
  };
  const out = [];
  for (const t of tiles) {
    if (t.key === first.key) out.push(merged);
    else if (!set.has(t.key)) out.push(t);
  }
  for (const t of out) {
    if (t === merged) continue;
    if (t.dependsOn.some((d) => set.has(d))) t.dependsOn = [...new Set(t.dependsOn.map((d) => (set.has(d) ? first.key : d)))];
  }
  return out;
}

function mergedTitle(parts) {
  const ranges = parts.map((p) => p.part).filter((p) => p && p.label);
  if (ranges.length === parts.length) {
    const from = Math.min(...ranges.map((r) => r.from));
    const to = Math.max(...ranges.map((r) => r.to));
    const label = relabel(ranges[0].label, { from, to });
    return parts[0].title.replace(ranges[0].label, label).slice(0, 80);
  }
  const t = `${parts[0].title} + ${parts.length - 1} more`;
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/** Output names mentioned in a deliverable description, for tiles that don't list them. */
export function filesIn(text) {
  return [...new Set((String(text || '').match(/[A-Za-z0-9_.-]+\.(?:csv|tsv|json|geojson|md|txt|pdf|png|jpg|svg|py|r|js|ts|html|css|sql|ipynb|yaml|yml|xml|xlsx|docx|zip)\b/gi) || []))];
}

/** Fills in inputs and outputs for tiles that came without them (a model's plan, an old draft). */
export function inferIO(input) {
  const tiles = clone(input);
  for (const t of tiles) if (!t.outputs.length) t.outputs = filesIn(t.deliverableFormat);
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  for (const t of tiles) {
    if (t.inputs.length) continue;
    const fromDeps = (t.dependsOn || []).flatMap((d) => byKey.get(d)?.outputs || []);
    const mentioned = filesIn(t.spec).filter((f) => !t.outputs.includes(f));
    t.inputs = [...new Set([...fromDeps, ...mentioned])];
  }
  return tiles;
}

/**
 * Makes any graph valid and well-formed, and says what it changed.
 * @returns {{ tiles: any[], changes: string[] }}
 */
/** A title cut to 80 characters at a word boundary. */
function shortTitle(title) {
  const t = String(title).trim();
  if (t.length <= 80) return t;
  const cut = t.slice(0, 79);
  const at = Math.max(cut.lastIndexOf(': '), cut.lastIndexOf(' ('), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[\s,:;–-]+$/, '')}…`;
}

export function repairGraph(input, { addIntegration = true } = {}) {
  let tiles = inferIO(input);
  const changes = [];
  // Titles: at most 80 characters (a model's long title isn't a reason to lose its plan).
  const long = tiles.filter((t) => String(t.title).length > 80);
  for (const t of long) t.title = shortTitle(t.title);
  if (long.length) changes.push(`Shortened ${long.length === 1 ? 'a title' : `${long.length} titles`} to 80 characters.`);
  // Keys: kebab-case and unique.
  const seen = new Set();
  const renamed = new Map();
  for (const t of tiles) {
    let k = kebab(t.key || t.title);
    if (seen.has(k)) { let n = 2; while (seen.has(`${k}-${n}`)) n++; k = `${k}-${n}`; }
    if (k !== t.key) { changes.push(`Renamed key “${t.key}” to “${k}”.`); renamed.set(t.key, k); }
    seen.add(k);
    t.key = k;
  }
  for (const t of tiles) t.dependsOn = t.dependsOn.map((d) => renamed.get(d) || d);
  // Dependencies that point nowhere or at the tile itself.
  const keys = new Set(tiles.map((t) => t.key));
  for (const t of tiles) {
    const bad = t.dependsOn.filter((d) => d === t.key || !keys.has(d));
    if (bad.length) { changes.push(`Removed ${bad.length === 1 ? 'a dependency' : `${bad.length} dependencies`} of “${t.title}” on missing tiles.`); t.dependsOn = t.dependsOn.filter((d) => !bad.includes(d)); }
    t.dependsOn = [...new Set(t.dependsOn)];
  }
  // Loops: cut the edge that closes each one.
  for (let guard = 0; guard < 50; guard++) {
    const cycle = findCycle(tiles);
    if (!cycle) break;
    const [from, to] = [cycle[cycle.length - 2], cycle[cycle.length - 1]];
    const t = tiles.find((x) => x.key === from);
    t.dependsOn = t.dependsOn.filter((d) => d !== to);
    changes.push(`Broke a dependency loop by removing “${from}” → waits on “${to}”.`);
  }
  // Hidden dependencies: a tile reads a file another tile makes but doesn't wait for it.
  const maker = new Map();
  for (const t of tiles) for (const f of t.outputs) if (!maker.has(f)) maker.set(f, t.key);
  for (const t of tiles) {
    for (const f of t.inputs) {
      const m = maker.get(f);
      if (!m || m === t.key || t.dependsOn.includes(m) || ancestors(tiles, t.key).has(m)) continue;
      t.dependsOn.push(m);
      if (findCycle(tiles)) { t.dependsOn.pop(); continue; }
      changes.push(`“${t.title}” reads ${f}, so it now waits for the tile that makes it.`);
    }
  }
  // Sizes and criteria.
  for (const t of [...tiles]) {
    if (!Number.isFinite(t.estMinutes)) t.estMinutes = 60;
    if (t.estMinutes > LIMITS.max) {
      changes.push(`Split “${t.title}” (${t.estMinutes} min) into two tiles.`);
      const big = t.estMinutes;
      t.estMinutes = LIMITS.max;
      tiles = splitTile(tiles, t.key);
      for (const h of tiles.filter((x) => x.partOf === t.key)) h.estMinutes = clampMinutes(big / 2 + 5);
      continue;
    }
    if (t.estMinutes < LIMITS.min) { changes.push(`Raised “${t.title}” to the ${LIMITS.min}-minute minimum.`); t.estMinutes = LIMITS.min; }
  }
  for (const t of tiles) {
    if (!t.acceptanceCriteria.length) { t.acceptanceCriteria = [{ id: 'c1', text: 'The deliverable matches the spec', check: 'LLM' }]; changes.push(`Added a criterion to “${t.title}”.`); }
    const ids = t.acceptanceCriteria.map((c) => c.id);
    if (new Set(ids).size !== ids.length || ids.some((id, i) => id !== `c${i + 1}`)) t.acceptanceCriteria = renumber(t.acceptanceCriteria);
    t.skillTags = [...new Set((t.skillTags || []).map(kebab))].filter(Boolean);
    if (!t.skillTags.length) t.skillTags = ['research'];
    t.tier = Math.min(4, Math.max(1, Math.round(t.tier || 2)));
  }
  // Three or more loose ends need one person to bring them together.
  const consumed = new Set(tiles.flatMap((t) => t.dependsOn));
  const sinks = tiles.filter((t) => !consumed.has(t.key));
  if (addIntegration && sinks.length >= 3 && !tiles.some((t) => t.kind === 'INTEGRATION')) {
    tiles.push(integrationTile(tiles, sinks));
    changes.push(`Added a final assembly tile: ${sinks.length} pieces had nobody to bring them together.`);
  }
  return { tiles, changes };
}

export function integrationTile(tiles, sinks) {
  const inputs = [...new Set(sinks.flatMap((s) => s.outputs))];
  return {
    key: uniqueKey(tiles, 'integrate'), kind: 'INTEGRATION', title: 'Bring the parts together',
    spec: `Combine the finished pieces (${sinks.map((s) => `“${s.title}”`).join(', ')}) into one deliverable. Use each file as it is, fix only the seams between them, and write handoff.md listing every file and who made it.`,
    deliverableFormat: 'final.md plus handoff.md',
    acceptanceCriteria: [{ id: 'c1', text: 'The final deliverable is Markdown', check: 'AUTO', rule: 'file_ext(md)' }, { id: 'c2', text: 'It reads as one deliverable, not pasted pieces', check: 'LLM' }],
    skillTags: ['editing', 'project-integration'], tier: 2, estMinutes: 45, dependsOn: sinks.map((s) => s.key),
    sensitiveInputs: [], languages: [], inputs, outputs: ['final.md', 'handoff.md'], stream: 'Assembly', phase: 'integrate', priority: 1, covers: [],
  };
}
