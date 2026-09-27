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
});

export const TileGraph = s.object({
  rationale: s.string().min(10),
  tiles: s.array(TileDraft).min(1),
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

export const MatcherNotes = s.object({
  notes: s.array(s.object({ userId: s.string(), note: s.string().min(10).max(200) })),
});
