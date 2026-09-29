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
/** A plan that loops back on itself: it parses but fails the graph check. */
const loop = { rationale: 'Two tiles that wait on each other.', tiles: ['a', 'b'].map((k, i) => ({ key: k, kind: 'WORK', title: `Tile ${k}`, spec: 'Do this piece of the job carefully.', deliverableFormat: 'Markdown', acceptanceCriteria: [{ id: 'c1', text: 'Done well', check: 'LLM' }], skillTags: ['editing'], tier: 2, estMinutes: 30, dependsOn: [i ? 'a' : 'b'] })) };

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
  T.mock.queue('decomposer', [loop, loop]);
  const c = await T.api.runWithAgents('usr_marisol', job('grant'));
  await T.swarm.settle();
  const done = T.db.get('Commission', c.id);
  assert.equal(done.status, 'ACCEPTED');
  assert.ok(done.plan.staged >= 2, 'the plan came from the staged path');
  assert.match(done.plan.repairs.join(' '), /didn't fit in one reply .* planned it in stages/);
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id);
  assert.equal(runs.filter((r) => r.agent === 'decomposer').length, 2, 'one retry, not three identical tries');
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
  T.mock.queue('decomposer', [loop, loop]);
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

test('a staged stream must write exactly its skeleton’s tiles', () => {
  const outline = { streams: [{ key: 's', tiles: [{ key: 'a' }, { key: 'b' }] }, { key: 't', tiles: [{ key: 'c' }] }] };
  const tile = (key, deps = []) => ({ key, dependsOn: deps, acceptanceCriteria: [{ id: 'c1' }] });
  const v = (tiles) => AGENTS.decomposerStream.validate({ tiles }, { outline, stream: 's' });
  assert.deepEqual(v([tile('a'), tile('b', ['c'])]), []);
  assert.match(v([tile('a')]).join(' '), /missing b/);
  assert.match(v([tile('a'), tile('b'), tile('x')]).join(' '), /x isn't in it/);
  assert.match(v([tile('a', ['zz']), tile('b')]).join(' '), /depends on "zz"/);
});
