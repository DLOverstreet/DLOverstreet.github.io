// The platform agents, the tile copilot, and the swarm's worker and autopilot agents. Each
// pairs a versioned prompt with an output schema and a validator; runAgent rejects anything
// that fails either and retries.
import * as scopingPrompt from './prompts/scoping.v1.js';
import * as decomposerPrompt from './prompts/decomposer.v2.js';
import * as refinePrompt from './prompts/decomposer-refine.v1.js';
import * as matcherPrompt from './prompts/matcher-note.v1.js';
import * as translatorPrompt from './prompts/translator.v1.js';
import * as reviewerPrompt from './prompts/reviewer.v1.js';
import * as assemblerPrompt from './prompts/assembler.v2.js';
import * as copilotPrompt from './prompts/copilot.v1.js';
import * as workerPrompt from './prompts/worker.v2.js';
import * as researcherPrompt from './prompts/researcher.v1.js';
import * as autopilotPrompt from './prompts/autopilot.v1.js';
import { ScopingQuestions, TileGraph, MatcherNotes, Brief, ReviewVerdict, Assembly, WorkResult, ScopingAnswers } from './schemas.js';
import { runAutoChecks } from '../domain/autochecks.js';
import { validateGraph } from '../domain/graph.js';
import { config } from '../domain/config.js';

export const scoping = {
  name: 'scoping', prompt: scopingPrompt, schema: ScopingQuestions, tier: 'heavy', effort: 'medium',
  validate(out) {
    const ids = out.questions.map((q) => q.id);
    return new Set(ids).size === ids.length ? [] : ['question ids must be unique'];
  },
};

export const decomposer = {
  name: 'decomposer', prompt: decomposerPrompt, schema: TileGraph, tier: 'heavy', effort: 'high',
  validate(out) {
    return validateGraph(out.tiles).map((i) => i.message);
  },
};

/** Second pass on a plan whose separability report found problems. */
export const decomposerRefine = {
  name: 'decomposer-refine', prompt: refinePrompt, schema: TileGraph, tier: 'heavy', effort: 'high',
  validate(out) {
    return validateGraph(out.tiles).map((i) => i.message);
  },
};

export const matcherNote = {
  name: 'matcher-note', prompt: matcherPrompt, schema: MatcherNotes, tier: 'light', effort: 'low',
  validate(out, input) {
    const want = input.candidates.map((c) => c.userId).sort();
    const got = out.notes.map((n) => n.userId).sort();
    return JSON.stringify(want) === JSON.stringify(got) ? [] : [`notes must cover exactly these userIds: ${want.join(', ')}`];
  },
};

/** The checklist must map one to one onto the tile's criteria, so a model can't loosen the bar. */
export function checklistProblems(checklist, criteria) {
  const want = criteria.map((c) => c.id);
  const got = checklist.map((c) => c.criterionId);
  const problems = [];
  if (got.length !== want.length) problems.push(`checklist has ${got.length} items but the tile has ${want.length} criteria`);
  const missing = want.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !want.includes(id));
  if (missing.length) problems.push(`checklist is missing criterionId(s): ${missing.join(', ')}`);
  if (extra.length) problems.push(`checklist has unknown criterionId(s): ${extra.join(', ')}`);
  if (new Set(got).size !== got.length) problems.push('checklist repeats a criterionId');
  return problems;
}

export const translator = {
  name: 'translator', prompt: translatorPrompt, schema: Brief, tier: 'heavy', effort: 'medium',
  validate(out, input) { return checklistProblems(out.checklist, input.tile.acceptanceCriteria); },
};

export const reviewer = {
  name: 'reviewer', prompt: reviewerPrompt, schema: ReviewVerdict, tier: 'light', effort: 'medium',
  validate(out, input) {
    const problems = [];
    const want = input.criteria.map((c) => c.id).sort();
    const got = out.criteria.map((c) => c.criterionId).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`verdicts must cover exactly these criterionIds: ${want.join(', ')}`);
    const allPass = out.criteria.every((c) => c.pass);
    if ((out.overall === 'PASS') !== allPass) problems.push('overall must be PASS exactly when every criterion passes');
    return problems;
  },
};

export const assembler = {
  name: 'assembler', prompt: assemblerPrompt, schema: Assembly, tier: 'heavy', effort: 'medium',
  validate(out, input) {
    const problems = [];
    const want = new Map(input.tiles.map((t) => [t.key, t.contributor.id]));
    const seen = new Set();
    for (const m of out.manifest) {
      if (!want.has(m.tileKey)) problems.push(`manifest names unknown tile ${m.tileKey}`);
      else if (want.get(m.tileKey) !== m.contributorId) problems.push(`manifest credits ${m.tileKey} to the wrong contributor`);
      if (seen.has(m.tileKey)) problems.push(`manifest lists ${m.tileKey} twice`);
      seen.add(m.tileKey);
    }
    for (const k of want.keys()) if (!seen.has(k)) problems.push(`manifest is missing tile ${k}`);
    return problems;
  },
};

const TEXT_FILE = /\.(csv|tsv|json|geojson|md|markdown|txt|svg|html|css|js|ts|py|r|sql|yaml|yml|xml|ipynb)$/i;

/** The files a worker hands in, plus any the swarm computed for it (merged batches), as the checker sees them. */
export function workerFiles(out, input) {
  const made = out.files.map((f) => ({ name: f.name, size: f.content.length, text: f.content }));
  const pre = (input && input.precomputedFiles) || [];
  return [...made.filter((f) => !pre.some((p) => p.name === f.name)), ...pre.map((p) => ({ name: p.name, size: p.text.length, text: p.text }))];
}

