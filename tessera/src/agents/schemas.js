// Output contracts for every agent. The same schemas validate replies and, as JSON Schema,
// constrain providers that support structured output.
import { s } from '../lib/schema.js';

const kebab = /^[a-z0-9-]+$/;

export const Criterion = s.object({
  id: s.string().min(1),
  text: s.string().min(3),
  check: s.enum(['AUTO', 'LLM', 'PEER']),
  rule: s.string().optional().describe('Machine-readable rule for AUTO checks, e.g. csv_columns(a, b)'),
});

export const TileDraft = s.object({
  key: s.string().regex(kebab, 'must be kebab-case (a-z, 0-9, -)'),
  kind: s.enum(['WORK', 'REVIEW', 'INTEGRATION']),
  title: s.string().min(3).max(80),
  spec: s.string().min(20),
  deliverableFormat: s.string().min(3),
  acceptanceCriteria: s.array(Criterion).min(1),
  skillTags: s.array(s.string().regex(kebab, 'skill tags must be kebab-case')).min(1),
  tier: s.int().min(1).max(4),
  estMinutes: s.int().min(15).max(120),
  dependsOn: s.array(s.string()).describe('keys of upstream tiles'),
  sensitiveInputs: s.array(s.string()).default([]),
  languages: s.array(s.string()).default([]).describe('Working languages the tile needs, e.g. ["en","es"]; empty means the commission language'),
  // The interface: what the tile reads and what it makes, by file name. Optional so older plans still parse.
  inputs: s.array(s.string()).optional().describe('Files this tile reads: outputs of upstream tiles, or "the source file the requester attached"'),
  outputs: s.array(s.string()).optional().describe('Exact file names this tile delivers; each file has one maker'),
  stream: s.string().optional().describe('Short name of the workstream this tile belongs to, e.g. "Setup", "Code responses", "Checks"'),
  phase: s.enum(['prep', 'conventions', 'work', 'layer', 'check', 'integrate']).optional(),
  archetype: s.string().optional().describe('The kind of step, e.g. collect, code, translate, draft, outreach, review'),
  partOf: s.string().optional().describe('Shared id of a batch group: tiles that split one piece of work by range'),
  part: s.object({ index: s.int().min(1), of: s.int().min(1), from: s.int(), to: s.int(), label: s.string() }).optional(),
  covers: s.array(s.string()).optional().describe('Ids of the requester requirements this tile answers for'),
  priority: s.int().min(1).max(3).optional().describe('1 essential, 2 important, 3 nice to have; cut from 3 up when over budget'),
});

/**
 * A tile as a model writes it. Looser than TileDraft (which checks what people type): a long
 * title, a non-kebab key or skill tag, an estimate outside 15–120 minutes or a loop in the plan
 * are fixed by repairGraph instead of throwing away a plan that took minutes to write.
 */
export const PlanTile = s.object({
  key: s.string().min(1),
  kind: s.enum(['WORK', 'REVIEW', 'INTEGRATION']),
  title: s.string().min(3).max(300).describe('Short: at most 80 characters'),
  spec: s.string().min(20),
  deliverableFormat: s.string().min(3),
  acceptanceCriteria: s.array(Criterion).min(1),
  skillTags: s.array(s.string()).min(1),
  tier: s.int(),
  estMinutes: s.int(),
  dependsOn: s.array(s.string()).describe('keys of upstream tiles'),
  sensitiveInputs: s.array(s.string()).default([]),
  languages: s.array(s.string()).default([]),
  inputs: s.array(s.string()).optional(),
  outputs: s.array(s.string()).optional(),
  stream: s.string().optional(),
  phase: s.enum(['prep', 'conventions', 'work', 'layer', 'check', 'integrate']).optional(),
  archetype: s.string().optional(),
  partOf: s.string().optional(),
  part: s.object({ index: s.int().min(1), of: s.int().min(1), from: s.int(), to: s.int(), label: s.string() }).optional(),
  covers: s.array(s.string()).optional(),
  priority: s.int().min(1).max(3).optional(),
});

export const TileGraph = s.object({
  rationale: s.string().min(10),
  tiles: s.array(PlanTile).min(1),
});

/** The first stage of a staged plan: workstreams and the skeleton of their tiles. */
export const PlanOutline = s.object({
  rationale: s.string().min(10),
  streams: s.array(s.object({
    key: s.string().regex(kebab, 'must be kebab-case (a-z, 0-9, -)'),
    name: s.string().min(2).max(60),
    purpose: s.string().min(10),
    tiles: s.array(s.object({
      key: s.string().regex(kebab, 'must be kebab-case (a-z, 0-9, -)'),
      title: s.string().min(3).max(300).describe('Short: at most 80 characters'),
      outputs: s.array(s.string()).min(1).describe('Exact file names this tile makes; each file has one maker'),
      dependsOn: s.array(s.string()).describe('Keys of the tiles (in any stream) whose files this tile reads'),
      covers: s.array(s.string()).default([]),
    })).min(1).max(40),
  })).min(1).max(20),
});

/** The second stage: one workstream's tiles in full. */
export const StreamTiles = s.object({
  tiles: s.array(PlanTile).min(1),
});

