// What makes a job cheaper to run, piece by piece: edits instead of rewrites, the wire and its
// assists, cost-aware routing and cheaper clones, the system prompt's cache breakpoint, the free
// providers tried before Claude, and half-price batches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, materializeWork, cleanMessages } from '../../src/agents/edits.js';
import { pickCompetitors, wireFor, taskNotes, assistsFrom, evolveConfigs, leaderboard } from '../../src/domain/supervision.js';
import { systemBlocks, createBatcher } from '../../src/llm/anthropic.js';
import { runCostUsd } from '../../src/llm/prices.js';
import { createFreeChain } from '../../src/llm/free-chain.js';
import { createLlmRouter } from '../../src/llm/router.js';
import { createMockProvider } from '../../src/llm/mock.js';
import { runAgent } from '../../src/llm/run-agent.js';
import { LlmError } from '../../src/llm/errors.js';
import { render } from '../../src/agents/prompts/worker.v5.js';
import { s } from '../../src/lib/schema.js';

test('edits apply in order to the prior draft; a passage that isn’t there, or is there twice, is a problem', () => {
  const files = [{ name: 'a.md', content: '# Title\n\nOne. Two. Two.\n' }];
  const ok = applyEdits(files, [{ file: 'a.md', find: 'One.', replace: 'Uno.' }, { file: 'a.md', find: '# Title', replace: '# New title' }]);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.files[0].content, '# New title\n\nUno. Two. Two.\n');
  assert.equal(files[0].content, '# Title\n\nOne. Two. Two.\n', 'the prior draft itself is untouched');
  const bad = applyEdits(files, [{ file: 'a.md', find: 'Two.', replace: 'x' }, { file: 'a.md', find: 'Three', replace: 'x' }, { file: 'b.md', find: 'x', replace: 'y' }]);
  assert.match(bad.problems[0], /occurs 2 times/);
  assert.match(bad.problems[1], /isn't in your prior draft word for word/);
  assert.match(bad.problems[2], /no file b\.md/);
  assert.equal(ApplyDollar(), '$&', 'a replacement is taken literally');
  function ApplyDollar() { return applyEdits([{ name: 'x.md', content: 'cost' }], [{ file: 'x.md', find: 'cost', replace: '$&' }]).files[0].content; }
});

test('a revision by edits hands in the whole draft: edited files, files written again, and untouched files carried over', () => {
  const input = { agent: { priorDraft: { files: [{ name: 'report.md', content: 'Intro.\nResults: 12.\n' }, { name: 'data.csv', content: 'id,n\n1,2\n' }, { name: 'notes.md', content: 'old' }] } } };
  const out = { approach: ['x'], files: [{ name: 'notes.md', content: 'new' }], edits: [{ file: 'report.md', find: 'Results: 12.', replace: 'Results: 14.' }], notes: '', checklist: [], messages: [], usedMessages: [] };
  const made = materializeWork(out, input);
  assert.deepEqual(made.problems, []);
  assert.deepEqual(Object.fromEntries(made.output.files.map((f) => [f.name, f.content])), { 'report.md': 'Intro.\nResults: 14.\n', 'data.csv': 'id,n\n1,2\n', 'notes.md': 'new' });
  assert.equal(made.output.edited, 1);
  const blind = materializeWork({ ...out, edits: [{ file: 'report.md', find: 'a', replace: 'b' }] }, {});
  assert.match(blind.problems[0], /only for revising your own prior draft/);
});

test('wire notes are cleaned up: three at most, short, with a known audience and kind', () => {
  const notes = cleanMessages([
    { to: 'Rivals', kind: 'WARNING', text: 'Row 41 repeats row 40; drop the duplicate before counting.' },
    { to: 'everyone', kind: 'gossip', text: 'x'.repeat(900) },
    { to: 'team', kind: 'tip', text: 'short' },
    { to: 'team', kind: 'answer', text: 'The codebook uses snake_case ids like tenant_01.', replyTo: 'msg_1' },
    { to: 'team', kind: 'tip', text: 'A fourth note is one too many for one worker.' },
  ]);
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map((n) => [n.to, n.kind]), [['rivals', 'warning'], ['team', 'tip'], ['team', 'answer']]);
  assert.equal(notes[1].text.length, 400);
  assert.equal(notes[2].replyTo, 'msg_1');
});