/** A worker agent does one tile. Its files must pass the tile's AUTO checks before they're handed in. */
export const worker = {
  name: 'worker', prompt: workerPrompt, schema: WorkResult, tier: 'heavy', effort: 'medium',
  validate(out, input) {
    const problems = [];
    const names = new Set();
    for (const f of out.files) {
      if (!TEXT_FILE.test(f.name)) problems.push(`${f.name}: hand in text formats only (csv, md, json, svg, html, js, py and so on)`);
      if (!f.content.trim()) problems.push(`${f.name} is empty`);
      if (names.has(f.name)) problems.push(`${f.name} appears twice`);
      names.add(f.name);
    }
    const ids = (input.tile?.acceptanceCriteria || []).map((c) => c.id);
    const got = out.checklist.map((c) => c.criterionId);
    const missing = ids.filter((id) => !got.includes(id));
    if (missing.length) problems.push(`checklist is missing criterionId(s): ${missing.join(', ')}`);
    const { results } = runAutoChecks(input.tile?.acceptanceCriteria || [], workerFiles(out, input));
    for (const r of results.filter((x) => !x.pass)) problems.push(`AUTO check ${r.rule} fails: ${r.reason}`);
    const sample = samplePlaceholder(out, input);
    if (sample) problems.push(sample);
    return problems;
  },
};

/**
 * Placeholder data handed in although the real data was there: a tile that isn't a sample-data
 * tile labels rows SAMPLE while its inputs or attachments hold real, unlabeled tables. This is
 * what turned one test run's "theme counts by branch" into made-up numbers.
 */
export function samplePlaceholder(out, input) {
  if (input.tile?.agentMode === 'sample-data') return null;
  const real = [...(input.inputs || []), ...(input.attachments || [])].filter((f) => typeof f.content === 'string' && /\.(csv|tsv|json)$/i.test(f.name) && !/\bSAMPLE\b/.test(f.content));
  if (!real.length) return null;
  const fake = out.files.filter((f) => /\bSAMPLE\b/.test(f.content) || /illustrative only|placeholder data|not (?:a )?real tally/i.test(f.content));
  if (!fake.length) return null;
  return `${fake.map((f) => f.name).join(', ')} ${fake.length > 1 ? 'are' : 'is'} labeled SAMPLE or placeholder, but the real data is in your inputs (${real.map((f) => f.name).slice(0, 4).join(', ')}). Compute the real result from them and drop the SAMPLE label.`;
}

/** Gathers facts from the web for a tile that needs them. Plain text: Markdown notes with sources. */
export const researcher = {
  name: 'researcher', prompt: researcherPrompt, format: 'text', tier: 'heavy', effort: 'medium',
};

/** Stands in for the requester on a job handed to the swarm: answers the scoping questions. */
export const autopilot = {
  name: 'autopilot', prompt: autopilotPrompt, schema: ScopingAnswers, tier: 'light', effort: 'low',
  validate(out, input) {
    const want = (input.questions || []).map((q) => q.id).sort();
    const got = out.answers.map((a) => a.id).sort();
    return JSON.stringify(want) === JSON.stringify(got) ? [] : [`answer exactly these question ids: ${want.join(', ')}`];
  },
};

export const copilot = {
  name: 'copilot', prompt: copilotPrompt, format: 'text', tier: 'light', effort: 'low',
};

export const AGENTS = { scoping, decomposer, decomposerRefine, matcherNote, translator, reviewer, assembler, copilot, worker, autopilot, researcher };

export const AGENT_TABLE = [
  { name: 'Scoping', runsIn: 'Worker', model: `Heavy (${config.llm.heavyModel})`, job: 'Asks the requester up to five clarifying questions', version: scopingPrompt.version },
  { name: 'Decomposer', runsIn: 'Worker', model: `Heavy (${config.llm.heavyModel})`, job: 'Splits the job into separable tiles, starting from the rule-based engine’s reading and reference plan', version: decomposerPrompt.version },
  { name: 'Decomposer refine', runsIn: 'Worker', model: `Heavy (${config.llm.heavyModel})`, job: 'Fixes the problems the separability report finds in a model-made plan (only when it grades below C)', version: refinePrompt.version },
  { name: 'Matcher', runsIn: 'Worker', model: `Light (${config.llm.lightModel}), for the note only`, job: 'Scores contributors with a fixed formula and sends offers', version: matcherPrompt.version },
  { name: 'Translator', runsIn: 'Contributor’s browser', model: 'Contributor’s own model, shared model as fallback', job: 'Writes the personal brief and powers the tile copilot', version: translatorPrompt.version },
  { name: 'Reviewer', runsIn: 'Worker', model: `Light, escalating to heavy under ${config.reviewConfidenceFloor} confidence`, job: 'Pass or fail per criterion, with a reason', version: reviewerPrompt.version },
  { name: 'Assembler', runsIn: 'Worker', model: 'Heavy', job: 'Merges accepted outputs and writes the credits manifest', version: assemblerPrompt.version },
  { name: 'Worker agents', runsIn: 'Agent swarm', model: `Set in Settings (default ${config.swarm.workerModel}); checks on ${config.swarm.checkModel}`, job: 'Do tiles, peer-review each other and revise, on jobs you hand to the swarm', version: workerPrompt.version },
  { name: 'Researcher', runsIn: 'Agent swarm', model: 'The worker model, with Anthropic web search and web fetch', job: 'Looks up the outside facts a tile needs (prices, sources, rules, data) and hands the worker notes with URLs', version: researcherPrompt.version },
  { name: 'Autopilot', runsIn: 'Agent swarm', model: 'Light', job: 'Stands in for you on a swarm job: answers the scoping questions, marking assumptions', version: autopilotPrompt.version },
];
