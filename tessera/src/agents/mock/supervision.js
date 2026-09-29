// Mock brains for the competition and supervision layer. The supervisor scores attempt A
// highest, then B, then C, so the winner is predictable; about one blind round in four it reads
// the attempts as disagreeing sharply, so the reveal round shows up in demos and tests.
import { splitPlan } from './worker.js';
import { hashString } from '../../lib/util.js';

const MARK = { 0: [4, 4, 3], 1: [3, 3, 3], 2: [3, 2, 3] };

export function mockSupervisor(input) {
  const sharp = input.round === 'blind' && hashString(`${input.task.title}:${input.cycle || 1}`) % 4 === 0;
  return {
    attempts: input.attempts.map((a, i) => {
      const [acc, fid, rest] = MARK[Math.min(i, 2)];
      return {
        label: a.label,
        items: input.task.rubric.map((r) => ({ id: r.id, score: r.id === 'accuracy' ? acc : r.id === 'fidelity' ? fid : rest, note: `Mock supervisor: ${r.id === 'accuracy' && acc < 3 ? 'one figure isn’t traced to an input' : 'meets it'}.` })),
        summary: i === 0 ? 'The most complete and accurate attempt.' : 'Sound, with smaller gaps than it should have.',
      };
    }),
    agreement: sharp ? 'low' : 'high',
    disagreements: sharp ? ['The attempts reach different totals for the same group.'] : [],
    feedback: 'Mock supervisor: trace every figure to an input file and say which one.',
    tooBig: false, mixesJobs: false, canJudge: true, confidence: 0.8,
    rationale: 'Mock supervisor: compared the attempts item by item against the inputs.',
  };
}

export function mockReflection(input) {
  const lessons = [{
    scope: 'shared', attempt: input.winner.label,
    text: `On ${input.taskType} tasks, check the output against every acceptance criterion and name the input file behind each figure before handing in.`,
    evidence: `The winning attempt (${input.winner.config}) scored ${input.winner.score} and traced its figures; others did less of this.`,
  }];
  const last = [...input.others].sort((a, b) => a.score - b.score)[0];
  if (last) lessons.push({ scope: 'personal', attempt: last.label, text: `On ${input.taskType} tasks, say which input each figure comes from; unsupported figures cost this config the task.`, evidence: `Attempt ${last.label} scored ${last.score}, lowest on accuracy.` });
  return { lessons };
}

export function mockResplit(input) {
  return splitPlan(input.delegation);
}

export function mockRootSupervisor(input) {
  const flags = (input.flags || []).length;
  return { accept: true, concerns: [], confidence: 0.85, note: `Mock root supervisor: the deliverable covers the requester's goal${flags ? `; ${flags} flagged task${flags > 1 ? 's were' : ' was'} reviewed and accepted` : ''}.` };
}
