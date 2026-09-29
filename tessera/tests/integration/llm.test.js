import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { createAnthropicProvider } from '../../src/llm/anthropic.js';
import { runAgent } from '../../src/llm/run-agent.js';
import { AGENTS } from '../../src/agents/index.js';
import { SAMPLE_COMMISSIONS } from '../../src/services/seed.js';
import { DAY } from '../../src/lib/util.js';

async function claimedTile(T) {
  const tile = T.db.find('Tile', (t) => t.status === 'OFFERED' && !t.dynamic);
  const offer = T.db.find('Offer', (o) => o.tileId === tile.id && o.response === 'PENDING');
  T.api.respondToOffer(offer.contributorId, offer.id, true);
  return { tile: T.db.get('Tile', tile.id), who: offer.contributorId };
}

test('a brief whose checklist ids do not match the criteria is rejected and regenerated', async () => {
  const T = await makeTessera({ crowd: false });
  const { tile, who } = await claimedTile(T);
  const bad = { purpose: 'Do the thing well.', setup: [], steps: ['step one'], checklist: [{ criterionId: 'c1', text: 'only one, and loosened' }], pitfalls: [] };
  T.mock.queue('translator', [bad]);
  const brief = await T.api.generateBrief(who, tile.id);
  assert.deepEqual(brief.content.checklist.map((c) => c.criterionId), tile.acceptanceCriteria.map((c) => c.id));
  const runs = T.db.filter('AgentRun', (r) => r.agent === 'translator' && r.tileId === tile.id).sort((a, b) => a.attempt - b.attempt);
  assert.equal(runs.length, 2);
  assert.match(runs[0].error, /checklist/);
  assert.equal(runs[1].error, null);
});

test('an agent retries twice, then its job fails for a person to look at', async () => {
  const T = await makeTessera({ crowd: false });
  const s = SAMPLE_COMMISSIONS.flyer;
  const c = await T.api.postCommission('usr_tom', { ...s, deadline: T.clock.now() + 10 * DAY });
  T.mock.queue('scoping', ['not json at all', '{"questions": "wrong shape"}', { questions: [{ id: 'q' }] }]);
  await T.worker.drain();
  const runs = T.db.filter('AgentRun', (r) => r.agent === 'scoping' && r.commissionId === c.id);
  assert.equal(runs.length, 3);
  assert.ok(runs.every((r) => r.error));
  const job = T.db.find('Job', (j) => j.type === 'scope' && j.payload.commissionId === c.id);
  assert.equal(job.status, 'FAILED');
  assert.match(T.db.get('Commission', c.id).planError, /Scoping failed/);
  T.worker.retry(job.id);
  await T.worker.drain();
  assert.ok(T.db.get('Commission', c.id).clarifications.scopedAt, 'a retry after the failure succeeds');
});

test('the Anthropic provider sends structured-output requests straight to the API, and keys never reach the database', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) });
    const body = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ questions: [] }) }], usage: { input_tokens: 120, output_tokens: 30 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
  };
  const T = await makeTessera({ crowd: false, providerFactory: { anthropic: (o) => createAnthropicProvider({ ...o, baseURL: 'https://api.anthropic.com', fetch: fakeFetch }) } });
  const KEY = 'sk-ant-test-0123456789abcdef';
  T.secrets.set('platform.anthropic', KEY);
  T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, provider: 'anthropic' } } }));
  const route = T.llm.platform('heavy');
  const res = await runAgent({ agent: AGENTS.scoping, input: { commission: { title: 't', goal: 'g' }, files: [] }, route, log: T.log });
  assert.deepEqual(res.output, { questions: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages(\?beta=true)?$/);
  assert.equal(calls[0].headers['x-api-key'], KEY);
  assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.model, 'claude-opus-5-5', 'the heavy model is the current Opus');
  assert.equal(calls[0].body.output_config.format.type, 'json_schema');
  assert.equal(calls[0].body.output_config.format.schema.additionalProperties, false);
  assert.equal(calls[0].body.output_config.effort, 'medium', 'the agent sets its effort');
  assert.equal(calls[0].body.fallbacks, 'default', 'a refusal falls back server-side');
  assert.match(calls[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  const run = T.db.all('AgentRun').at(-1);
  assert.equal(run.provider, 'anthropic');
  assert.equal(run.tokensIn, 120);
  await T.flush();
  assert.ok(!JSON.stringify(T.db.snapshot()).includes(KEY), 'the key is not in the database snapshot');
});

