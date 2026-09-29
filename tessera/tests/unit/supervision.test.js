// The competition and supervision layer's rules: specs written before the work, checks before
// opinions, the supervisor's five actions and their triggers, the reveal round, herding, who
// competes, lessons that must earn their place, evolving configs, and scoring the scorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskSpec, runHardChecks, rubricScore, decide, needReveal, herding, textSimilarity, pickCompetitors,
  playbookFor, personalLessons, judgeLesson, lessonLift, evolveConfigs, supervisorReliability, leaderboard, DEFAULT_CONFIGS,
} from '../../src/domain/supervision.js';

const tile = {
  id: 'til_1', commissionId: 'com_1', title: 'Code comments 1–45', archetype: 'code', outputs: ['coded_01.csv'], webResearch: false,
  acceptanceCriteria: [
    { id: 'c1', check: 'AUTO', text: 'Columns', rule: 'csv_columns(response_id, themes)' },
    { id: 'c2', check: 'AUTO', text: 'Rows', rule: 'csv_min_rows(3)' },
    { id: 'c3', check: 'LLM', text: 'Codes follow the codebook' },
    { id: 'c4', check: 'PEER', text: 'A person would agree with the codes' },
  ],
};

test('a task spec is written before the work: hard checks, a weighted rubric, a threshold', () => {
  const spec = buildTaskSpec(tile, { threshold: 0.75 });
  assert.deepEqual(spec.hardChecks.map((h) => h.id), ['c1', 'c2', 'files', 'no-sample']);
  assert.deepEqual(spec.rubric.map((r) => r.id), ['c3', 'c4', 'fidelity', 'accuracy', 'usefulness']);
  assert.equal(spec.threshold, 0.75);
  assert.equal(spec.taskType, 'code');
  const child = buildTaskSpec(tile, { parentSpecId: 'tsp_1', brief: 'Rows 1–20 of the table.', files: ['coded_01.csv'], rows: { from: 1, to: 20 }, depth: 1 });
  assert.deepEqual(child.hardChecks.filter((h) => h.kind === 'auto').map((h) => h.id), ['c1'], 'a part is not held to the whole table’s row count');
  const docPart = buildTaskSpec(tile, { parentSpecId: 'tsp_1', brief: 'The method note.', files: ['method.md'], depth: 1 });
  assert.deepEqual(docPart.hardChecks.filter((h) => h.kind === 'auto'), [], 'a part that writes no table isn’t held to the table’s columns');
  assert.ok(buildTaskSpec({ ...tile, webResearch: true }).hardChecks.some((h) => h.id === 'sources'));
});

test('checks run before opinions: automatic rules, owed files, placeholder data and cited sources', () => {
  const spec = buildTaskSpec({ ...tile, webResearch: true });
  const good = [{ name: 'coded_01.csv', text: 'response_id,themes\nR1,A\nR2,B\nR3,C\nSee https://example.org/a.\n' }];
  assert.equal(runHardChecks(spec, good, { sourceUrls: ['https://example.org/a'] }).pass, true);
  const r = runHardChecks(spec, [{ name: 'coded_01.csv', text: 'response_id,themes\nR1,A\nhttps://made-up.example/x\n' }], { sampleProblem: 'coded_01.csv is labeled SAMPLE', sourceUrls: ['https://example.org/a'] });
  assert.equal(r.pass, false);
  const failed = Object.fromEntries(r.results.map((x) => [x.id, x.pass]));
  assert.deepEqual(failed, { c1: true, c2: false, files: true, 'no-sample': false, sources: false });
  assert.equal(runHardChecks(spec, []).results.find((x) => x.id === 'files').pass, false);
});

test('the rubric score is the weighted mean of the supervisor’s marks', () => {
  const spec = buildTaskSpec(tile);
  assert.equal(rubricScore(spec.rubric, spec.rubric.map((r) => ({ id: r.id, score: 4 }))), 1);
  assert.equal(rubricScore(spec.rubric, []), 0);
  assert.equal(rubricScore([{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }], [{ id: 'a', score: 4 }, { id: 'b', score: 0 }]), 0.667);
});

