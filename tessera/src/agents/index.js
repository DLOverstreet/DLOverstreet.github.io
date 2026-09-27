// The six agents plus the tile copilot. Each pairs a versioned prompt with an output
// schema and a validator; runAgent rejects anything that fails either and retries.
import * as scopingPrompt from './prompts/scoping.v1.js';
import * as decomposerPrompt from './prompts/decomposer.v1.js';
import * as matcherPrompt from './prompts/matcher-note.v1.js';
import * as translatorPrompt from './prompts/translator.v1.js';
import * as reviewerPrompt from './prompts/reviewer.v1.js';
import * as assemblerPrompt from './prompts/assembler.v1.js';
import * as copilotPrompt from './prompts/copilot.v1.js';
import { ScopingQuestions, TileGraph, MatcherNotes, Brief, ReviewVerdict, Assembly } from './schemas.js';
import { validateGraph } from '../domain/graph.js';
import { config } from '../domain/config.js';

export const scoping = {
  name: 'scoping', prompt: scopingPrompt, schema: ScopingQuestions, tier: 'heavy',
  validate(out) {
    const ids = out.questions.map((q) => q.id);
    return new Set(ids).size === ids.length ? [] : ['question ids must be unique'];
  },
};

export const decomposer = {
  name: 'decomposer', prompt: decomposerPrompt, schema: TileGraph, tier: 'heavy',
  validate(out) {
    return validateGraph(out.tiles).map((i) => i.message);
  },
};

export const matcherNote = {
  name: 'matcher-note', prompt: matcherPrompt, schema: MatcherNotes, tier: 'light',
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
  name: 'translator', prompt: translatorPrompt, schema: Brief, tier: 'heavy',
  validate(out, input) { return checklistProblems(out.checklist, input.tile.acceptanceCriteria); },
};

export const reviewer = {
  name: 'reviewer', prompt: reviewerPrompt, schema: ReviewVerdict, tier: 'light',
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
  name: 'assembler', prompt: assemblerPrompt, schema: Assembly, tier: 'heavy',
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

export const copilot = {
  name: 'copilot', prompt: copilotPrompt, format: 'text', tier: 'light',
};

export const AGENTS = { scoping, decomposer, matcherNote, translator, reviewer, assembler, copilot };

export const AGENT_TABLE = [
  { name: 'Scoping', runsIn: 'Worker', model: `Heavy (${config.llm.heavyModel})`, job: 'Asks the requester up to five clarifying questions', version: scopingPrompt.version },
  { name: 'Decomposer', runsIn: 'Worker', model: `Heavy (${config.llm.heavyModel})`, job: 'Builds the tile graph from the goal and clarifications', version: decomposerPrompt.version },
  { name: 'Matcher', runsIn: 'Worker', model: `Light (${config.llm.lightModel}), for the note only`, job: 'Scores contributors with a fixed formula and sends offers', version: matcherPrompt.version },
  { name: 'Translator', runsIn: 'Contributor’s browser', model: 'Contributor’s own model, shared model as fallback', job: 'Writes the personal brief and powers the tile copilot', version: translatorPrompt.version },
  { name: 'Reviewer', runsIn: 'Worker', model: `Light, escalating to heavy under ${config.reviewConfidenceFloor} confidence`, job: 'Pass or fail per criterion, with a reason', version: reviewerPrompt.version },
  { name: 'Assembler', runsIn: 'Worker', model: 'Heavy', job: 'Merges accepted outputs and writes the credits manifest', version: assemblerPrompt.version },
];
