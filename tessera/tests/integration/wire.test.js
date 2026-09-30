// Agents that talk to each other while they compete, and a swarm that spends less: the notes round
// after the blind one, finalists, revisions by edits, the job's wire and the assists it earns, a
// cheaper challenger in every competition, cheaper clones of winning configs, and the requester's
// files cached once for the whole job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { docxBytes } from '../helpers/office.js';
import { AGENTS } from '../../src/agents/index.js';
import { JOBS } from '../fixtures/jobs.js';

const job = (id) => { const j = JOBS.find((x) => x.id === id); return { title: j.title, goal: j.goal }; };
const setSwarm = (T, patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, swarm: { ...(tx.meta.settings.swarm || {}), ...patch } } }));
const tops = (T, c) => T.db.filter('TaskSpec', (x) => x.commissionId === c.id && !x.parentSpecId);
const actions = (T, specId) => T.db.filter('SupervisorAction', (x) => x.specId === specId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((x) => x.action);

test('after a blind round that isn’t a clean win, the workers read the scores and each other’s notes, and revise their own drafts by edits', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const spec = tops(T, c).find((x) => actions(T, x.id).includes('reveal'));
  assert.ok(spec, 'one task’s blind round disagreed');
  const runs = T.db.filter('AgentRun', (r) => r.tileId === spec.tileId && r.agent === 'worker' && r.input?.agent?.mode === 'notes');
  assert.equal(runs.length, 3);
  const round = JSON.stringify(runs[0].input.round);
  assert.ok(runs.every((r) => JSON.stringify(r.input.round) === round), 'every reviser reads the same round block, so it is cached once');
  assert.equal(runs[0].input.round.scores.length, 3);
  assert.equal(runs[0].input.round.drafts, undefined, 'notes, not drafts');
  assert.ok(runs[0].input.round.notes.some((n) => n.to === 'rivals' && /two input rows share a date/.test(n.text)), 'a rival’s note reaches the others');
  for (const r of runs) {
    assert.ok(r.input.agent.priorDraft.files.every((f) => !/more characters not shown/.test(f.content)), 'each reviser gets its own draft in full');
    assert.ok(['A', 'B', 'C'].includes(r.input.agent.yourDraft));
  }
  const revised = T.db.filter('Attempt', (a) => a.specId === spec.id && a.round === 'notes');
  assert.equal(revised.length, 3);
  assert.ok(revised.every((a) => a.edited >= 1 && a.hardPass), 'the revisions came back as edits, applied to full drafts that still pass the checks');
  const blindA = T.db.find('Attempt', (a) => a.specId === spec.id && a.round === 'blind' && a.label === 'A');
  const notesA = T.db.find('Attempt', (a) => a.specId === spec.id && a.round === 'notes' && a.label === 'A');
  assert.equal(notesA.files.length, blindA.files.length, 'untouched files carry over');
  assert.ok(notesA.usedMessageIds.length, 'the reviser says which notes it used');
});

test('with two finalists, only the best two revise; the third still counts as a loss', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { finalists: 2 });
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const spec = tops(T, c).find((x) => actions(T, x.id).includes('reveal'));
  const revised = T.db.filter('Attempt', (a) => a.specId === spec.id && a.round === 'notes');
  assert.deepEqual(revised.map((a) => a.label).sort(), ['A', 'B'], 'the mock supervisor ranks A, then B');
  const reveal = T.db.find('SupervisorAction', (x) => x.specId === spec.id && x.action === 'reveal');
  assert.match(reveal.reason, /The best 2 go on/);
  const specs = tops(T, c);
  const stats = T.db.all('WorkerStats');
  assert.equal(stats.reduce((n, s) => n + s.attempts, 0), specs.reduce((n, s) => n + s.competitors.length, 0), 'every competitor’s task is counted, finalist or not');
});

test('agents post notes to the job’s wire, later tiles read them, and an accepted attempt that relied on another config’s note earns it an assist', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { concurrency: 1 });
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  const notes = T.db.filter('AgentMessage', (m) => m.commissionId === c.id);
  assert.ok(notes.some((m) => m.to === 'team') && notes.some((m) => m.to === 'rivals'));
  assert.ok(notes.every((m) => m.attemptId && m.configId && m.fromName && m.taskTitle));
  assert.throws(() => T.db.tx((tx) => tx.update('AgentMessage', notes[0].id, { text: 'changed' })), /append-only/i, 'the wire is a record: notes can’t be edited');
  const withWire = T.db.filter('AgentRun', (r) => r.commissionId === c.id && r.agent === 'worker' && r.input?.wire?.length);
  assert.ok(withWire.length, 'later tiles read the wire');
  for (const r of withWire) assert.ok(r.input.wire.every((w) => w.id && w.text && notes.some((m) => m.id === w.id && m.tileId !== r.tileId)), 'a tile reads the other tiles’ notes');
  const used = T.db.filter('Attempt', (a) => a.commissionId === c.id && a.usedMessageIds?.length);
  assert.ok(used.length);
  const assists = T.db.all('WorkerStats').reduce((n, s) => n + (s.assists || 0), 0);
  assert.ok(assists >= 1, 'a note another config’s winning attempt used earned an assist');
  assert.ok(T.db.all('WorkerStats').some((s) => s.notes > 0), 'the notes each config posts are counted');
});

