// The competition and supervision layer on swarm jobs: competing worker configs, a supervisor
// that scores after the checks, the reveal round, send back, re-split and escalation to you,
// lessons tested against a control group, evolving configs, and the supervisors scored in turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { mockSupervisor } from '../../src/agents/mock/supervision.js';
import { disaggregate } from '../../src/decompose/plan.js';
import { priceGraph } from '../../src/domain/pricing.js';
import { supervisorReliability } from '../../src/domain/supervision.js';
import { JOBS } from '../fixtures/jobs.js';

const job = (id) => { const j = JOBS.find((x) => x.id === id); return { title: j.title, goal: j.goal }; };
const setSwarm = (T, patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, swarm: { ...(tx.meta.settings.swarm || {}), ...patch } } }));
const tops = (T, c) => T.db.filter('TaskSpec', (x) => x.commissionId === c.id && !x.parentSpecId);
const actions = (T, specId) => T.db.filter('SupervisorAction', (x) => x.specId === specId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((x) => x.action);
/** A supervisor that finds every attempt weak (1 of 4 on each rubric item). */
const weak = (input) => { const v = mockSupervisor(input); return { ...v, agreement: 'high', disagreements: [], attempts: v.attempts.map((a) => ({ ...a, items: a.items.map((i) => ({ ...i, score: 1, note: 'Figures don’t trace to the inputs.' })) })), feedback: 'Trace every figure to an input file.' }; };

test('three configs compete blind on every tile; the supervisor scores them after the checks, and the winner is handed in', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id && !t.dynamic);
  const specs = tops(T, c);
  assert.equal(specs.length, tiles.length, 'one task spec per tile, written before the work');
  for (const spec of specs) {
    assert.equal(spec.status, 'accepted');
    assert.ok(spec.hardChecks.some((h) => h.id === 'files') && spec.rubric.some((r) => r.id === 'accuracy'));
    const blind = T.db.filter('Attempt', (a) => a.specId === spec.id && a.round === 'blind');
    assert.equal(new Set(blind.map((a) => a.configId)).size, 3, `${spec.title}: three different configs competed`);
    assert.equal(T.db.count('Score', (x) => x.specId === spec.id), T.db.count('Attempt', (a) => a.specId === spec.id), 'every attempt is scored');
    assert.ok(['accept', 'accept_flag'].includes(actions(T, spec.id).at(-1)));
    const tile = T.db.get('Tile', spec.tileId);
    const sub = T.db.get('Submission', tile.acceptedSubmissionId);
    assert.equal(sub.supervised.specId, spec.id);
    assert.equal(sub.supervised.winner.attemptId, spec.winnerAttemptId);
    const llm = T.db.find('Review', (r) => r.submissionId === sub.id && r.source === 'LLM');
    if (tile.acceptanceCriteria.some((x) => x.check !== 'AUTO')) assert.match(llm.model, /supervisor/, 'verification records the supervisor’s marks');
  }
  // The winners' record feeds routing: one win per task, spread over the task types.
  const stats = T.db.all('WorkerStats');
  assert.equal(stats.reduce((n, s) => n + s.wins, 0), specs.length);
  assert.equal(stats.reduce((n, s) => n + s.attempts, 0), specs.reduce((n, s) => n + s.competitors.length, 0));
  // Warm, then fan out: on each tile's first round the first competitor writes the cache and the others read it.
  const first = specs[0];
  const runs = T.db.filter('AgentRun', (r) => r.tileId === first.tileId && r.agent === 'worker' && r.input?.agent?.mode === 'blind');
  assert.equal(runs.length, 3);
  assert.ok(runs.filter((r) => r.tokensCacheRead > 0).length >= 2, 'the second and third competitors read the shared layers from the cache');
  assert.deepEqual(runs.map((r) => r.competitor.split(' · ')[0]).sort(), ['A', 'B', 'C']);
  assert.ok(runs.every((r) => r.input.agent.strategyHint), 'each competitor carries its own strategy hint');
  assert.equal(new Set(runs.map((r) => r.input.agent.strategyHint)).size, 3);
});