test('the wire shows the newest team notes within a size limit, rival notes stay with their task, and assists credit other configs only', () => {
  const m = (id, extra) => ({ id, createdAt: Number(id.slice(1)), to: 'team', kind: 'tip', text: `note ${id} with enough words to matter`, taskTitle: 'Code the survey', fromName: 'Careful', configId: 'c1', taskType: 'coding', ...extra });
  const rows = [m('m1'), m('m2', { to: 'rivals', specId: 's1', label: 'B' }), m('m3', { configId: 'c2' }), m('m4', { configId: null })];
  const wire = wireFor(rows, { max: 2 });
  assert.deepEqual(wire.map((w) => w.id), ['m3', 'm4'], 'newest two team notes, oldest first');
  assert.match(wire[0].from, /Careful on “Code the survey”/);
  assert.deepEqual(taskNotes(rows, 's1').map((n) => [n.id, n.from]), [['m2', 'B']]);
  assert.deepEqual(assistsFrom(['m1', 'm3', 'm4', 'm3', 'nope'], rows, 'c2'), [{ messageId: 'm1', configId: 'c1', taskType: 'coding' }], 'not its own config, not a note without one, once per note');
});

test('routing prefers the cheaper of two configs that score about the same, and always includes the challenger', () => {
  const configs = [{ id: 'a', name: 'Opus careful' }, { id: 'b', name: 'Haiku careful' }, { id: 'c', name: 'Skeptic' }, { id: 'ch', name: 'Free challenger' }];
  const stats = [
    { configId: 'a', taskType: 't', attempts: 10, wins: 4, scoreSum: 8.0, costMicroUsd: 900000 },
    { configId: 'b', taskType: 't', attempts: 10, wins: 4, scoreSum: 7.95, costMicroUsd: 200000 },
    { configId: 'c', taskType: 't', attempts: 10, wins: 2, scoreSum: 6.0, costMicroUsd: 500000 },
    { configId: 'ch', taskType: 't', attempts: 10, wins: 0, scoreSum: 4.0, costMicroUsd: 0 },
  ];
  const two = pickCompetitors(configs, stats, 't', { competitors: 2, routing: false });
  assert.deepEqual(two.picked.map((c) => c.id), ['b', 'a'], 'same score band: the cheaper first');
  const withChallenger = pickCompetitors(configs, stats, 't', { competitors: 3, routing: false, include: ['ch'] });
  assert.deepEqual(withChallenger.picked.map((c) => c.id), ['b', 'a', 'ch'], 'the challenger takes the lowest-ranked place');
  // Notes that helped others' winning work earn a small bonus in the ranking.
  const assisted = pickCompetitors(configs, stats.map((x) => (x.configId === 'c' ? { ...x, assists: 8 } : x)), 't', { competitors: 3, routing: false });
  assert.ok(assisted.picked.some((c) => c.id === 'c'));
  const board = leaderboard(stats.map((x) => ({ ...x, assists: x.configId === 'a' ? 3 : 0 })), configs);
  assert.equal(board.find((r) => r.configId === 'a').assists, 3);
});

