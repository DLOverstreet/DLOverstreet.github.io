// A plan too long for one reply: the Decomposer's reply limit, what a cut-off reply costs, the
// retry that thinks less, streaming for long replies, planning in stages, and the engine's plan
// as the last resort so a job never stalls on planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { createAnthropicProvider } from '../../src/llm/anthropic.js';
import { runAgent } from '../../src/llm/run-agent.js';
import { LlmError } from '../../src/llm/errors.js';
import { runCostUsd } from '../../src/llm/prices.js';
import { AGENTS } from '../../src/agents/index.js';
import { mockDecompose } from '../../src/agents/mock/decomposer.js';
import { JOBS } from '../fixtures/jobs.js';

const job = (id) => { const j = JOBS.find((x) => x.id === id); return { title: j.title, goal: j.goal }; };
/** A reply that isn't a plan at all: it fails the schema. */
const loop = { rationale: 'There are no tiles in this plan.', tiles: [] };
/** A tile as a model might write it: a long title, a key that isn't kebab-case, a big estimate. */
const tile = (key, deps = [], extra = {}) => ({ key, kind: 'WORK', title: `Tile ${key}`, spec: 'Do this piece of the job carefully and completely.', deliverableFormat: 'Markdown', acceptanceCriteria: [{ id: 'c1', text: 'Done well', check: 'LLM' }], skillTags: ['editing'], tier: 2, estMinutes: 30, dependsOn: deps, ...extra });

test('a reply cut off at max_tokens is logged with what it spent, and the retry thinks less instead of repeating itself', async () => {
  const efforts = [];
  const rows = [];
  const plan = mockDecompose({ commission: job('grant') });
  const provider = {
    async complete(req) {
      efforts.push([req.effort, req.maxTokens]);
      if (efforts.length === 1) throw new LlmError('The response hit max_tokens (64000) before finishing.', { code: 'max_tokens', usage: { inputTokens: 5200, outputTokens: 64000 }, model: 'claude-opus-5-5' });
      return { text: JSON.stringify(plan), model: 'claude-opus-5-5', usage: { inputTokens: 5200, outputTokens: 9000 } };
    },
  };
  const route = { provider, model: 'claude-opus-5-5', providerName: 'anthropic' };
  const res = await runAgent({ agent: AGENTS.decomposer, input: { commission: job('grant') }, route, log: (r) => rows.push(r) });
  assert.equal(res.output.tiles.length, plan.tiles.length);
  assert.deepEqual(efforts, [['high', 64000], ['medium', 64000]], 'the Decomposer gets a 64k reply limit, and the retry steps effort down');
  assert.match(rows[0].error, /max_tokens/);
  assert.equal(rows[0].tokensOut, 64000, 'a cut-off reply still reports its tokens');
  assert.ok(runCostUsd(rows[0]) > 1.2, 'and its cost: 64k output tokens on Opus 5.5 is about $1.30');
  assert.equal(rows[0].effort, 'high');
  assert.equal(rows[1].effort, 'medium');
});

test('a request allowed a long reply streams, and a cut-off stream carries its usage', async () => {
  const bodies = [];
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4100, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"rationale": "A long pl' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 64000 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  const fakeFetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req' } });
  };
  const provider = createAnthropicProvider({ apiKey: 'sk-ant-test', baseURL: 'https://api.anthropic.com', fetch: fakeFetch });
  await assert.rejects(
    () => provider.complete({ model: 'claude-opus-5-5', system: 'Plan.', messages: [{ role: 'user', content: 'Go.' }], maxTokens: 64000 }),
    (e) => e instanceof LlmError && e.code === 'max_tokens' && e.usage.outputTokens === 64000 && e.usage.inputTokens === 4100,
  );
  assert.equal(bodies[0].stream, true, 'a 64k reply limit streams, so no HTTP timeout cuts it off');
  assert.equal(bodies[0].max_tokens, 64000);
});