export const ScopingQuestions = s.object({
  questions: s.array(s.object({
    id: s.string().min(1),
    question: s.string().min(8),
    why: s.string().min(4),
    suggestedAnswer: s.string().default(''),
  })).max(5),
});

export const Brief = s.object({
  purpose: s.string().min(10),
  setup: s.array(s.string()),
  steps: s.array(s.string()).min(1),
  checklist: s.array(s.object({ criterionId: s.string(), text: s.string().min(3) })).min(1),
  pitfalls: s.array(s.string()),
});

export const ReviewVerdict = s.object({
  criteria: s.array(s.object({
    criterionId: s.string(),
    pass: s.boolean(),
    reason: s.string().min(8),
  })),
  overall: s.enum(['PASS', 'FAIL']),
  confidence: s.number().min(0).max(1),
});

export const Assembly = s.object({
  title: s.string().min(3),
  summary: s.string().min(10),
  sections: s.array(s.object({ heading: s.string(), body: s.string(), tileKeys: s.array(s.string()) })).min(1),
  manifest: s.array(s.object({ tileKey: s.string(), contributorId: s.string(), files: s.array(s.string()), role: s.string() })).min(1),
  gaps: s.array(s.string()),
  conflicts: s.array(s.string()),
});

/** What a worker agent hands in for one tile: its approach, the files, and what a person must still do. */
export const ScopingAnswers = s.object({
  answers: s.array(s.object({
    id: s.string().min(1),
    answer: s.string().min(2).max(1000),
    assumption: s.boolean().default(false),
  })),
});

/** A lead agent's plan to split a long tile into parts other agents do at the same time. */
export const SplitPlan = s.object({
  reason: s.string().min(10).describe('Why the parts are independent and how they divide the work'),
  parts: s.array(s.object({
    brief: s.string().min(10).describe('What this part does, clear enough for another agent working alone'),
    files: s.array(s.string()).min(1).describe('The tile output files this part writes its share of'),
    rows: s.object({ from: s.int().min(1), to: s.int().min(1) }).optional().describe('For a split by rows: this part’s rows of the table, 1-based and inclusive'),
  })).min(2).max(8),
});

export const WorkResult = s.object({
  approach: s.array(s.string().min(3)).min(1).max(10).describe('The steps you took, in order: your own brief'),
  files: s.array(s.object({
    name: s.string().min(3).max(120).describe('Exact file name with extension, e.g. coded_02.csv'),
    content: s.string().describe('The full file content as text'),
  })).max(10).describe('The files you hand in; empty only when you return a split plan'),
  notes: s.string().describe('For the reviewer: choices you made, anything uncertain, and any limits of the work'),
  checklist: s.array(s.object({ criterionId: s.string(), done: s.boolean(), note: s.string() })),
  handoff: s.string().default('').describe('What a person must still do in the real world, or an empty string'),
  split: SplitPlan.optional().describe('Only when input.delegation offers it: split the tile into parts instead of handing in files'),
});

export const MatcherNotes = s.object({
  notes: s.array(s.object({ userId: s.string(), note: s.string().min(10).max(200) })),
});

/** A supervisor's scores for every attempt on a task, on the task's rubric. */
export const SupervisorVerdict = s.object({
  attempts: s.array(s.object({
    label: s.string().describe('The attempt label, e.g. "A"'),
    items: s.array(s.object({
      id: s.string().describe('A rubric item id'),
      score: s.int().min(0).max(4).describe('0 fails it, 2 partly meets it, 4 fully meets it'),
      note: s.string().describe('Why, in one sentence, pointing at the output'),
    })),
    summary: s.string().describe('The attempt’s main strength and main problem'),
  })).min(1),
  agreement: s.enum(['high', 'mixed', 'low']).describe('How much the attempts agree on substance (facts, numbers, conclusions), not on style'),
  disagreements: s.array(s.string()).describe('Each substantive point where the attempts disagree'),
  feedback: s.string().describe('What the best attempt still needs to clear the bar, specific enough to act on'),
  tooBig: s.boolean().describe('The task is too big for one worker to do well in one pass'),
  mixesJobs: s.boolean().describe('The task mixes two different jobs that should be separate tasks'),
  canJudge: s.boolean().describe('False when you cannot judge the attempts with the inputs you have'),
  confidence: s.number().min(0).max(1),
  rationale: s.string().describe('How you compared the attempts'),
});

/** Lessons a reflection agent draws from one scored task. */
export const Lessons = s.object({
  lessons: s.array(s.object({
    scope: s.enum(['shared', 'personal']).describe('shared: from the winner, for every worker on this task type; personal: for one attempt’s own config'),
    attempt: s.string().describe('The label of the attempt the lesson comes from'),
    text: s.string().min(20).max(300).describe('The behavior, as advice: "On data-cleaning tasks, compare row counts before and after."'),
    evidence: s.string().min(10).max(400).describe('What in this task shows it'),
  })).max(3),
});

/** The root supervisor's judgment of a finished job before sign-off. */
export const RootVerdict = s.object({
  accept: s.boolean(),
  concerns: s.array(s.string()).describe('Each problem a person should look at before this is signed off'),
  confidence: s.number().min(0).max(1),
  note: s.string().describe('One or two sentences for the requester'),
});
