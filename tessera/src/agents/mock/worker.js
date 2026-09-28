// Mock worker agent: with no model connected, a swarm agent hands in sample files that
// meet the tile's automatic checks (the same generator the crowd simulation uses), and
// says plainly that the content is a placeholder.
import { generateSampleWork } from './sample-work.js';

export function mockWorker(input) {
  const t = input.tile || {};
  const work = generateSampleWork({ ...t, id: t.key }, { seed: `agent:${t.key}:${input.revision?.round || 0}`, upstreamFiles: (input.inputs || []).map((f) => f.name) });
  const pre = new Set((input.precomputedFiles || []).map((f) => f.name));
  const files = work.files.filter((f) => !pre.has(f.name)).map((f) => ({ name: f.name, content: f.text || '' }));
  if (!files.length) files.push({ name: 'notes.md', content: `# ${t.title}\n\nThe merged files were computed from the accepted batches.\n` });
  return {
    approach: [
      'Read the spec, the acceptance criteria and the input files.',
      ...(input.revision ? [`Fixed what round ${input.revision.round} failed: ${(input.revision.failed || []).map((f) => f.criterion).join('; ') || 'see notes'}.`] : []),
      'Produced the files the spec names and checked them against every criterion.',
    ],
    files,
    notes: 'Mock agent: these files are placeholders that meet the automatic checks. Connect Claude in Settings for real work.',
    checklist: (t.acceptanceCriteria || []).map((c) => ({ criterionId: c.id, done: true, note: 'Checked.' })),
    handoff: t.handoff || '',
  };
}