test('a winning config is cloned first onto the next cheaper model with its own strategy, then with a new strategy', () => {
  const configs = [{ id: 'w', name: 'Careful', strategyHint: 'hint', status: 'active', model: null }, { id: 'x', name: 'X', strategyHint: 'hx', status: 'active' }, { id: 'y', name: 'Y', strategyHint: 'hy', status: 'active' }];
  const stats = [{ configId: 'w', taskType: 't', attempts: 8, wins: 6 }];
  const downshift = (m) => (m === null || m === 'claude-sonnet-5-5' ? { model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' } : null);
  const first = evolveConfigs(configs, stats, { downshift });
  assert.deepEqual(first.clones, [{ parentId: 'w', name: 'Careful · Claude Haiku 4.5', strategyHint: 'hint', model: 'claude-haiku-4-5' }]);
  const later = evolveConfigs([...configs, { id: 'h', name: 'Careful · Claude Haiku 4.5', parentConfigId: 'w', model: 'claude-haiku-4-5', status: 'retired' }], stats, { downshift });
  assert.equal(later.clones[0].model, null, 'the cheaper model was tried and retired: next, a new strategy on the same model');
  assert.notEqual(later.clones[0].strategyHint, 'hint');
});

test('the worker prompt’s cache layers: the requester’s files in the hour-long job layer, the wire with the task, the playbook uncached', () => {
  const input = {
    job: { title: 'J', goal: 'G' }, tile: { key: 't1' }, inputs: [], wire: [{ id: 'msg_1', text: 'tip' }],
    attachments: [{ name: 'Manuscript.docx', content: 'whole text', shared: true }, { name: 'rows.csv', note: 'your batch', content: 'a,b' }],
    playbook: { taskType: 'writing', lessons: ['L1'] }, agent: { config: 'Careful', mode: 'blind' },
  };
  const [jobBlock, task, call] = render(input);
  assert.equal(jobBlock.cache, '1h');
  assert.match(jobBlock.text, /Manuscript\.docx/);
  assert.doesNotMatch(jobBlock.text, /"shared"/);
  assert.equal(task.cache, true);
  assert.match(task.text, /msg_1/);
  assert.match(task.text, /rows\.csv/);
  assert.doesNotMatch(task.text, /Manuscript/);
  assert.equal(call.cache, undefined);
  assert.match(call.text, /L1/, 'the playbook moved out of the shared prefix, so the control worker shares the task layer');
  const control = render({ ...input, playbook: undefined });
  assert.equal(control[1].text, task.text);
});

test('a caching call marks the system prompt for an hour, unless the messages already use every breakpoint', () => {
  const block = (cache) => ({ type: 'text', text: 'x', ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) });
  assert.deepEqual(systemBlocks({ system: 'S', cacheSystem: true }, [{ role: 'user', content: [block(true), block(false)] }]), [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
  assert.equal(systemBlocks({ system: 'S', cacheSystem: false }, []), 'S');
  assert.equal(systemBlocks({ system: 'S', cacheSystem: true }, [{ role: 'user', content: [block(true), block(true), block(true), block(true)] }]), 'S');
});

test('batched calls are sent together as one Message Batch, each caller gets its own result, and they cost half', async () => {
  const created = [];
  let polls = 0;
  const client = {
    messages: {
      batches: {
        async create({ requests }) { created.push(requests); return { id: 'b1', processing_status: 'in_progress' }; },
        async retrieve() { polls++; return { id: 'b1', processing_status: polls >= 2 ? 'ended' : 'in_progress' }; },
        async results() {
          const reqs = created[0];
          return (async function* results() {
            yield { custom_id: reqs[1].custom_id, result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } } };
            yield { custom_id: reqs[0].custom_id, result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: {} } } };
          })();
        },
      },
    },
  };
  const waits = [];
  const b = createBatcher(async () => client, { windowMs: 5, pollMs: 10, wait: async (ms) => { waits.push(ms); } });
  const [one, two] = await Promise.allSettled([b.add({ model: 'm', n: 1 }), b.add({ model: 'm', n: 2 })]);
  assert.equal(created.length, 1, 'one batch for both');
  assert.deepEqual(created[0].map((r) => r.params.n), [1, 2]);
  assert.equal(one.status === 'fulfilled' && one.value.content[0].text, 'hi');
  assert.ok(two.status === 'rejected' && two.reason instanceof LlmError && two.reason.code === 'bad_request' && !two.reason.retryable);
  assert.deepEqual(waits, [10, 15], 'polls back off');
  const run = { model: 'claude-sonnet-5-5', tokensIn: 1e6, tokensOut: 1e6 };
  assert.equal(runCostUsd(run), 12);
  assert.equal(runCostUsd({ ...run, batch: true }), 6);
});

const Echo = s.object({ ok: s.boolean() });
const ECHO = { name: 'echo', schema: Echo, prompt: { version: 'echo.v1', system: 'Return JSON.', render: () => 'Say ok.' } };

/** A fake OpenAI-compatible provider: answers with `reply`, or throws what `fail` returns. */
function fakeFree({ reply = '{"ok":true}', fail = null } = {}) {
  const calls = [];
  return { calls, provider: { name: 'openai-compatible', async complete(req) { calls.push(req.model); if (fail) throw fail(); return { text: reply, model: req.model, usage: { inputTokens: 5, outputTokens: 2 } }; } } };
}

