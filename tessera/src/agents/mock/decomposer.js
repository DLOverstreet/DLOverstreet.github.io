// Mock Decomposer: the rule-based disaggregation engine in src/decompose. It reads the
// job, splits it contract-first into separable tiles, and fits them to the budget when the
// Decomposer is asked for a smaller scope.
import { disaggregate } from '../../decompose/plan.js';
import { repairGraph } from '../../decompose/ops.js';
import { applyFix } from '../../decompose/plan.js';

export function mockDecompose(input) {
  const c = input.commission || {};
  const instruction = input.requesterInstruction || '';
  const smaller = /\b(smaller|fewer|cheaper|less|reduce|cut|trim|leaner|lighter)\b/i.test(instruction);
  const answers = [...Object.values(input.clarifications?.answers || {}), instruction].filter(Boolean).join('. ');
  const max = input.scopeInstruction?.maxTotalCents || (smaller && c.budgetUsd ? Math.round(c.budgetUsd * 100 * 0.7) : null);
  const r = disaggregate(
    { title: c.title, goal: c.goal, answers, files: input.files || [], privacy: c.privacy, language: c.language },
    { maxTotalCents: max, rush: !!input.scopeInstruction?.rush },
  );
  return { rationale: r.rationale, tiles: r.tiles };
}

/** Mock refine pass: repairs the graph and applies every fix the report says a machine can make. */
export function mockRefine(input) {
  let tiles = repairGraph(input.tiles || []).tiles;
  const done = [];
  for (const issue of input.quality?.issues || []) {
    if (!issue.fix || !['addEdge', 'addIntegration', 'cover'].includes(issue.fix.op)) continue;
    try { tiles = applyFix(tiles, issue.fix); done.push(issue.code); } catch { /* the fix no longer applies */ }
  }
  return { rationale: done.length ? `Repaired: ${[...new Set(done)].join(', ')}.` : 'Checked the plan; nothing a machine can fix safely.', tiles };
}

/** Mock staged planning, first stage: the engine's plan grouped by stream, as a skeleton. */
export function mockDecomposeOutline(input) {
  const { rationale, tiles } = mockDecompose(input);
  const streams = new Map();
  for (const t of tiles) {
    const name = t.stream || 'Work';
    if (!streams.has(name)) streams.set(name, { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'work', name, purpose: `The ${name.toLowerCase()} tiles of the plan.`, tiles: [] });
    streams.get(name).tiles.push({ key: t.key, title: t.title, outputs: t.outputs?.length ? t.outputs : [`${t.key}.md`], dependsOn: t.dependsOn || [], covers: t.covers || [] });
  }
  // Stream keys stay unique even when two names slug the same.
  const seen = new Map();
  for (const st of streams.values()) { const n = (seen.get(st.key) || 0) + 1; seen.set(st.key, n); if (n > 1) st.key = `${st.key}-${n}`; }
  return { rationale, streams: [...streams.values()] };
}

/** Mock staged planning, second stage: the engine's tiles for one stream. */
export function mockDecomposeStream(input) {
  const stream = input.outline.streams.find((st) => st.key === input.stream);
  const keys = new Set(stream.tiles.map((t) => t.key));
  return { tiles: mockDecompose(input).tiles.filter((t) => keys.has(t.key)) };
}
