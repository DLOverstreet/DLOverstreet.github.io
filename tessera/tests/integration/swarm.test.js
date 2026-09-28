// The agent swarm: a job handed to it is done by AI agents through every step after
// submission, on the same services, checks and ledger a person's job uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { createMockProvider } from '../../src/llm/mock.js';
import { mockBrains } from '../../src/agents/mock/index.js';
import { disaggregate } from '../../src/decompose/plan.js';
import { priceGraph } from '../../src/domain/pricing.js';
import { JOBS } from '../fixtures/jobs.js';

const job = (id) => { const j = JOBS.find((x) => x.id === id); return { title: j.title, goal: j.goal }; };
const setSwarm = (T, patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, swarm: { ...(tx.meta.settings.swarm || {}), ...patch } } }));

test('a job handed to the swarm is scoped, split, done, checked, assembled and signed off by agents', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  assert.equal(c.workforce, 'agents');
  await T.swarm.settle();
  const done = T.db.get('Commission', c.id);
  assert.equal(done.status, 'ACCEPTED');
  assert.equal(done.autopilot.state, 'DONE');
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id && !r.error);
  for (const agent of ['scoping', 'autopilot', 'decomposer', 'worker', 'reviewer', 'assembler']) assert.ok(runs.some((r) => r.agent === agent), `${agent} ran`);
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id);
  assert.ok(tiles.length >= 5);
  for (const t of tiles) {
    assert.equal(t.status, 'ACCEPTED', t.title);
    assert.ok(T.db.get('User', t.claimedById).isAgent, `${t.title} was done by an agent`);
    const sub = T.db.get('Submission', t.acceptedSubmissionId);
    if (!t.dynamic) assert.match(sub.modelUsed, /\(agent\)/);
  }
  // Every status change after submission was made by an agent, the autopilot's requester account or the platform.
  const people = new Set(T.db.filter('User', (u) => u.isContributor && !u.isAgent).map((u) => u.id));
  assert.ok(!T.db.filter('StatusChange', (x) => x.commissionId === c.id).some((x) => people.has(x.actor)));
  const report = new TextDecoder().decode(await T.blobs.get(done.deliverableKey));
  assert.match(report, /agent swarm/);
  // The money still balances: everything funded was paid out, charged as fees or refunded.
  const net = T.db.filter('LedgerEntry', (e) => e.commissionId === c.id).reduce((n, e) => n + e.amountCents, 0);
  assert.equal(net, 0);
});

test('agents and people are matched apart: agents never get a person’s job, people never get a swarm job', async () => {
  const T = await makeTessera({ crowd: true });
  const c = await T.api.runWithAgents('usr_tom', job('pantry'));
  await T.swarm.settle();
  await T.worker.drain({ crowd: true });
  for (const o of T.db.all('Offer')) {
    const agentJob = T.db.get('Commission', o.commissionId).workforce === 'agents';
    assert.equal(!!T.db.get('User', o.contributorId).isAgent, agentJob, `offer on ${agentJob ? 'a swarm job' : 'a people job'} went to the right side`);
  }
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  assert.ok(!T.db.filter('User', (u) => u.isAgent).some((u) => u.persona), 'agents never show up as personas');
});

test('an agent whose files fail the checks gets the failures back and revises', async () => {
  const T = await makeTessera({ crowd: false });
  setSwarm(T, { concurrency: 1 });
  const weak = { approach: ['Skimmed it.'], files: [{ name: 'draft.txt', content: 'todo' }], notes: '', checklist: [], handoff: '' };
  T.mock.queue('worker', [weak, weak, weak]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const first = T.db.filter('AgentRun', (r) => r.agent === 'worker' && r.commissionId === c.id).sort((a, b) => a.createdAt - b.createdAt || a.attempt - b.attempt)[0];
  const tile = T.db.get('Tile', first.tileId);
  const subs = T.db.filter('Submission', (s) => s.tileId === tile.id).sort((a, b) => a.round - b.round);
  assert.ok(subs.length >= 2, 'the weak round was handed in, failed and redone');
  assert.match(subs[0].notes, /known problems/);
  const revision = T.db.filter('AgentRun', (r) => r.agent === 'worker' && r.tileId === tile.id && r.input?.revision).at(-1);
  assert.ok(revision.input.revision.failed.length, 'the revision round saw what failed and why');
  assert.equal(tile.status, 'ACCEPTED');
});

test('on a paid model the swarm stops at the spend cap, and resumes when you raise it', async () => {
  const inner = createMockProvider({ brains: mockBrains });
  const fake = { name: 'anthropic', complete: async (req) => ({ ...(await inner.complete(req)), model: req.model }) };
  const T = await makeTessera({ crowd: false, providerFactory: { anthropic: () => fake } });
  T.secrets.set('platform.anthropic', 'sk-ant-test-key');
  T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, provider: 'anthropic' } } }));
  setSwarm(T, { spendCapUsd: 0.01 });
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  let cur = T.db.get('Commission', c.id);
  assert.equal(cur.autopilot.state, 'PAUSED');
  assert.match(cur.autopilot.note, /spend cap/);
  assert.notEqual(cur.status, 'ACCEPTED');
  assert.throws(() => T.api.resumeSwarmJob('usr_ruth', c.id), /Only the requester/);
  setSwarm(T, { spendCapUsd: 0 });
  T.api.resumeSwarmJob('usr_marisol', c.id);
  await T.swarm.settle();
  cur = T.db.get('Commission', c.id);
  assert.equal(cur.status, 'ACCEPTED');
  const work = T.db.filter('AgentRun', (r) => r.commissionId === c.id && r.agent === 'worker');
  assert.ok(work.length && work.every((r) => r.provider === 'anthropic' && ['claude-sonnet-5-5', 'claude-opus-5-5'].includes(r.model)), 'agents work on the current Sonnet, checks on the current Opus');
  assert.ok(!JSON.stringify(T.db.snapshot()).includes('sk-ant-test-key'), 'the key never reaches the database');
});