test('when one reply can’t hold the plan, the Decomposer plans in stages: a skeleton, then every workstream at once', async () => {
  const T = await makeTessera({ crowd: false });
  T.mock.queue('decomposer', [loop]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  const done = T.db.get('Commission', c.id);
  assert.equal(done.status, 'ACCEPTED');
  assert.ok(done.plan.staged >= 2, 'the plan came from the staged path');
  assert.match(done.plan.repairs.join(' '), /didn't come back in one reply .* planned it in stages/);
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id);
  assert.equal(runs.filter((r) => r.agent === 'decomposer').length, 1, 'a failed one-shot plan isn’t asked for again: the stages are shorter');
  assert.equal(runs.filter((r) => r.agent === 'decomposer-outline' && !r.error).length, 1);
  const streams = runs.filter((r) => r.agent === 'decomposer-stream' && !r.error);
  assert.equal(streams.length, done.plan.staged, 'one call per workstream');
  assert.ok(streams.filter((r) => r.tokensCacheRead > 0).length >= streams.length - 1, 'the streams read the shared job and skeleton from the cache');
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id && !t.dynamic);
  const outline = runs.find((r) => r.agent === 'decomposer-outline' && !r.error).output;
  assert.deepEqual(tiles.map((t) => t.key).sort(), outline.streams.flatMap((st) => st.tiles.map((t) => t.key)).sort(), 'the tiles are exactly the skeleton’s');
});

test('if staged planning fails too, the engine’s plan is used and the swarm carries on', async () => {
  const T = await makeTessera({ crowd: false });
  const dangling = { rationale: 'A skeleton with a loose end.', streams: [{ key: 'drafts', name: 'Drafts', purpose: 'Write the drafts.', tiles: [{ key: 'draft', title: 'Write the draft', outputs: ['draft.md'], dependsOn: ['nowhere'], covers: [] }] }] };
  T.mock.queue('decomposer', [loop]);
  T.mock.queue('decomposer-outline', [dangling, dangling, dangling]);
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  const done = T.db.get('Commission', c.id);
  assert.equal(done.status, 'ACCEPTED', 'planning never stalls the job');
  assert.equal(done.plan.source, 'engine');
  assert.match(done.plan.repairs.join(' '), /Staged planning failed too .* engine's plan/);
  const bad = T.db.filter('AgentRun', (r) => r.agent === 'decomposer-outline');
  assert.equal(bad.length, 3);
  assert.match(bad[0].error, /depends on "nowhere"/);
});

test('a plan with long titles, loose keys, a loop or an oversized tile is repaired, not thrown away', async () => {
  const T = await makeTessera({ crowd: false });
  const long = 'Build the comment matrix: every tracker, editor and advisor item with a decision, a target section and a plan';
  T.mock.queue('decomposer', [{ rationale: 'A plan written the way a model writes a big one.', tiles: [
    tile('Comment Matrix', [], { title: long }),
    tile('revise-a', ['Comment Matrix', 'revise-b'], { estMinutes: 200 }),
    tile('revise-b', ['revise-a']),
    tile('letter', ['revise-a', 'revise-b', 'nowhere'], { kind: 'INTEGRATION' }),
  ] }]);
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  await T.swarm.settle();
  const done = T.db.get('Commission', c.id);
  assert.equal(done.status, 'ACCEPTED');
  assert.equal(T.db.filter('AgentRun', (r) => r.commissionId === c.id && r.agent === 'decomposer').length, 1, 'accepted on the first reply');
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id && !t.dynamic);
  assert.ok(tiles.every((t) => t.title.length <= 80));
  assert.ok(tiles.some((t) => t.title.startsWith('Build the comment matrix: every tracker, editor and advisor item') && t.title.endsWith('…')));
  assert.ok(tiles.some((t) => t.key === 'comment-matrix'), 'keys made kebab-case');
  const notes = done.plan.repairs.join(' ');
  assert.match(notes, /Shortened a title to 80 characters/);
  assert.match(notes, /Broke a dependency loop/);
  assert.match(notes, /Split “.*” \(200 min\)/);
});

test('a job with long attached documents is planned in stages from the start', async () => {
  const T = await makeTessera({ crowd: false });
  const memo = `# Revision memo\n\n${'The reviewers ask for more literature on policy diffusion and a clearer theory section. '.repeat(300)}`;
  const c = await T.api.runWithAgents('usr_marisol', { ...job('grant'), files: [{ name: 'memo.md', text: memo }] });
  await T.swarm.settle();
  const done = T.db.get('Commission', c.id);
  assert.equal(done.status, 'ACCEPTED');
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id);
  assert.equal(runs.filter((r) => r.agent === 'decomposer').length, 0, 'no single long reply is tried');
  assert.ok(runs.some((r) => r.agent === 'decomposer-outline'));
  assert.match(done.plan.repairs.join(' '), /A big job \(\d+k characters of attached documents\), so the Decomposer planned it in stages/);
});