test('a contributor with no personal key falls back to the shared model, and says so', async () => {
  const T = await makeTessera({ crowd: false });
  const dev = T.db.get('User', 'usr_dev');
  const profile = T.db.find('ContributorProfile', (p) => p.userId === 'usr_dev');
  const route = T.llm.contributor(dev, profile);
  assert.equal(route.providerName, 'mock');
  assert.match(route.fallback, /shared model/);
});

test('a research call gets Anthropic’s web tools, resumes a paused turn, and returns its sources and search count', async () => {
  const calls = [];
  const cited = { type: 'text', text: 'The venue seats 250 (https://example.org/hall).', citations: [{ type: 'web_search_result_location', url: 'https://example.org/hall', title: 'Hall', cited_text: 'Seats 250', encrypted_index: 'x' }] };
  const replies = [
    { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Searching. ' }, { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'hall capacity' } }, { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://example.org/hall', title: 'Hall', encrypted_content: 'e' }] }], usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } },
    { stop_reason: 'end_turn', content: [cited], usage: { input_tokens: 150, output_tokens: 40, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } } },
  ];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const r = replies[calls.length - 1];
    return new Response(JSON.stringify({ id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', ...r }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req' } });
  };
  const T = await makeTessera({ crowd: false, providerFactory: { anthropic: (o) => createAnthropicProvider({ ...o, baseURL: 'https://api.anthropic.com', fetch: fakeFetch }) } });
  T.secrets.set('platform.anthropic', 'sk-ant-test-web');
  T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, provider: 'anthropic' } } }));
  const route = T.llm.agent('claude-sonnet-5-5');
  const { webTools } = await import('../../src/services/swarm.js');
  const res = await runAgent({ agent: AGENTS.researcher, input: { tile: { title: 'Find the venue' } }, route, log: T.log, tools: webTools(route.model, { maxSearchesPerTile: 3, maxFetchesPerTile: 2 }) });
  assert.equal(calls.length, 2, 'the paused turn was resumed once');
  assert.deepEqual(calls[0].body.tools.map((t) => t.type), ['web_search_20260318', 'web_fetch_20260318']);
  assert.equal(calls[0].body.tools[0].max_uses, 3);
  assert.equal(calls[0].body.output_config?.format, undefined, 'no JSON format alongside cited web results');
  assert.equal(calls[1].body.messages.at(-1).role, 'assistant', 'the paused content went back unchanged');
  assert.equal(calls[1].body.messages.at(-1).content[2].content[0].encrypted_content, 'e');
  assert.match(res.output, /Searching\. The venue seats 250/);
  assert.deepEqual(res.sources.map((x) => [x.url, x.kind]), [['https://example.org/hall', 'cited']]);
  const run = T.db.filter('AgentRun', (r) => r.agent === 'researcher').at(-1);
  assert.equal(run.webSearches, 2);
  assert.equal(run.webFetches, 1);
  assert.equal(run.tokensIn, 250);
  const { runCostUsd } = await import('../../src/llm/prices.js');
  assert.equal(Number(runCostUsd(run).toFixed(6)), Number(((250 * 2 + 60 * 10) / 1e6 + 0.02).toFixed(6)), 'searches are billed at $10 per 1,000');
});