test('a plan from the breakdown tool runs with agents without scoping, and batches from a file are merged by code', async () => {
  const T = await makeTessera({ crowd: false });
  const rows = ['response_id,response'];
  for (let i = 1; i <= 120; i++) rows.push(`r${String(i).padStart(3, '0')},The landlord ignored repairs for unit ${i}`);
  const r = disaggregate({ ...job('survey'), privacy: 'RESTRICTED' });
  const plan = { tiles: r.tiles, rationale: r.rationale, source: 'breakdown', pricing: priceGraph(r.tiles) };
  const c = await T.api.runWithAgents('usr_marisol', { ...job('survey'), privacy: 'RESTRICTED', plan, files: [{ name: 'responses.csv', text: rows.join('\n') }] });
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  assert.ok(!T.db.find('AgentRun', (x) => x.commissionId === c.id && ['scoping', 'decomposer'].includes(x.agent)), 'the plan skipped scoping and decomposition');
  const batch = T.db.filter('AgentRun', (r) => r.agent === 'worker' && r.commissionId === c.id && r.input?.tile?.part).at(0);
  assert.match(batch.input.attachments[0].note, /^Rows 1–40 of 120/);
  const merge = T.db.find('Tile', (t) => t.commissionId === c.id && t.kind === 'INTEGRATION');
  const sub = T.db.get('Submission', merge.acceptedSubmissionId);
  assert.match(sub.notes, /Merged by code: coded_all\.csv \(120 rows from 3 files\)/);
  const merged = new TextDecoder().decode(await T.blobs.get(sub.files.find((f) => f.name === 'coded_all.csv').key));
  assert.equal(merged.trim().split('\n').length, 121);
});

test('tiles that need outside facts research first, the worker gets the notes, and the deliverable leads with the finished document', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', job('gala'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  const venue = T.db.find('Tile', (t) => t.commissionId === c.id && t.title === 'Find the venue');
  assert.ok(venue.webResearch && venue.research?.notes, 'the venue tile was researched');
  assert.equal(venue.agentMode, 'researched');
  const researched = T.db.filter('AgentRun', (r) => r.commissionId === c.id && r.agent === 'researcher');
  assert.equal(researched.length, T.db.count('Tile', (t) => t.commissionId === c.id && t.webResearch), 'one research call per tile that needs it');
  const work = T.db.filter('AgentRun', (r) => r.agent === 'worker' && r.tileId === venue.id).at(0);
  assert.match(work.input.research.notes, /## Findings/);
  const report = new TextDecoder().decode(await T.blobs.get(T.db.get('Commission', c.id).deliverableKey));
  assert.match(report, /\*The finished document: .+\.md, from integrate\.\*/);
  assert.ok(report.indexOf('The finished document') < report.indexOf('## Appendix: how it was made'), 'the product comes before how it was made');
});

test('when web search is off for the key, research stops after one try and agents mark outside facts instead; checks run on the check model', async () => {
  const inner = createMockProvider({ brains: mockBrains });
  const { LlmError } = await import('../../src/llm/errors.js');
  let webCalls = 0;
  const fake = {
    name: 'anthropic',
    async complete(req) {
      if (req.tools) { webCalls++; throw new LlmError('Web access isn’t available for this key: web search is not enabled', { retryable: false, code: 'web_disabled' }); }
      return { ...(await inner.complete(req)), model: req.model };
    },
  };
  const T = await makeTessera({ crowd: false, providerFactory: { anthropic: () => fake } });
  T.secrets.set('platform.anthropic', 'sk-ant-test-key');
  T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, provider: 'anthropic' } } }));
  setSwarm(T, { concurrency: 1 });
  const gala = await T.api.runWithAgents('usr_marisol', job('gala'));
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', gala.id).status, 'ACCEPTED');
  assert.equal(webCalls, 1, 'the first refusal switched research off for the session');
  const researched = T.db.filter('Tile', (t) => t.commissionId === gala.id && t.webResearch);
  assert.ok(researched.length && researched.every((t) => t.research?.unavailable), 'every tile that wanted research knows it had none');
  T.clock.advance(2 * 3600 * 1000);
  const survey = await T.api.runWithAgents('usr_marisol', job('survey'));
  await T.swarm.settle();
  const check = T.db.find('Tile', (t) => t.commissionId === survey.id && t.independentCheck);
  const runs = T.db.filter('AgentRun', (r) => r.agent === 'worker' && r.commissionId === survey.id && !r.error);
  assert.ok(runs.filter((r) => r.tileId === check.id).every((r) => r.model === 'claude-opus-5-5'), 'the agreement check ran on the check model');
  assert.ok(runs.filter((r) => r.tileId !== check.id).every((r) => r.model === 'claude-sonnet-5-5'), 'the work ran on the worker model');
});
