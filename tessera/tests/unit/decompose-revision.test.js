// Revise-and-respond jobs: a manuscript revised in answer to its reviews, with a letter. The plan
// triages every comment first, revises the sections at once (from the manuscript's own headings
// when it's attached), answers each comment, checks the whole, and assembles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disaggregate } from '../../src/decompose/plan.js';
import { isRevisionJob, revisionSections } from '../../src/decompose/revision.js';
import { validateGraph } from '../../src/domain/graph.js';
import { JOBS } from '../fixtures/jobs.js';

const job = JOBS.find((j) => j.id === 'revision');

test('a revision in answer to reviewers is recognized, and no other job in the corpus is', () => {
  assert.ok(isRevisionJob(job));
  assert.ok(isRevisionJob({ title: 'R&R for our paper', goal: 'Address the referees’ comments on the paper and draft the response letter.' }));
  assert.deepEqual(JOBS.filter((j) => j.id !== 'revision' && isRevisionJob(j)).map((j) => j.id), []);
  assert.equal(isRevisionJob({ title: 'Grant proposal', goal: 'Write a proposal and have a peer reviewer check it.' }), false, 'a proposal to write, not one to revise');
});

test('the plan triages every comment first, revises sections at once, answers each comment, checks, and assembles', () => {
  const r = disaggregate(job);
  assert.deepEqual(validateGraph(r.tiles), []);
  const keys = r.tiles.map((t) => t.key);
  assert.deepEqual(keys, ['revision-plan', 'revise-section-1', 'revise-section-2', 'revise-section-3', 'revise-section-4', 'revise-section-5', 'response-letter', 'revision-check', 'assemble-revision']);
  assert.doesNotMatch(r.tiles.map((t) => t.title).join(' | '), /clean|can learn|provide me/i, 'no tiles from misread sentences');
  const plan = r.tiles[0];
  assert.equal(plan.phase, 'conventions');
  assert.ok(plan.acceptanceCriteria.some((c) => c.rule === 'csv_columns(comment_id, source, comment, decision, section, plan)'));
  const sections = r.tiles.filter((t) => t.key.startsWith('revise-section'));
  for (const t of sections) {
    assert.deepEqual(t.dependsOn, ['revision-plan'], 'the sections run at the same time');
    assert.ok(t.acceptanceCriteria.some((c) => /number from the requester’s revised analyses is kept exactly/.test(c.text)), 'keep the numbers');
    assert.ok(t.acceptanceCriteria.some((c) => /author’s own voice/.test(c.text)), 'same voice');
  }
  const makers = new Map();
  for (const t of r.tiles) for (const f of t.outputs) { assert.ok(!makers.has(f), `${f} has one maker`); makers.set(f, t.key); }
  assert.ok(r.quality.grade <= 'B', `graded ${r.quality.grade}`);
  assert.match(r.rationale, /revise-and-respond job: 5 sections/);
  assert.ok(r.quality.metrics.width >= 5, 'five people can work at once');
});

test('with the manuscript attached, the sections follow its own headings', () => {
  const files = [
    { name: 'Response to Reviewers.docx', summary: { kind: 'document', headings: ['Response', 'Reviewer 1', 'Reviewer 2'] } },
    { name: 'Manuscript.docx', summary: { kind: 'document', headings: ['Policy Feedback and State Adoption', 'Introduction', 'Policy Diffusion', 'Data', 'Methods', 'Results', 'Robustness', 'Discussion', 'Conclusion', 'References', 'Appendix A'] } },
  ];
  const s = revisionSections(files);
  assert.equal(s.from, 'Manuscript.docx', 'the manuscript, not the response draft');
  assert.deepEqual(s.sections.map((x) => x.label), ['Introduction', 'Policy Diffusion through Data', 'Methods', 'Results through Robustness', 'Discussion through Conclusion']);
  const answers = { q1: 'Both: a tracked-changes version against the original Manuscript.docx, plus a clean version with all changes accepted.' };
  const r = disaggregate({ ...job, files, answers });
  assert.match(r.tiles[1].spec, /the headings “Introduction” in Manuscript\.docx/);
  assert.equal(r.tiles.find((t) => t.key === 'revise-section-5').title, 'Revise Discussion through Conclusion');
  assert.match(r.tiles.at(-1).handoff || '', /Compare/, 'asked for tracked changes: the copy is made with Word’s Compare');
  assert.equal(disaggregate({ ...job, files }).tiles.at(-1).handoff, undefined, 'not asked, no handoff for it');
  assert.deepEqual(revisionSections([]).sections.length, 5, 'without headings, the usual sections of a paper');
});