test('when the blind drafts disagree, the workers see each other’s drafts and revise, and the disagreement goes forward', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  const spec = tops(T, c).find((x) => actions(T, x.id).includes('reveal'));
  assert.ok(spec, 'one task’s blind round disagreed sharply');
  assert.deepEqual(actions(T, spec.id), ['reveal', 'accept_flag']);
  const reveal = T.db.filter('AgentRun', (r) => r.tileId === spec.tileId && r.agent === 'worker' && r.input?.agent?.mode === 'reveal');
  assert.equal(reveal.length, 3);
  for (const r of reveal) {
    assert.equal(r.input.round.drafts.length, 3, 'each worker sees every blind draft');
    assert.ok(['A', 'B', 'C'].includes(r.input.agent.yourDraft));
  }
  assert.ok(spec.herding && spec.herding.revisions >= 1, 'herding is measured on the reveal round');
  assert.ok(spec.flagged);
  const done = T.db.get('Commission', c.id);
  assert.ok(done.delivery.flags.some((f) => f.includes(T.db.get('Tile', spec.tileId).key)), 'the flag reaches the delivery');
  const report = new TextDecoder().decode(await T.blobs.get(done.deliverableKey));
  assert.match(report, /- Disagreement: /);
  const root = T.db.find('AgentRun', (r) => r.commissionId === c.id && r.agent === 'supervisor-root');
  assert.equal(root.input.flags.length, 1, 'the root supervisor sees every flag raised on the way');
  assert.match(done.autopilot.note, /root supervisor accepted it/);
});

test('a task that misses the bar is sent back with feedback, and each worker fixes its own draft', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { concurrency: 1 });
  T.mock.queue('supervisor', [weak, weak]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const spec = tops(T, c).find((x) => actions(T, x.id).includes('send_back'));
  assert.deepEqual(actions(T, spec.id), ['reveal', 'send_back', 'accept']);
  const revise = T.db.filter('AgentRun', (r) => r.tileId === spec.tileId && r.agent === 'worker' && r.input?.agent?.mode === 'revise');
  assert.equal(revise.length, 3);
  for (const r of revise) {
    assert.match(r.input.agent.feedback, /Supervisor: Trace every figure/);
    assert.match(r.input.agent.feedback, /weakest points: .*1\/4/);
    assert.ok(r.input.agent.priorDraft.files.length, 'the worker revises its own last draft');
  }
  const low = T.db.filter('Score', (x) => x.specId === spec.id && x.cycle === 1);
  assert.ok(low.every((x) => x.score === 0.25));
});

test('the third failure re-splits the task; each part competes on its own, and the joined parts are scored by the parent', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { concurrency: 1 });
  T.mock.queue('supervisor', [weak, weak, weak, weak]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const spec = tops(T, c).find((x) => actions(T, x.id).includes('resplit'));
  const trail = actions(T, spec.id);
  assert.deepEqual(trail.slice(0, 4), ['reveal', 'send_back', 'send_back', 'resplit']);
  assert.ok(['accept', 'accept_flag'].includes(trail[4]), 'the joined parts are accepted (flagged if a part was)');
  const act = T.db.find('SupervisorAction', (x) => x.specId === spec.id && x.action === 'resplit');
  assert.match(act.reason, /Third failure/);
  const kids = T.db.filter('TaskSpec', (x) => x.parentSpecId === spec.id);
  assert.equal(kids.length, act.newChildSpecIds.length);
  assert.ok(kids.length >= 2);
  for (const k of kids) {
    assert.equal(k.status, 'accepted');
    assert.equal(k.depth, 1);
    assert.equal(T.db.count('Attempt', (a) => a.specId === k.id && a.round === 'blind'), 3, 'each part competes on its own');
  }
  assert.equal(T.db.count('AgentRun', (r) => r.agent === 'resplit' && r.tileId === spec.tileId), 1);
  const merged = T.db.find('Attempt', (a) => a.specId === spec.id && a.round === 'merge');
  assert.ok(merged.hardPass, 'the joined files pass the parent task’s checks');
  const sub = T.db.get('Submission', T.db.get('Tile', spec.tileId).acceptedSubmissionId);
  assert.match(sub.notes, new RegExp(`Split into ${kids.length} parts that ran at the same time .*each competed on its own`));
});