test('the supervisor accepts, flags, sends back, re-splits or escalates on the blueprint’s triggers', () => {
  const a = (id, hardPass, score) => ({ id, hardPass, score });
  const base = { threshold: 0.7, agreement: 'high', failures: 0 };
  const accept = decide({ ...base, attempts: [a('x', true, 0.9), a('y', true, 0.8), a('z', false, 0.95)] });
  assert.equal(accept.action, 'accept');
  assert.equal(accept.winnerId, 'x', 'an attempt that fails a hard check can’t win, whatever its score');
  const flag = decide({ ...base, agreement: 'low', attempts: [a('x', true, 0.9), a('y', true, 0.8)] });
  assert.equal(flag.action, 'accept_flag');
  assert.equal(decide({ ...base, attempts: [a('x', true, 0.95), a('y', true, 0.4)] }).action, 'accept_flag', 'a wide score spread is sharp disagreement too');
  const miss = [a('x', true, 0.5), a('y', false, 0)];
  assert.equal(decide({ ...base, attempts: miss }).action, 'send_back');
  assert.equal(decide({ ...base, failures: 1, attempts: miss }).action, 'send_back');
  assert.equal(decide({ ...base, failures: 2, attempts: miss }).action, 'resplit', 'the third failure goes back to the disaggregator');
  assert.equal(decide({ ...base, failures: 0, attempts: miss, supervisor: { tooBig: true } }).action, 'resplit', 'a task that is too big is re-split at once');
  assert.equal(decide({ ...base, failures: 2, attempts: miss, resplitUsed: true }).action, 'escalate', 're-split at most once');
  assert.equal(decide({ ...base, failures: 2, attempts: miss, canResplit: false }).action, 'escalate');
  assert.equal(decide({ ...base, attempts: [a('x', true, 0.9)], supervisor: { canJudge: false } }).action, 'escalate');
  assert.equal(decide({ ...base, attempts: [a('x', false, 0), a('y', false, 0)] }).winnerId, null);
});

test('the reveal round runs only when the blind round wasn’t a clean accept, unless set otherwise', () => {
  assert.equal(needReveal('auto', { action: 'accept' }), false);
  assert.equal(needReveal('auto', { action: 'accept_flag' }), true);
  assert.equal(needReveal('auto', { action: 'send_back' }), true);
  assert.equal(needReveal('always', { action: 'accept' }), true);
  assert.equal(needReveal('never', { action: 'send_back' }), false);
  assert.equal(needReveal('auto', { action: 'escalate' }), false, 'a supervisor that can’t judge escalates at once');
  assert.equal(needReveal('always', { action: 'resplit' }), false, 'a task that is too big is re-split, not revised');
});

test('herding counts workers whose revision moved toward the worst blind draft', () => {
  const worst = 'the answer is that every branch wants longer hours on weekends and more staff';
  const blind = [{ configId: 'a', text: worst, score: 0.2 }, { configId: 'b', text: 'Eastside patrons ask for Saturday hours; Central asks for quieter study rooms', score: 0.8 }, { configId: 'c', text: 'Story time fills up, so add a second session at Central', score: 0.7 }];
  const reveal = [{ configId: 'a', text: worst }, { configId: 'b', text: `${worst} indeed` }, { configId: 'c', text: 'Story time fills up, so add a second session at Central and Eastside' }];
  assert.deepEqual(herding(blind, reveal), { revisions: 2, towardWorst: 1 });
  assert.equal(textSimilarity('a b c d', 'a b c d'), 1);
  assert.equal(textSimilarity('one two three four', 'five six seven eight'), 0);
});

test('three configs compete; two once one dominates a task type; one works without the playbook as a control', () => {
  const configs = DEFAULT_CONFIGS.map((c, i) => ({ id: `wcf_${i}`, name: c.name, status: 'active' }));
  const three = pickCompetitors(configs, [], 'code', { seed: 'task-1' });
  assert.equal(three.picked.length, 3);
  assert.equal(three.control, null, 'no playbook yet, so no control group');
  const withBook = pickCompetitors(configs, [], 'code', { seed: 'task-1', playbookSize: 2 });
  assert.ok(withBook.picked.some((c) => c.id === withBook.control));
  const stats = [{ configId: 'wcf_1', taskType: 'code', attempts: 10, wins: 8, scoreSum: 8.6, costMicroUsd: 0 }];
  const two = pickCompetitors(configs, stats, 'code', { seed: 'task-2' });
  assert.equal(two.picked.length, 2);
  assert.equal(two.picked[0].id, 'wcf_1');
  assert.match(two.reason, /Reader first wins 80% of code tasks, so 2 compete/);
  assert.equal(pickCompetitors(configs, stats, 'write', { seed: 'x' }).picked.length, 3, 'only on the type it dominates');
  assert.equal(pickCompetitors(configs, stats, 'code', { routing: false }).picked.length, 3);
  const settled = [{ configId: 'wcf_1', taskType: 'code', attempts: 12, wins: 11, scoreSum: 10.8 }];
  const solo = pickCompetitors(configs, settled, 'code', { seed: 'task-3', solo: true, playbookSize: 2 });
  assert.deepEqual(solo.picked.map((c) => c.id), ['wcf_1'], 'on auto, a config that wins nearly every task of a type works alone');
  assert.equal(solo.control, null, 'one worker leaves no one to be the control');
  assert.match(solo.reason, /works alone/);
  assert.equal(pickCompetitors(configs, settled, 'code', { seed: 'task-3' }).picked.length, 2, 'without auto, it still competes');
});

