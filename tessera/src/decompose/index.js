// The disaggregation engine: reads any job and splits it into separable tiles.
//   analyze.js  reads the job (kind, pieces, counts, languages, audiences, formats, sensitivity)
//   pieces.js   plans the pieces: shared conventions first, named work, implied layers, assembly
//   builder.js  sizes pieces into tiles and writes each tile's spec, files and criteria
//   plan.js     the front door: disaggregate(), budget fitting, phase two, rationale, fixes
//   quality.js  grades how separable a plan is and lists fixable problems
//   ops.js      split, merge, drop, wire and repair a graph
//   schedule.js earliest start and finish, critical path, parallel width, timeline rows
export { analyzeJob } from './analyze.js';
export { disaggregate, applyFix, MAX_TILES } from './plan.js';
export { assessQuality } from './quality.js';
export { scheduleGraph } from './schedule.js';
export { splitTile, mergeTiles, dropTile, addEdge, removeEdge, repairGraph, inferIO, OpError } from './ops.js';
export { FRAME_LABELS } from './pieces.js';

/** The job fields the engine reads, from a commission row. */
export function jobOf(c, extra = {}) {
  return {
    title: c.title, goal: c.goal, answers: { ...(c.clarifications?.answers || {}), ...(extra.instruction ? { instruction: extra.instruction } : {}) },
    files: c.files || [], privacy: c.privacy, language: c.language,
  };
}

/** The analysis in the size a prompt or a stored plan needs. */
export function compactAnalysis(a) {
  return {
    kind: a.frame, subject: a.subject, vague: a.vague || undefined,
    pieces: a.components.map((c) => ({ id: c.id, phrase: c.phrase, kind: c.archetype, ...(c.qty ? { count: `${c.qty.n.toLocaleString('en-US')} ${c.qty.noun}` } : {}), ...(c.perAsset || c.assetUnit ? { perAsset: true } : {}), ...(c.role !== 'work' ? { role: c.role } : {}), ...(c.parent ? { partOf: c.parent } : {}) })),
    languages: { source: a.languages.source, targets: a.languages.targets },
    audiences: a.audiences, formats: a.formats, constraints: a.constraints,
    sensitive: a.sensitive.yes ? { fields: a.sensitive.fields, deidentify: a.sensitive.redact } : null,
    sources: a.sources, sourceProvided: a.provided,
    requirements: a.requirements.map((r) => ({ id: r.id, text: r.text, kind: r.kind })),
    assumptions: a.assumptions, suggestions: a.suggestions,
  };
}

/** A plan in the size a prompt needs: batch groups appear once with their count and ranges. */
export function compactPlan(tiles) {
  const out = [];
  const seen = new Set();
  for (const t of tiles) {
    if (t.partOf && seen.has(t.partOf)) continue;
    const group = t.partOf ? tiles.filter((x) => x.partOf === t.partOf) : [t];
    if (t.partOf) seen.add(t.partOf);
    out.push({
      key: t.key, kind: t.kind, phase: t.phase, stream: t.stream, title: t.title, estMinutes: t.estMinutes, tier: t.tier, skillTags: t.skillTags,
      dependsOn: [...new Set(group.flatMap((x) => x.dependsOn))].filter((d) => !group.some((g) => g.key === d)).slice(0, 12),
      inputs: (t.inputs || []).slice(0, 8), outputs: t.outputs, criteria: (t.acceptanceCriteria || []).map((c) => (c.rule ? `${c.check}: ${c.rule}` : `${c.check}: ${c.text}`)),
      ...(group.length > 1 ? { batches: group.length, ranges: `${group[0].part?.label || ''} … ${group[group.length - 1].part?.label || ''}`, partOf: t.partOf } : {}),
      covers: t.covers, priority: t.priority,
    });
  }
  return out;
}

/** The quality report in the size a stored plan needs. */
export function compactQuality(q) {
  const m = q.metrics;
  return {
    score: q.score, grade: q.grade,
    metrics: { tiles: m.tiles, totalMinutes: m.totalMinutes, spanMinutes: m.spanMinutes, speedup: Math.round(m.speedup * 10) / 10, width: m.width, sweetShare: m.sweetShare, autoShare: m.autoShare, requirements: m.requirements, covered: m.covered },
    issues: q.issues.slice(0, 15).map((i) => ({ code: i.code, severity: i.severity, message: i.message, fix: i.fix, keys: i.keys })),
  };
}