test('an escalated task waits for you: its claim doesn’t lapse, and accepting an attempt hands it in', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { concurrency: 1 });
  T.mock.queue('supervisor', [(input) => ({ ...mockSupervisor(input), canJudge: false, rationale: 'The inputs are missing the budget figures.' })]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  const tile = T.db.find('Tile', (t) => t.commissionId === c.id && t.supervision?.state === 'escalated');
  assert.ok(tile, 'the supervisor couldn’t judge the task, so it came to you');
  assert.match(tile.supervision.reason, /can’t judge/);
  assert.match(T.db.get('Commission', c.id).autopilot.note, /needs you/);
  assert.notEqual(T.db.get('Commission', c.id).status, 'ACCEPTED', 'the job waits on the escalated task');
  T.clock.advance(30 * 24 * 3600 * 1000);
  await T.worker.drain();
  assert.equal(T.db.get('Tile', tile.id).status, 'CLAIMED', 'an escalated task isn’t reopened when its claim runs out');
  const attempts = T.db.filter('Attempt', (a) => a.tileId === tile.id && a.round === 'blind');
  await assert.rejects(() => T.api.resolveEscalation('usr_ruth', tile.id, { action: 'accept', attemptId: attempts[1].id }), /Only the requester/);
  await T.api.resolveEscalation('usr_marisol', tile.id, { action: 'accept', attemptId: attempts[1].id });
  await T.swarm.settle();
  const done = T.db.get('Tile', tile.id);
  assert.equal(done.status, 'ACCEPTED');
  const sub = T.db.get('Submission', done.acceptedSubmissionId);
  assert.match(sub.notes, /Accepted by the requester from an escalated task: attempt B/);
  assert.ok(T.db.find('Review', (r) => r.submissionId === sub.id && r.source === 'REQUESTER') || !tile.acceptanceCriteria.some((x) => x.check !== 'AUTO'));
  assert.ok(T.db.find('SupervisorAction', (x) => x.tileId === tile.id && x.by === 'requester' && x.action === 'accept'));
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
});

test('you can send an escalated task back with your feedback, or give it to one agent', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { concurrency: 1 });
  const cantJudge = (input) => ({ ...mockSupervisor(input), canJudge: false });
  T.mock.queue('supervisor', [cantJudge]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  let tile = T.db.find('Tile', (t) => t.commissionId === c.id && t.supervision?.state === 'escalated');
  await assert.rejects(() => T.api.resolveEscalation('usr_marisol', tile.id, { action: 'send_back', feedback: 'no' }), /at least 10 characters/);
  // The retry escalates again, and this time you give it to one agent.
  T.mock.queue('supervisor', [cantJudge]);
  await T.api.resolveEscalation('usr_marisol', tile.id, { action: 'send_back', feedback: 'Use the budget from the style sheet, not a new one.' });
  await T.swarm.settle();
  const told = T.db.filter('AgentRun', (r) => r.tileId === tile.id && r.agent === 'worker' && /From the requester/.test(r.input?.agent?.feedback || ''));
  assert.equal(told.length, 3, 'every competitor got your feedback');
  tile = T.db.get('Tile', tile.id);
  assert.equal(tile.supervision.state, 'escalated');
  await T.api.resolveEscalation('usr_marisol', tile.id, { action: 'single' });
  await T.swarm.settle();
  tile = T.db.get('Tile', tile.id);
  assert.equal(tile.status, 'ACCEPTED');
  const sub = T.db.get('Submission', tile.acceptedSubmissionId);
  assert.equal(sub.supervised, undefined, 'one agent did it, checked the usual way');
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
});