test('free providers are tried in order; one out of quota rests, and when none answers the call goes to Claude', async () => {
  let t = 0;
  const cooldown = new Map();
  const gemini = fakeFree({ fail: () => new LlmError('429: quota exceeded per day', { retryable: true, code: 'rate_limit' }) });
  const groq = fakeFree();
  const chain = createFreeChain([{ id: 'gemini', label: 'Gemini', model: 'gemini-2.5-flash', provider: gemini.provider }, { id: 'groq', label: 'Groq', model: 'gpt-oss', provider: groq.provider }], { now: () => t, cooldown });
  const res = await chain.complete({ system: 's', messages: [] });
  assert.equal(res.freeProvider, 'groq');
  assert.ok(cooldown.get('gemini') >= 3600000, 'a daily quota rests the provider for an hour');
  await chain.complete({ system: 's', messages: [] });
  assert.equal(gemini.calls.length, 1, 'while it rests, it isn’t asked');
  t = 4000000;
  await chain.complete({ system: 's', messages: [] });
  assert.equal(gemini.calls.length, 2, 'after the rest it is asked again');
});

/** @param {any} free @param {{ anthropic?: any }} [opts] */
function routerWith(free, { anthropic = null } = {}) {
  const secrets = new Map([['platform.anthropic', 'sk-ant-x'], ['free.gemini', 'g-key'], ['free.groq', 'q-key']]);
  const settings = { provider: 'anthropic', heavyModel: 'claude-opus-5-5', lightModel: 'claude-haiku-4-5', free };
  const made = {};
  const router = createLlmRouter({
    getSettings: () => settings, secrets: { get: (k) => secrets.get(k) }, mock: createMockProvider(),
    providerFactory: {
      anthropic: () => anthropic || { name: 'anthropic', async complete(req) { return { text: '{"ok":true}', model: req.model, usage: { inputTokens: 10, outputTokens: 3 } }; } },
      openai: ({ baseUrl }) => { made[baseUrl] = made[baseUrl] || fakeFree({ reply: 'not json' }); return made[baseUrl].provider; },
    },
  });
  return { router, made };
}

test('light work tries free models first on public jobs only; a free reply that fails its schema goes to Claude', async () => {
  const free = { light: true, providers: [{ id: 'gemini', on: true, model: 'gemini-2.5-flash' }, { id: 'ollama', on: true, model: 'llama3.1' }] };
  const { router } = routerWith(free);
  const pub = router.forCommission({ privacy: 'PUBLIC' }, 'light');
  assert.equal(pub.free, true);
  assert.match(pub.label, /gemini-2\.5-flash \(free, then llama3\.1\), then claude-haiku-4-5/);
  const restricted = router.forCommission({ privacy: 'NEED_TO_KNOW' }, 'light');
  assert.equal(restricted.free, true, 'a local model may still take a private job');
  assert.match(restricted.label, /^llama3\.1 \(free\)/);
  assert.equal(router.forCommission({ privacy: 'PUBLIC' }, 'heavy').free, undefined, 'heavy work never goes to free models');
  assert.equal(routerWith({ ...free, light: false }).router.forCommission({ privacy: 'PUBLIC' }, 'light').free, undefined);
  const logs = [];
  const res = await runAgent({ agent: ECHO, input: {}, route: pub, log: (r) => logs.push(r), retries: 0, wait: async () => {} });
  assert.deepEqual(res.output, { ok: true });
  assert.equal(res.provider, 'anthropic');
  assert.deepEqual(logs.map((l) => [l.provider, l.model, !!l.error]), [['free:gemini', 'gemini-2.5-flash', true], ['anthropic', 'claude-haiku-4-5', false]], 'the free attempt is logged, then Claude answers');
  assert.equal(logs[0].shadowModel, 'claude-haiku-4-5', 'the admin view can show what the free call would have cost');
});

