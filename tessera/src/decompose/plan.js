// The disaggregation engine's front door: read a job, split it into tiles, keep the plan to
// a workable size and to budget, explain the split, and grade how separable it is.
import { analyzeJob } from './analyze.js';
import { buildTiles } from './builder.js';
import { FRAME_LABELS } from './pieces.js';
import { assessQuality } from './quality.js';
import { dropTile, splitTile, mergeTiles, addEdge, repairGraph, integrationTile, OpError } from './ops.js';
import { scheduleGraph } from './schedule.js';
import { priceGraph } from '../domain/pricing.js';

export const MAX_TILES = 120;

/** A batch group's name without its range: "Interview guests for episode 1" → "Interview guests". */
export function groupTitle(title) {
  return String(title).replace(/:.*$/, '').replace(/\s+\(.*\)$/, '')
    .replace(/\s+(?:for|in|of)\s+(?:the\s+)?[a-z]+s?\s+\d[\d,]*(?:–\d[\d,]*)?$/i, '')
    .replace(/\s+\d[\d,]*(?:–\d[\d,]*)?$/, '').trim();
}

/**
 * Splits a job into tiles.
 * @param {{ title?: string, goal?: string, answers?: any, files?: any[], privacy?: string, language?: string }} job
 * @param {{ maxTotalCents?: number|null, rush?: boolean, maxTiles?: number }} [opts]
 */
export function disaggregate(job, { maxTotalCents = null, rush = false, maxTiles = MAX_TILES } = {}) {
  const analysis = analyzeJob(job);
  const built = buildTiles(analysis);
  let tiles = built.tiles;
  const deferred = [];
  const cuts = [];
  // Pieces too big for one plan keep their first part here; the rest is phase two.
  for (const p of built.pieces.filter((x) => x.deferred)) deferred.push({ piece: p.id, what: p.phrase, noun: p.deferred.noun, from: p.deferred.from, to: p.deferred.to, reason: 'size' });
  tiles = shrinkToCount(tiles, maxTiles, deferred);
  if (maxTotalCents) tiles = fitBudget(tiles, maxTotalCents, rush, deferred, cuts);
  consolidate(deferred);
  tiles = alignPhase(tiles, deferred);
  const quality = assessQuality(tiles, analysis);
  const rationale = explain(analysis, tiles, built.pieces, deferred, cuts, quality);
  return { analysis, tiles, rationale, deferred, cuts, quality, pricing: priceGraph(tiles, { rush }) };
}

/** Batch groups, largest first, as [{ group, tiles }]. */
function groups(tiles) {
  const m = new Map();
  for (const t of tiles) if (t.partOf) (m.get(t.partOf) || m.set(t.partOf, []).get(t.partOf)).push(t);
  return [...m.entries()].map(([group, list]) => ({ group, tiles: list.sort((a, b) => (a.part?.index || 0) - (b.part?.index || 0)) })).sort((a, b) => b.tiles.length - a.tiles.length);
}

function deferLast(tiles, deferred, reason) {
  // Trim the group that reaches furthest, so every operation covers the same first rows.
  const g = groups(tiles).filter((x) => x.tiles.length > 1).sort((a, b) => (b.tiles[b.tiles.length - 1].part?.to || 0) - (a.tiles[a.tiles.length - 1].part?.to || 0) || b.tiles.length - a.tiles.length)[0];
  if (!g) return null;
  const last = g.tiles[g.tiles.length - 1];
  const prev = deferred.find((d) => d.piece === g.group && d.reason === reason);
  if (prev && last.part) prev.from = Math.min(prev.from, last.part.from);
  else deferred.push({ piece: g.group, what: last.title.replace(/:.*$/, '').replace(/\s+\S*\d[\d,–-]*$/, ''), noun: (last.part?.label || '').replace(/[\d,–\s-]+$/, ''), from: last.part?.from ?? 0, to: last.part?.to ?? 0, reason, label: last.part?.label });
  if (prev && last.part) prev.label = null;
  return dropTile(tiles, last.key);
}

function shrinkToCount(tiles, max, deferred) {
  let out = tiles;
  for (let guard = 0; out.length > max && guard < 500; guard++) {
    const next = deferLast(out, deferred, 'size');
    if (!next) break;
    out = next;
  }
  return out;
}

