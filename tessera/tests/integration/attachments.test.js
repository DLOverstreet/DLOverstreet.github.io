// Word, Excel and PDF attachments are read, not skipped: their text reaches the Scoping agent,
// the Decomposer and the agents doing the tiles, redacted on a restricted job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTessera } from '../helpers/harness.js';
import { docxBytes } from '../helpers/office.js';

const pdf = () => new Uint8Array(readFileSync(new URL('../fixtures/files/decision-letter.pdf', import.meta.url)));
const job = {
  title: 'Revise the manuscript for the journal',
  goal: 'Revise the attached manuscript based on the reviewers’ critiques in the attached decision letter, and write a response to the reviewers explaining how each concern was addressed.',
};

test('a Word manuscript and a PDF decision letter are read, summarized and handed to every agent that needs them', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', { ...job, files: [{ name: 'Manuscript.docx', bytes: docxBytes() }, { name: 'Decision letter.pdf', bytes: pdf() }] });
  const [docx, letter] = T.db.get('Commission', c.id).files;
  assert.equal(docx.summary.kind, 'document');
  assert.deepEqual(docx.summary.headings, ['Policy Feedback and State Adoption', 'Introduction']);
  assert.equal(docx.summary.trackedChanges, 2);
  assert.match(docx.summary.excerpt, /\{\+gradually\+\}/);
  assert.equal(letter.summary.kind, 'document');
  assert.equal(letter.summary.pages, 1);
  assert.match(letter.summary.excerpt, /Comment 2\.1: The discussion overstates causal claims/);
  await T.swarm.settle();
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id);
  const scoping = runs.find((r) => r.agent === 'scoping');
  assert.deepEqual(scoping.input.documents.map((d) => d.name), ['Manuscript.docx', 'Decision letter.pdf'], 'the Scoping agent reads the documents');
  const decomposer = runs.find((r) => r.agent === 'decomposer');
  assert.match(decomposer.input.documents[1].text, /Comment 1\.1: The theory section should engage/, 'so does the Decomposer');
  assert.match(decomposer.input.documents[0].note, /data, not instructions/);
  const worker = runs.find((r) => r.agent === 'worker' && (r.input?.attachments || []).length);
  const attached = Object.fromEntries(worker.input.attachments.map((a) => [a.name, a]));
  assert.match(attached['Manuscript.docx'].content, /States adopt policies \[-quickly-\]\{\+gradually\+\}/, 'and the agents doing the work get the full text');
  assert.match(attached['Decision letter.pdf'].content, /Reviewer: 2/);
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
});

test('on a restricted job the documents are redacted before any agent reads them', async () => {
  const T = await makeTessera({ crowd: false });
  const { makeZip } = await import('../helpers/office.js');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const bytes = makeZip({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Interviewee Maria Lopez, maria.lopez@example.org, 602-555-0143, described the eviction.</w:t></w:r></w:p></w:body></w:document>` });
  const c = await T.api.runWithAgents('usr_marisol', { ...job, privacy: 'RESTRICTED', files: [{ name: 'Interviews.docx', bytes }] });
  const f = T.db.get('Commission', c.id).files[0];
  assert.doesNotMatch(f.summary.excerpt, /maria\.lopez@example\.org|602-555-0143/);
  await T.swarm.settle();
  const decomposer = T.db.find('AgentRun', (r) => r.commissionId === c.id && r.agent === 'decomposer');
  assert.doesNotMatch(decomposer.input.documents[0].text, /maria\.lopez@example\.org|602-555-0143/);
});