test('lessons earn their place: tested against a control group, then promoted or retired', () => {
  const l = (o) => ({ scope: 'shared', taskType: 'code', status: 'candidate', trialsWith: 0, trialsWithout: 0, scoreWith: 0, scoreWithout: 0, createdAt: 1, ...o });
  assert.equal(judgeLesson(l({ trialsWith: 10, trialsWithout: 5, scoreWith: 8, scoreWithout: 3.5 })), 'candidate', 'not enough trials yet');
  const helps = l({ trialsWith: 14, trialsWithout: 7, scoreWith: 12, scoreWithout: 5 });
  assert.equal(lessonLift(helps), 0.143);
  assert.equal(judgeLesson(helps), 'active');
  assert.equal(judgeLesson(l({ trialsWith: 14, trialsWithout: 7, scoreWith: 10, scoreWithout: 5 })), 'retired', 'sounds right, changes nothing');
  assert.equal(judgeLesson({ ...helps, status: 'active', trialsWith: 28, trialsWithout: 14, scoreWith: 20, scoreWithout: 11 }), 'retired', 'an active lesson that turns out to lower scores goes');
  const lessons = [l({ id: 'a', status: 'active', createdAt: 1 }), l({ id: 'b', createdAt: 5 }), l({ id: 'c', status: 'retired' }), l({ id: 'd', taskType: 'write' }), l({ id: 'e', scope: 'personal', configId: 'wcf_0', createdAt: 3 })];
  assert.deepEqual(playbookFor(lessons, 'code').map((x) => x.id), ['a', 'b', 'e'].filter((x) => x !== 'e'));
  assert.deepEqual(personalLessons(lessons, 'wcf_0', 'code').map((x) => x.id), ['e']);
});

test('configs evolve: steady losers retire, winners are cloned with one change of strategy', () => {
  const configs = [...DEFAULT_CONFIGS.map((c, i) => ({ id: `wcf_${i}`, name: c.name, strategyHint: c.strategyHint, status: 'active' })), { id: 'wcf_3', name: 'Extra', strategyHint: 'x', status: 'active' }];
  const stats = [
    { configId: 'wcf_0', taskType: 'code', attempts: 12, wins: 8 },
    { configId: 'wcf_1', taskType: 'code', attempts: 12, wins: 3 },
    { configId: 'wcf_2', taskType: 'code', attempts: 12, wins: 1 },
    { configId: 'wcf_3', taskType: 'code', attempts: 12, wins: 0 },
  ];
  const { retire, clones } = evolveConfigs(configs, stats);
  assert.deepEqual(retire, ['wcf_3'], 'the worst loser goes; three stay active');
  assert.equal(clones.length, 1);
  assert.equal(clones[0].parentId, 'wcf_0');
  assert.notEqual(clones[0].strategyHint, configs[0].strategyHint);
  assert.deepEqual(evolveConfigs(configs.slice(0, 3), stats).retire, [], 'at least three stay active');
});

test('supervisors are scored on agreement with the hard checks and with your reviews', () => {
  const r = supervisorReliability([
    { supervisorScore: 0.9, checkResult: true, yourReview: 'agree' },
    { supervisorScore: 0.8, checkResult: false, yourReview: 'disagree' },
    { supervisorScore: 0.2, checkResult: false },
    { supervisorScore: 0.5, checkResult: true },
  ]);
  assert.deepEqual(r, { scored: 4, checkAgreement: 0.5, reviewed: 2, reviewAgreement: 0.5 });
  const rows = leaderboard([{ configId: 'a', taskType: 'code', attempts: 4, wins: 3, scoreSum: 3.2, costMicroUsd: 400000 }, { configId: 'b', taskType: 'code', attempts: 4, wins: 1, scoreSum: 2.4, costMicroUsd: 200000 }], [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  assert.deepEqual(rows.map((x) => [x.name, x.winRate, x.avgScore]), [['A', 0.75, 0.8], ['B', 0.25, 0.6]]);
});