test('a swarm agent on the model "free" falls back to the worker model on Claude, and a free answer that holds up costs nothing', async () => {
  const { router, made } = routerWith({ providers: [{ id: 'groq', on: true, model: 'gpt-oss' }] });
  const route = router.agent('free', { commission: { privacy: 'PUBLIC' }, fallbackModel: 'claude-sonnet-5-5' });
  assert.equal(route.fallback.model, 'claude-sonnet-5-5');
  made['https://api.groq.com/openai/v1'] = fakeFree();
  router.clearCache();
  const fresh = router.agent('free', { commission: { privacy: 'PUBLIC' }, fallbackModel: 'claude-sonnet-5-5' });
  const logs = [];
  const res = await runAgent({ agent: ECHO, input: {}, route: fresh, log: (r) => logs.push(r), retries: 0 });
  assert.equal(res.free, true);
  assert.equal(logs.length, 1);
  assert.equal(runCostUsd(logs[0]), 0);
  assert.equal(router.agent('free', { commission: { privacy: 'RESTRICTED' }, fallbackModel: 'claude-sonnet-5-5' }).model, 'claude-sonnet-5-5', 'a restricted job never goes to a cloud free tier');
});

test('free models only: every tier runs on the free chain with no Claude fallback, and private jobs need permission', async () => {
  const free = { providers: [{ id: 'gemini', on: true, model: 'gemini-2.5-flash' }] };
  const s = { provider: 'free', heavyModel: 'claude-opus-5-5', lightModel: 'claude-haiku-4-5', free };
  const only = createLlmRouter({ getSettings: () => s, secrets: { get: (k) => (k === 'free.gemini' ? 'g' : null) }, mock: createMockProvider(), providerFactory: { openai: () => fakeFree().provider } });
  for (const route of [only.platform('heavy'), only.forCommission({ privacy: 'PUBLIC' }, 'light'), only.agent('claude-sonnet-5-5', { commission: { privacy: 'PUBLIC' } }), only.agent('free', { commission: { privacy: 'PUBLIC' } })]) {
    assert.equal(route.providerName, 'free');
    assert.equal(route.fallback, undefined, 'nothing falls back to Claude');
  }
  const logs = [];
  const res = await runAgent({ agent: ECHO, input: {}, route: only.platform('heavy'), log: (x) => logs.push(x) });
  assert.deepEqual(res.output, { ok: true });
  assert.equal(logs[0].provider, 'free:gemini');
  assert.equal(logs[0].shadowModel, 'claude-opus-5-5');
  const priv = only.forCommission({ privacy: 'RESTRICTED' }, 'heavy');
  await assert.rejects(runAgent({ agent: ECHO, input: {}, route: priv, log: () => {} }), /isn’t marked Public/);
  s.free = { ...free, privateToo: true };
  only.clearCache();
  assert.equal((await runAgent({ agent: ECHO, input: {}, route: only.forCommission({ privacy: 'RESTRICTED' }, 'heavy'), log: () => {} })).provider, 'free:gemini');
});

test('free models only waits out a per-minute limit instead of failing, and stops cleanly on a daily quota', async () => {
  let t = 0;
  let calls = 0;
  const flaky = { name: 'x', async complete(req) { calls++; if (calls === 1) throw new LlmError('429 too many requests per minute', { retryable: true, code: 'rate_limit', retryAfterMs: 20000 }); return { text: '{"ok":true}', model: req.model, usage: {} }; } };
  const waited = [];
  const chain = createFreeChain([{ id: 'g', label: 'Gemini', model: 'm', provider: flaky, maxOutput: 100 }], { now: () => t, patience: 180000, wait: async (ms) => { waited.push(ms); t += ms; } });
  const res = await chain.complete({ system: 's', messages: [], maxTokens: 64000 });
  assert.equal(res.freeProvider, 'g');
  assert.equal(waited.length, 1);
  assert.ok(waited[0] >= 60000, 'waited for the provider to come back');
  const daily = { name: 'x', async complete() { throw new LlmError('429 quota exceeded per day', { retryable: true, code: 'rate_limit' }); } };
  const done = createFreeChain([{ id: 'd', label: 'Gemini', model: 'm', provider: daily }], { now: () => t, patience: 180000, wait: async () => { throw new Error('should not wait an hour'); } });
  await assert.rejects(done.complete({ system: 's', messages: [] }), (/** @type {any} */ e) => e.code === 'free_quota' && !e.retryable && /daily quota/.test(e.message));
});