test('a Haiku challenger competes on every task, on its own model; the supervisor judges it like the rest', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { challenger: 'haiku' });
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const ch = T.db.find('WorkerConfig', (w) => w.key === 'challenger-haiku');
  assert.ok(ch && ch.challenger && ch.model === 'claude-haiku-4-5');
  for (const spec of tops(T, c)) assert.ok(spec.competitors.some((x) => x.configId === ch.id), `${spec.title}: the challenger competed`);
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id && r.agent === 'worker' && r.input?.agent?.config === ch.name);
  assert.ok(runs.length && runs.every((r) => r.shadowModel === 'claude-haiku-4-5'), 'it works on the cheaper model');
  setSwarm(T, { challenger: 'off' });
  const c2 = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.ok(tops(T, c2).every((spec) => !spec.competitors.some((x) => x.configId === ch.id)), 'switched off, it no longer competes');
});

test('a config that wins most of its tasks is cloned onto the next cheaper model, keeping its strategy', async () => {
  const T = await makeTessera({ crowd: false });
  for (const id of ['grant', 'pantry', 'course']) {
    await T.api.runWithAgents('usr_marisol', job(id));
    await T.swarm.settle();
  }
  const clone = T.db.find('WorkerConfig', (w) => w.parentConfigId);
  assert.ok(clone, 'a winning config was cloned');
  const parent = T.db.get('WorkerConfig', clone.parentConfigId);
  assert.equal(clone.model, 'claude-haiku-4-5', 'from the Sonnet worker model down to Haiku');
  assert.equal(clone.strategyHint, parent.strategyHint);
  assert.match(clone.why, /cheaper model/);
});

test('the requester’s files ride in the hour-long job layer: the same bytes for every tile, written to the cache once per job', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', {
    title: 'Revise the manuscript for the journal',
    goal: 'Revise the attached manuscript based on the reviewers’ critiques, and write a response to the reviewers explaining how each concern was addressed.',
    files: [{ name: 'Manuscript.docx', bytes: docxBytes() }],
  });
  await T.swarm.settle();
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id && r.agent === 'worker' && !r.error && r.input?.attachments?.length);
  const tiles = new Set(runs.map((r) => r.tileId));
  assert.ok(tiles.size >= 2);
  const first = new Set(runs.map((r) => AGENTS.worker.prompt.render(r.input)[0].text));
  assert.equal(first.size, 1, 'every tile’s job layer is byte for byte the same');
  assert.match([...first][0], /Manuscript\.docx/);
  const writes = runs.filter((r) => r.tokensCacheWrite1h > 0);
  assert.equal(writes.length, 1, 'the job layer (and the system prompt) is written once; every other call reads it');
});

test('free models only: a whole swarm job, planning to sign-off, runs on the free providers and never calls Claude', async () => {
  const { createMockProvider } = await import('../../src/llm/mock.js');
  const { mockBrains } = await import('../../src/agents/mock/index.js');
  const inner = createMockProvider({ brains: mockBrains });
  let claude = 0;
  const models = new Set();
  const T = await makeTessera({
    crowd: false,
    providerFactory: {
      anthropic: () => ({ name: 'anthropic', async complete() { claude++; throw new Error('Claude must not be called'); } }),
      openai: () => ({ name: 'openai-compatible', async complete(req) { models.add(req.model); return { ...(await inner.complete(req)), model: req.model }; } }),
    },
  });
  T.secrets.set('platform.anthropic', 'sk-ant-unused');
  T.secrets.set('free.gemini', 'gemini-key');
  T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, provider: 'free', free: { providers: [{ id: 'gemini', on: true, model: 'gemini-2.5-flash' }] } } } }));
  setSwarm(T, { competition: 'off', concurrency: 1 });
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  assert.equal(claude, 0);
  assert.deepEqual([...models], ['gemini-2.5-flash']);
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id);
  assert.ok(runs.some((r) => r.agent === 'decomposer') && runs.some((r) => r.agent === 'worker') && runs.some((r) => r.agent === 'assembler'));
  assert.ok(runs.every((r) => r.provider === 'free:gemini'), 'every call, planning and assembly included, went to the free model');
  assert.ok(T.db.filter('Tile', (t) => t.commissionId === c.id && t.webResearch).every((t) => t.research?.unavailable), 'no web research without Claude');
});