test('old default settings move to the current models, and a model someone picked is kept', async () => {
  const { createTessera } = await import('../../src/services/index.js');
  const { createMemoryWorldStore, createMemoryBlobStore, createMemoryKeyStore, createSecretStore } = await import('../../src/storage/stores.js');
  const T = await makeTessera({ crowd: false });
  const world = T.db.snapshot();
  world.meta.settingsVersion = 1;
  world.meta.settings = { ...world.meta.settings, llm: { ...world.meta.settings.llm, heavyModel: 'claude-sonnet-5', lightModel: 'claude-opus-5' }, swarm: { workerTier: 'light' } };
  const store = createMemoryWorldStore();
  await store.save(world);
  const T2 = await createTessera({ worldStore: store, blobs: createMemoryBlobStore(), keystore: createMemoryKeyStore(), secrets: createSecretStore(null) });
  assert.equal(T2.db.meta.settings.llm.heavyModel, 'claude-opus-5-5');
  assert.equal(T2.db.meta.settings.llm.lightModel, 'claude-opus-5', 'a deliberate choice stays');
  assert.equal(T2.db.meta.settings.swarm.workerModel, 'claude-opus-5');
  assert.equal(T2.db.meta.settings.swarm.workerTier, undefined);
});

test('a split tile’s shared context carries a prompt-cache breakpoint, and cache writes and reads are logged and priced', async () => {
  const calls = [];
  const usage = [{ input_tokens: 400, cache_creation_input_tokens: 6000, cache_read_input_tokens: 0, output_tokens: 300 }, { input_tokens: 450, cache_creation_input_tokens: 0, cache_read_input_tokens: 6000, output_tokens: 2000 }];
  const fakeFetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const text = JSON.stringify({ approach: ['Did it.'], files: [{ name: 'out.md', content: '# Out\n\nDone.' }], notes: '', checklist: [], handoff: '' });
    return new Response(JSON.stringify({ id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: usage[calls.length - 1] }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req' } });
  };
  const T = await makeTessera({ crowd: false, providerFactory: { anthropic: (o) => createAnthropicProvider({ ...o, baseURL: 'https://api.anthropic.com', fetch: fakeFetch }) } });
  T.secrets.set('platform.anthropic', 'sk-ant-test-cache');
  T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, provider: 'anthropic' } } }));
  const route = T.llm.agent('claude-sonnet-5-5');
  const input = { job: { title: 'Job' }, tile: { key: 't', title: 'Tile', outputs: ['out.md'], acceptanceCriteria: [] }, inputs: [], attachments: [] };
  await runAgent({ agent: AGENTS.worker, input: { ...input, delegation: { maxParts: 2, by: 'sections', files: ['out.md'] } }, route, log: T.log, cache: true });
  await runAgent({ agent: AGENTS.worker, input: { ...input, part: { index: 1, of: 2, brief: 'The first half.', files: ['out.md'] } }, route, log: T.log, cache: true });
  await runAgent({ agent: AGENTS.worker, input, route, log: T.log });
  const [lead, part, plain] = calls.map((b) => b.messages[0].content);
  assert.deepEqual(lead[0].cache_control, { type: 'ephemeral' }, 'the shared context is marked for the cache');
  assert.equal(lead[1].cache_control, undefined, 'what differs per call comes after the breakpoint');
  assert.equal(lead[0].text, part[0].text, 'the lead’s and the part’s shared context are byte-identical, so the part reads the cache');
  assert.notEqual(lead[1].text, part[1].text);
  assert.ok(plain.every((b) => !b.cache_control), 'a call that shares nothing writes no cache entry');
  const runs = T.db.filter('AgentRun', (r) => r.agent === 'worker');
  assert.equal(runs[0].tokensCacheWrite, 6000);
  assert.equal(runs[1].tokensCacheRead, 6000);
  const { runCostUsd } = await import('../../src/llm/prices.js');
  assert.equal(Number(runCostUsd(runs[0]).toFixed(6)), Number(((400 * 2 + 6000 * 2 * 1.25 + 300 * 10) / 1e6).toFixed(6)), 'a cache write costs 1.25 times the input price');
  assert.equal(Number(runCostUsd(runs[1]).toFixed(6)), Number(((450 * 2 + 6000 * 0.2 + 2000 * 10) / 1e6).toFixed(6)), 'a cache read costs $0.20 per million on Sonnet 5.5');
});