test('a rate limit is waited out as the API asks; a cut-off or timed-out reply retries with less thinking', async () => {
  const waits = [];
  const seen = [];
  const plan = mockDecompose({ commission: job('pantry') });
  const errors = [
    new LlmError('Anthropic rate limit reached (429): too many output tokens', { code: 'rate_limit', retryAfterMs: 7000 }),
    new LlmError('The request ran past its time limit before the reply finished.', { code: 'timeout' }),
  ];
  const provider = { async complete(req) { seen.push(req.effort); const e = errors.shift(); if (e) throw e; return { text: JSON.stringify(plan), model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 10 } }; } };
  const rows = [];
  await runAgent({ agent: AGENTS.decomposer, input: { commission: job('pantry') }, route: { provider, model: 'claude-opus-5-5', providerName: 'anthropic' }, log: (r) => rows.push(r), wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [7000], 'waited as long as the API asked, then went again');
  assert.deepEqual(seen, ['high', 'high', 'medium'], 'the timed-out try is followed by one that thinks less');
  assert.match(rows[0].error, /rate limit reached \(429\)/);
});

test('a long call gets no silent SDK retry, and a 429 carries its retry-after', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Output tokens per minute exceeded' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '12', 'request-id': 'req' } }); };
  const provider = createAnthropicProvider({ apiKey: 'sk-ant-test', baseURL: 'https://api.anthropic.com', fetch: fakeFetch });
  await assert.rejects(
    () => provider.complete({ model: 'claude-opus-5-5', system: 'Plan.', messages: [{ role: 'user', content: 'Go.' }], maxTokens: 64000 }),
    (e) => e instanceof LlmError && e.code === 'rate_limit' && e.retryAfterMs === 12000 && /Output tokens per minute/.test(e.message),
  );
  assert.equal(calls, 1, 'runAgent decides the retry, after waiting');
});

test('a planning job cut off by a page reload starts again, and Resume replans a job whose planning stopped', async () => {
  const T = await makeTessera({ crowd: false });
  const c = await T.api.runWithAgents('usr_marisol', job('pantry'));
  // Planning stopped: the decompose job was running when the page closed, then failed on the next try.
  T.db.tx((tx) => tx.insert('Job', { type: 'decompose', payload: { commissionId: c.id }, status: 'RUNNING', attempts: 1, runAfter: 0, lastError: null, dedupeKey: `decompose:${c.id}` }));
  const { createWorker } = await import('../../src/jobs/worker.js');
  createWorker(T);
  assert.equal(T.db.find('Job', (j) => j.dedupeKey === `decompose:${c.id}`).status, 'PENDING', 'a job left running by a closed page runs again');
  T.db.tx((tx) => {
    for (const j of tx.filter('Job', (x) => x.status === 'PENDING')) tx.update('Job', j.id, { status: 'FAILED' });
    tx.update('Commission', c.id, { planError: 'Decomposition failed: rate limit', planState: null, clarifications: { ...tx.get('Commission', c.id).clarifications, questions: [] } });
  });
  T.api.pauseSwarmJob('usr_marisol', c.id);
  T.api.resumeSwarmJob('usr_marisol', c.id);
  const cur = T.db.get('Commission', c.id);
  assert.equal(cur.planState, 'DECOMPOSING');
  assert.equal(cur.planError, null);
  assert.match(cur.autopilot.note, /planning again/);
  await T.swarm.settle();
  assert.equal(T.db.get('Commission', c.id).status, 'ACCEPTED');
  assert.throws(() => T.api.retryPlanning('usr_marisol', c.id), /past planning/);
});

test('a staged stream must write exactly its skeleton’s tiles', () => {
  const outline = { streams: [{ key: 's', tiles: [{ key: 'a' }, { key: 'b' }] }, { key: 't', tiles: [{ key: 'c' }] }] };
  const tile = (key, deps = []) => ({ key, dependsOn: deps, acceptanceCriteria: [{ id: 'c1' }] });
  const v = (tiles) => AGENTS.decomposerStream.validate({ tiles }, { outline, stream: 's' });
  assert.deepEqual(v([tile('a'), tile('b', ['c'])]), []);
  assert.match(v([tile('a')]).join(' '), /missing b/);
  assert.match(v([tile('a'), tile('b'), tile('x')]).join(' '), /x isn't in it/);
  assert.deepEqual(v([tile('a', ['zz']), tile('b')]), [], 'dependencies come from the skeleton, so a stray one isn’t sent back');
});
