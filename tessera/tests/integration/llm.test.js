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
    const body = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ questions: [] }) }], usage: { input_tokens: 120, output_tokens: 30 } };
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
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].headers['x-api-key'], KEY);
  assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.model, 'claude-sonnet-5');
  assert.equal(calls[0].body.output_config.format.type, 'json_schema');
  assert.equal(calls[0].body.output_config.format.schema.additionalProperties, false);
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