test('reply length is capped at each free provider’s maximum', async () => {
  const seen = [];
  const p = { name: 'x', async complete(req) { seen.push(req.maxTokens); return { text: '{}', model: 'm', usage: {} }; } };
  await createFreeChain([{ id: 'q', label: 'Groq', model: 'm', provider: p, maxOutput: 32768 }]).complete({ system: 's', messages: [], maxTokens: 64000 });
  assert.deepEqual(seen, [32768]);
});

test('a free model the provider retired is replaced by the best one it still serves, and the choice is kept', async () => {
  const { pickReplacement } = await import('../../src/llm/free-chain.js');
  const names = ['gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.8-flash-preview-tts', 'text-embedding-004', 'gemini-2.5-pro'];
  assert.equal(pickReplacement(names, 'gemini-2.5-flash'), 'gemini-3.8-flash');
  assert.equal(pickReplacement([...names, 'gemini-flash-latest'], 'gemini-2.5-flash'), 'gemini-flash-latest');
  const asked = [];
  const p = {
    name: 'x',
    async complete(req) { asked.push(req.model); if (req.model === 'gemini-2.5-flash') throw new LlmError('answered 404: model models/gemini-2.5-flash is no longer available to new users', { retryable: false, code: 'http_404' }); return { text: '{"ok":true}', model: req.model, usage: {} }; },
    async models() { return names; },
  };
  const saved = [];
  const chain = createFreeChain([{ id: 'gemini', label: 'Gemini', model: 'gemini-2.5-flash', provider: p }], { onModelChange: (id, m) => saved.push([id, m]) });
  const res = await chain.complete({ system: 's', messages: [] });
  assert.equal(res.model, 'gemini-3.8-flash');
  assert.deepEqual(asked, ['gemini-2.5-flash', 'gemini-3.8-flash']);
  assert.deepEqual(saved, [['gemini', 'gemini-3.8-flash']]);
});

test('a free call gets room to think: a tiny allowance is raised, and a reply cut off at its length limit is asked again with more room', async () => {
  const seen = [];
  const thinker = {
    name: 'x',
    async complete(req) {
      seen.push(req.maxTokens);
      // A thinking model that needs more than 8,192 tokens of room before it writes its answer.
      if (req.maxTokens < 20000) throw new LlmError('The reply from gemini-flash-latest was cut off at its length limit.', { retryable: true, code: 'max_tokens' });
      return { text: 'OK', model: req.model, usage: {} };
    },
  };
  const res = await createFreeChain([{ id: 'gemini', label: 'Gemini', model: 'gemini-flash-latest', provider: thinker, maxOutput: 65536 }]).complete({ system: 's', messages: [], maxTokens: 20 });
  assert.equal(res.text, 'OK');
  assert.deepEqual(seen, [8192, 32768], 'a 20-token connection test gets 8,192, then four times that');
});

test('an overloaded free model hands the call to the provider’s lighter model, and free-only mode waits out a busy spell', async () => {
  const asked = [];
  let busy = true;
  const gemini = {
    name: 'x',
    async complete(req) {
      asked.push(req.model);
      if (req.model === 'gemini-flash-latest' && busy) throw new LlmError('503: The model is currently experiencing high demand.', { retryable: true, code: 'overloaded' });
      return { text: 'OK', model: req.model, usage: {} };
    },
  };
  const entry = () => ({ id: 'gemini', label: 'Gemini', model: 'gemini-flash-latest', backups: ['gemini-flash-lite-latest'], provider: gemini });
  const res = await createFreeChain([entry()]).complete({ system: 's', messages: [] });
  assert.equal(res.model, 'gemini-flash-lite-latest');
  assert.deepEqual(asked, ['gemini-flash-latest', 'gemini-flash-lite-latest']);
  // No lighter model, or it is busy too: free-only mode rests the provider for a few seconds and asks again.
  let t = 0;
  const waits = [];
  asked.length = 0;
  const later = createFreeChain([{ ...entry(), backups: [] }], { now: () => t, patience: 180000, wait: async (ms) => { waits.push(ms); t += ms; busy = false; } });
  assert.equal((await later.complete({ system: 's', messages: [] })).model, 'gemini-flash-latest');
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 20000 && waits[0] < 60000);
});
