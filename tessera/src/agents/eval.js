// The Decomposer eval: ten fixture commissions, run through the real agent with whatever
// provider is routed, scored for validity, tile-size spread, share of AUTO criteria and cost.
// Used by `npm run eval:decomposer` and by Admin → Eval in the browser.
import { AGENTS } from './index.js';
import { runAgent } from '../llm/run-agent.js';
import { skillVocabulary } from '../domain/config.js';
import { priceGraph } from '../domain/pricing.js';
import { parseRule } from '../domain/autochecks.js';
import { runCostUsd, shadowCostUsd } from '../llm/prices.js';
import { median } from '../lib/util.js';

export const EVAL_FIXTURES = [
  { title: 'Eviction filings dashboard for Maricopa County', goal: 'Build a public dashboard of eviction filings in Maricopa County from the justice courts’ public calendar: monthly trends, a map by census tract, a breakdown by case type, and a methodology note. English and Spanish, phone-friendly.', budgetUsd: 2400, privacy: 'NEED_TO_KNOW' },
  { title: 'Spanish version of our library card flyer and FAQ', goal: 'Translate our one-page library card flyer and six-question FAQ into plain Spanish for families, ready to print.', budgetUsd: 400, privacy: 'PUBLIC' },
  { title: 'Code 120 open-ended tenant survey responses', goal: 'Build a codebook, code about 120 open-ended survey responses about housing problems, check coder agreement, and write a themes memo for our board. Responses contain names and addresses.', budgetUsd: 900, privacy: 'RESTRICTED' },
  { title: 'Literature review: right to counsel and eviction outcomes', goal: 'A literature review of US evidence since 2010 on right-to-counsel programs and eviction outcomes, with a search protocol, screening, an extraction table and a synthesis with references.', budgetUsd: 1500, privacy: 'PUBLIC' },
  { title: 'One-page website for a food pantry', goal: 'A one-page, accessible website with hours, what to bring, emergency help and a volunteer sign-up link, readable on a phone.', budgetUsd: 800, privacy: 'PUBLIC' },
  { title: 'Policy brief on property tax relief for seniors', goal: 'A four-page policy brief comparing property tax relief options for low-income seniors in Arizona, with one key chart and sources.', budgetUsd: 1200, privacy: 'PUBLIC' },
  { title: 'Volunteer handbook from scattered notes', goal: 'Turn about 30 pages of scattered volunteer notes into a clear handbook with onboarding, safety, and a FAQ.', budgetUsd: 700, privacy: 'NEED_TO_KNOW' },
  { title: 'School budget explorer', goal: 'An interactive chart tool showing how our district’s budget changed over ten years by category, with a plain-language explainer.', budgetUsd: 1800, privacy: 'PUBLIC' },
  { title: 'Grant report on after-school program outcomes', goal: 'Analyze attendance and outcome data for our after-school program and write the annual grant report with two charts. The data has student names.', budgetUsd: 1400, privacy: 'RESTRICTED' },
  { title: 'French translation of a clinic intake form', goal: 'Translate our two-page clinic intake form and its instructions into French for West African patients, with a glossary for staff.', budgetUsd: 500, privacy: 'PUBLIC' },
];

export async function runDecomposerEval({ route, log = (_row) => {}, onProgress = (_done, _results) => {} }) {
  const results = [];
  for (const [i, f] of EVAL_FIXTURES.entries()) {
    const runs = [];
    const logAll = (row) => { runs.push(row); log({ ...row, eval: true }); };
    const input = {
      commission: { title: f.title, goal: f.goal, budgetUsd: f.budgetUsd, deadline: '2026-12-01T00:00:00.000Z', privacy: f.privacy, language: 'en' },
      clarifications: { questions: [], answers: {} }, files: [], estimateCalibration: {}, skillVocabulary,
    };
    const started = Date.now();
    let graph = null;
    let error = null;
    try { graph = (await runAgent({ agent: AGENTS.decomposer, input, route, log: logAll })).output; } catch (e) { error = e.message; }
    const r = { fixture: f.title, valid: !!graph, error, attempts: runs.length, latencyMs: Date.now() - started,
      tokensIn: runs.reduce((n, x) => n + (x.tokensIn || 0), 0), tokensOut: runs.reduce((n, x) => n + (x.tokensOut || 0), 0),
      costUsd: runs.reduce((n, x) => n + runCostUsd(x), 0), shadowCostUsd: runs.reduce((n, x) => n + shadowCostUsd(x), 0) };
    if (graph) {
      const mins = graph.tiles.map((t) => t.estMinutes);
      const crit = graph.tiles.flatMap((t) => t.acceptanceCriteria);
      const auto = crit.filter((c) => c.check === 'AUTO');
      const priced = priceGraph(graph.tiles);
      Object.assign(r, {
        tiles: graph.tiles.length, minMinutes: Math.min(...mins), medianMinutes: median(mins), maxMinutes: Math.max(...mins),
        autoShare: auto.length / crit.length, runnableAutoShare: auto.length ? auto.filter((c) => parseRule(c.rule)).length / auto.length : 0,
        kinds: [...new Set(graph.tiles.map((t) => t.kind))].join('/'), totalCents: priced.total, withinBudget: priced.total <= f.budgetUsd * 100,
      });
    }
    results.push(r);
    onProgress(i + 1, results);
  }
  const valid = results.filter((r) => r.valid);
  return {
    results,
    summary: {
      valid: valid.length, total: results.length,
      medianTiles: median(valid.map((r) => r.tiles)),
      autoShare: valid.length ? valid.reduce((n, r) => n + r.autoShare, 0) / valid.length : 0,
      costUsd: results.reduce((n, r) => n + r.costUsd, 0),
      shadowCostUsd: results.reduce((n, r) => n + r.shadowCostUsd, 0),
    },
  };
}
