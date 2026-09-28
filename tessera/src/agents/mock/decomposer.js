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