/**
 * When some operations on the same rows stop early, stop the others at the same row, so
 * phase one leaves a coherent set of rows fully done instead of every column half done.
 */
function alignPhase(tiles, deferred) {
  if (!deferred.length) return tiles;
  const nounOf = (label) => (String(label || '').replace(/[\d,–\s-]+$/, '').trim().split(/\s+/).pop() || '').replace(/s$/, '');
  let out = tiles;
  const cutByNoun = new Map();
  for (const d of deferred) {
    const n = nounOf(d.noun || '');
    if (!n) continue;
    cutByNoun.set(n, Math.min(cutByNoun.get(n) ?? Infinity, d.from - 1));
  }
  for (const [noun, cut] of cutByNoun) {
    for (const g of groups(out)) {
      const last = g.tiles[g.tiles.length - 1];
      if (nounOf(last.part?.label) !== noun || (last.part?.to ?? 0) <= cut) continue;
      const total = Math.max(...deferred.filter((d) => nounOf(d.noun) === noun).map((d) => d.to), last.part.to);
      for (const t of g.tiles.filter((x) => (x.part?.from ?? 0) > cut)) out = dropTile(out, t.key);
      const kept = groups(out).find((x) => x.group === g.group);
      const reach = kept ? kept.tiles[kept.tiles.length - 1].part.to : cut;
      const existing = deferred.find((d) => d.piece === g.group);
      if (existing) { existing.from = reach + 1; existing.to = Math.max(existing.to, total); } else deferred.push({ piece: g.group, what: groupTitle(last.title), noun: last.part.label.replace(/[\d,–\s-]+$/, ''), from: reach + 1, to: total, reason: 'size' });
    }
  }
  return out;
}

/** One line per piece: the first range left out through the end. */
function consolidate(deferred) {
  const by = new Map();
  for (const d of deferred) {
    const cur = by.get(d.piece);
    if (!cur) { by.set(d.piece, { ...d }); continue; }
    cur.from = Math.min(cur.from, d.from);
    cur.to = Math.max(cur.to, d.to);
    if (d.reason === 'budget') cur.reason = 'budget';
    if (d.what.length < cur.what.length) cur.what = d.what;
  }
  deferred.splice(0, deferred.length, ...by.values());
}

/** Cuts nice-to-haves, then trims batch groups, then drops whole pieces until the plan fits. */
function fitBudget(tiles, max, rush, deferred, cuts) {
  let out = tiles;
  const fits = () => priceGraph(out, { rush }).total <= max;
  if (fits()) return out;
  for (const p of [3, 2]) {
    for (const t of [...out].reverse().filter((x) => (x.priority || 1) === p)) {
      if (fits()) return out;
      out = dropTile(out, t.key);
      cuts.push(t.title);
    }
  }
  for (let guard = 0; !fits() && guard < 500; guard++) {
    const next = deferLast(out, deferred, 'budget');
    if (!next) break;
    out = next;
  }
  // Still over: drop whole pieces, latest first, keeping the conventions, the assembly and at least one piece of work.
  for (const t of [...out].reverse()) {
    if (fits()) break;
    if (t.kind === 'INTEGRATION' || t.phase === 'conventions' || t.phase === 'prep') continue;
    if (out.filter((x) => x.kind === 'WORK' && x.phase !== 'conventions' && x.phase !== 'prep').length <= 1) break;
    out = dropTile(out, t.key);
    cuts.push(t.title);
  }
  return out;
}