test('the root supervisor can hold back sign-off; resuming lets the autopilot sign off', async () => {
  const T = await makeTessera({ crowd: false });
  T.mock.queue('supervisor-root', [{ accept: false, concerns: ['The budget total doesn’t match the narrative.'], confidence: 0.7, note: 'Check the budget first.' }]);
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  let cur = T.db.get('Commission', c.id);
  assert.equal(cur.status, 'DELIVERED');
  assert.equal(cur.autopilot.state, 'PAUSED');
  assert.match(cur.autopilot.note, /root supervisor wants you to look first\. The budget total/);
  T.api.resumeSwarmJob('usr_marisol', c.id);
  await T.swarm.settle();
  cur = T.db.get('Commission', c.id);
  assert.equal(cur.status, 'ACCEPTED');
  assert.match(cur.autopilot.note, /overrode the root supervisor/);
});

test('lessons are written after scored tasks and trialed against a control group; winning configs are cloned', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { lessonTrials: 6 });
  for (const id of ['grant', 'pantry', 'course']) {
    await T.api.runWithAgents('usr_marisol', job(id));
    await T.swarm.settle();
  }
  const lessons = T.db.all('Lesson');
  assert.ok(lessons.some((l) => l.scope === 'shared') && lessons.some((l) => l.scope === 'personal' && l.configId));
  assert.ok(lessons.every((l) => l.sourceSpecId && l.evidence));
  assert.equal(new Set(lessons.map((l) => `${l.scope}:${l.configId}:${l.taskType}:${l.text}`)).size, lessons.length, 'a lesson already in the store isn’t written twice');
  const trials = T.db.all('LessonTrial');
  assert.ok(trials.some((t) => t.used) && trials.some((t) => !t.used), 'the control worker runs without the playbook');
  const control = T.db.find('Attempt', (a) => a.control && a.round === 'blind');
  const run = T.db.find('AgentRun', (r) => r.agent === 'worker' && r.tileId === control.tileId && r.input?.agent?.config === control.configName && r.input?.agent?.mode === 'blind');
  assert.equal(run.input.playbook, undefined, 'the control’s prompt has no playbook layer');
  const peer = T.db.find('AgentRun', (r) => r.agent === 'worker' && r.tileId === control.tileId && r.input?.agent?.mode === 'blind' && r.input?.agent?.config !== control.configName);
  assert.ok(peer.input.playbook.lessons.length, 'the others read the playbook');
  assert.ok(lessons.some((l) => l.status !== 'candidate'), 'with enough trials, a lesson is promoted or retired');
  const clone = T.db.find('WorkerConfig', (w) => w.parentConfigId);
  assert.ok(clone, 'a config that wins most of its tasks is cloned');
  assert.equal(clone.generation, 2);
  assert.notEqual(clone.strategyHint, T.db.get('WorkerConfig', clone.parentConfigId).strategyHint);
});

test('on auto, a config that wins nearly every task of a type works alone, still scored by the supervisor', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { competition: 'auto' });
  const c0 = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  // Give one config a long winning record on every task type the next job has.
  const star = T.db.find('WorkerConfig', (w) => w.key === 'reader');
  const types = new Set(tops(T, c0).map((x) => x.taskType));
  T.db.tx((tx) => {
    for (const t of types) {
      const row = { attempts: 40, wins: 39, scoreSum: 36, costMicroUsd: 0 };
      const st = tx.find('WorkerStats', (x) => x.configId === star.id && x.taskType === t);
      if (st) tx.update('WorkerStats', st.id, row); else tx.insert('WorkerStats', { configId: star.id, taskType: t, ...row });
    }
  });
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c0.id).status, 'ACCEPTED');
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const solo = tops(T, c).filter((x) => x.competitors.length === 1);
  assert.ok(solo.length, 'the settled task types go to the leader alone');
  for (const spec of solo) {
    assert.equal(spec.competitors[0].configId, star.id);
    assert.match(spec.routing, /works alone/);
    assert.ok(!actions(T, spec.id).includes('reveal'), 'no reveal round with one worker');
  }
});