const hours = (m) => (m < 90 ? `${Math.round(m)} minutes` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} hours`);

function explain(a, tiles, pieces, deferred, cuts, quality) {
  const parts = [];
  const named = a.components.filter((c) => c.role !== 'conventions');
  const label = FRAME_LABELS[a.frame] || 'general';
  parts.push(a.vague
    ? `The job doesn’t list its parts, so the plan opens with a scoping tile and leaves room for up to three parts it defines.`
    : `Read as ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label} job with ${named.length} named piece${named.length === 1 ? '' : 's'}: ${named.slice(0, 5).map((c) => c.phrase.toLowerCase()).join('; ')}${named.length > 5 ? '; and more' : ''}.`);
  const conv = tiles.filter((t) => t.phase === 'conventions');
  if (conv.length) parts.push(`Contract first: ${conv.map((t) => `“${t.title}”`).join(' and ')} fix${conv.length === 1 ? 'es' : ''} the shared terms, formats and file names, so every other tile can be done by a different person at the same time.`);
  if (tiles.some((t) => t.phase === 'prep')) parts.push('De-identification runs before anyone else sees the data.');
  const batched = new Map();
  for (const t of tiles) if (t.partOf && t.part?.of > 1) (batched.get(t.partOf) || batched.set(t.partOf, []).get(t.partOf)).push(t);
  const bits = [...batched.values()].slice(0, 3).map((list) => `${groupTitle(list[0].title)} in ${list.length} batches`);
  if (bits.length) parts.push(`Batch work is split by range so each person owns their slice: ${bits.join('; ')}${batched.size > 3 ? '; and others' : ''}.`);
  const layers = tiles.filter((t) => t.phase === 'layer' || t.phase === 'check');
  if (layers.length) parts.push(`Checks and layers: ${[...new Set(layers.map((t) => t.title.replace(/:.*$/, '')))].slice(0, 4).join('; ')}.`);
  if (tiles.some((t) => t.kind === 'INTEGRATION')) parts.push('One person assembles the finished pieces at the end.');
  const m = quality.metrics;
  parts.push(`${tiles.length} tiles, ${hours(m.totalMinutes)} of work; if everyone starts as soon as their inputs exist, the longest chain is ${hours(m.spanMinutes)} and up to ${m.width} ${m.width === 1 ? 'person works' : 'people work'} at once.`);
  if (deferred.length) {
    const d = deferred[0];
    const same = deferred.every((x) => x.from === d.from && x.to === d.to);
    parts.push(same
      ? `Phase one covers ${d.noun ? `${d.noun.trim()} ` : ''}1–${(d.from - 1).toLocaleString('en-US')} in full; ${d.from.toLocaleString('en-US')}–${d.to.toLocaleString('en-US')} ${deferred.some((x) => x.reason === 'budget') ? 'wait for more budget' : 'are left for a second plan with the same tiles'}.`
      : `Phase one covers at least the first ${(Math.min(...deferred.map((x) => x.from)) - 1).toLocaleString('en-US')} ${(d.noun || 'items').trim().split(/\s+/).pop()} in every operation; the rest, up to ${Math.max(...deferred.map((x) => x.to)).toLocaleString('en-US')}, ${deferred.some((x) => x.reason === 'budget') ? 'waits for more budget' : 'is left for a second plan with the same tiles'}.`);
  }
  if (cuts.length) parts.push(`To fit the budget, cut: ${cuts.join('; ')}. Rates are unchanged.`);
  if (a.assumptions.length) parts.push(`Assumed: ${a.assumptions.join(' ')}`);
  return parts.join(' ');
}

/**
 * Applies one fix from the quality report, or a direct edit.
 * @param {any[]} tiles
 * @param {any} fix { op, key?, keys?, from?, to?, text?, requirement? }
 */
export function applyFix(tiles, fix) {
  switch (fix.op) {
    case 'split': return splitTile(tiles, fix.key);
    case 'merge': return mergeTiles(tiles, fix.keys);
    case 'addEdge': return addEdge(tiles, fix.from, fix.to);
    case 'drop': return dropTile(tiles, fix.key);
    case 'repair': return repairGraph(tiles).tiles;
    case 'addIntegration': {
      const consumed = new Set(tiles.flatMap((t) => t.dependsOn || []));
      return [...tiles, integrationTile(tiles, tiles.filter((t) => !consumed.has(t.key)))];
    }
    case 'cover': {
      const integ = tiles.find((t) => t.kind === 'INTEGRATION');
      if (!integ) throw new OpError('Add a final assembly tile first; it checks what the requester asked for.');
      return tiles.map((t) => (t === integ ? { ...t, covers: [...new Set([...(t.covers || []), fix.requirement])], acceptanceCriteria: [...t.acceptanceCriteria, { id: `c${t.acceptanceCriteria.length + 1}`, text: `Covers: ${fix.text}`.slice(0, 200), check: 'LLM' }] } : t));
    }
    default: throw new OpError('That fix needs a person: read the note and edit the tile.');
  }
}

export { assessQuality, scheduleGraph, repairGraph, OpError };