test('the supervisors are scored: a sample of accepted tasks comes to you, and your verdicts measure them', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { reviewSamplePct: 100 });
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  const sampled = T.db.filter('SupervisorAudit', (a) => a.commissionId === c.id && a.sampled);
  assert.equal(sampled.length, tops(T, c).length, 'at 100%, every accepted task’s winner is sampled');
  assert.throws(() => T.api.reviewAudit('usr_ruth', sampled[0].id, 'agree'), /Only the requester/);
  T.api.reviewAudit('usr_marisol', sampled[0].id, 'agree');
  T.api.reviewAudit('usr_marisol', sampled[1].id, 'disagree');
  const r = supervisorReliability(T.db.all('SupervisorAudit'));
  assert.equal(r.reviewed, 2);
  assert.equal(r.reviewAgreement, 0.5);
  assert.equal(r.checkAgreement, 1, 'the mock supervisor’s scores agree with the hard checks');
});

async function surveyWithFile(T) {
  const rows = ['response_id,response'];
  for (let i = 1; i <= 120; i++) rows.push(`r${String(i).padStart(3, '0')},The landlord ignored repairs for unit ${i} and the heat was out for weeks at a time this winter`);
  const r = disaggregate({ ...job('survey'), privacy: 'RESTRICTED' });
  const plan = { tiles: r.tiles, rationale: r.rationale, source: 'breakdown', pricing: priceGraph(r.tiles) };
  const c = await T.api.runWithAgents('usr_marisol', { ...job('survey'), privacy: 'RESTRICTED', plan, files: [{ name: 'responses.csv', text: rows.join('\n') }] });
  await T.swarm.settle();
  return { c: T.db.get('Commission', c.id), tile: T.db.find('Tile', (t) => t.commissionId === c.id && t.key === 'deidentify') };
}

test('a long tile is split for speed before anyone works on it, and each part competes on its own', async () => {
  const T = await makeTessera({ crowd: false });
  const { c, tile } = await surveyWithFile(T);
  assert.equal(c.status, 'ACCEPTED');
  const decision = T.db.find('AgentRun', (r) => r.tileId === tile.id && r.competitor === 'lead · split decision');
  assert.ok(decision.input.delegation.decideOnly, 'the lead only decides whether to split');
  assert.ok(decision.tokensCacheWrite > 0, 'its call writes the task’s cache layers for everyone after it');
  const spec = T.db.find('TaskSpec', (x) => x.tileId === tile.id && !x.parentSpecId);
  assert.deepEqual(actions(T, spec.id), ['split', 'accept']);
  const kids = T.db.filter('TaskSpec', (x) => x.parentSpecId === spec.id);
  assert.equal(kids.length, 2);
  for (const k of kids) assert.equal(T.db.count('Attempt', (a) => a.specId === k.id && a.round === 'blind'), 3);
  const parts = T.db.filter('AgentRun', (r) => r.tileId === tile.id && r.agent === 'worker' && r.input?.part);
  assert.ok(parts.every((r) => r.tokensCacheRead > 0), 'every part’s competitors read the cached task');
  assert.equal(T.db.get('Tile', tile.id).agentTiming.parts, 2);
  const sub = T.db.get('Submission', T.db.get('Tile', tile.id).acceptedSubmissionId);
  assert.match(sub.notes, /redacted_responses\.csv: 120 rows from 2 parts/);
});
