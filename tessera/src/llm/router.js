// Decides which provider and model each call uses.
//  - Platform agents (Scoping, Decomposer, Matcher, Reviewer, Assembler) use the platform
//    setting: the mock by default, or Claude / an OpenAI-compatible endpoint with a key
//    stored in this browser.
//  - The Translator and copilot use the contributor's own model (their key, or Ollama),
//    falling back to the shared platform model.
//  - The agent swarm uses the platform model through its own, larger rate-limit pool, and
//    so do the Reviewer and Assembler on jobs handed to the swarm.
//  - With free providers set up (Settings), light work and the swarm's free-model challenger try
//    them first and fall back to Claude: jobs marked Public only, unless the provider runs locally.
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import { createFreeChain, FREE_PROVIDERS } from './free-chain.js';
import { rateLimitCheck } from '../domain/limits.js';
import { config } from '../domain/config.js';
import { LlmError } from './errors.js';

/** @param {{ getSettings: () => any, secrets: any, mock: any, now?: () => number, providerFactory?: { anthropic?: Function, openai?: Function } }} opts */
export function createLlmRouter({ getSettings, secrets, mock, now = () => Date.now(), providerFactory = {} }) {
  const makeAnthropic = providerFactory.anthropic || createAnthropicProvider;
  const makeOpenAi = providerFactory.openai || createOpenAiCompatibleProvider;
  const calls = new Map();
  const cache = new Map();
  const cooldown = new Map();

  function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  /** @param {any} provider @param {string} actorKey @param {number} [max] */
  function limited(provider, actorKey, max = config.limits.llmCallsPerWindow) {
    if (provider.name === 'mock') return provider;
    return {
      name: provider.name,
      async complete(req) {
        const list = calls.get(actorKey) || [];
        const check = rateLimitCheck(list, max, config.limits.llmWindowMs, now());
        if (!check.ok) throw new LlmError(check.message, { retryable: false, code: 'rate_limited' });
        list.push(now());
        calls.set(actorKey, list.filter((t) => now() - t < config.limits.llmWindowMs));
        return provider.complete(req);
      },
    };
  }

  /**
   * @param {'heavy'|'light'} [tier]
   * @param {{ pool?: 'platform'|'swarm', model?: string|null, commission?: any }} [opts] model: a specific Claude model instead of the tier's; commission: the job (free-only mode checks its privacy)
   */
  function platform(tier = 'heavy', { pool = 'platform', model = null, commission = null } = {}) {
    const s = getSettings();
    const shadow = model || (tier === 'heavy' ? s.heavyModel : s.lightModel);
    const max = pool === 'swarm' ? config.limits.swarmCallsPerWindow : config.limits.llmCallsPerWindow;
    if (s.provider === 'free') return freeOnly(commission, shadow);
    if (s.provider === 'anthropic') {
      const key = secrets.get('platform.anthropic');
      if (key) {
        const p = cached(`anthropic:${key}`, () => makeAnthropic({ apiKey: key }));
        return { provider: limited(p, pool, max), model: shadow, providerName: 'anthropic', label: shadow };
      }
    }
    if (s.provider === 'openai' && s.openai?.baseUrl) {
      const key = secrets.get('platform.openai') || '';
      const p = cached(`openai:${s.openai.baseUrl}:${key}`, () => makeOpenAi({ baseUrl: s.openai.baseUrl, apiKey: key }));
      return { provider: limited(p, pool, max), model: s.openai.model, providerName: 'openai-compatible', label: s.openai.model };
    }
    return { provider: mock, model: `mock-${tier}`, providerName: 'mock', shadowModel: shadow, label: `Mock (${model ? shadow : tier})` };
  }

  /** The contributor's own model, with the shared model as fallback. */
  function contributor(user, profile) {
    const llm = profile?.llm || {};
    const mode = profile?.llmMode || 'SHARED';
    if (mode === 'OWN_KEY') {
      const prov = llm.provider || 'anthropic';
      const key = secrets.get(`user.${user.id}.${prov}`);
      if (key && prov === 'anthropic') {
        const model = llm.model || config.llm.contributorModel;
        const p = cached(`anthropic:${key}`, () => makeAnthropic({ apiKey: key }));
        return { provider: limited(p, user.id), model, providerName: 'anthropic', label: `${model} (your key)`, own: true };
      }
      if (key && prov === 'openai' && llm.baseUrl) {
        const p = cached(`openai:${llm.baseUrl}:${key}`, () => makeOpenAi({ baseUrl: llm.baseUrl, apiKey: key }));
        return { provider: limited(p, user.id), model: llm.model, providerName: 'openai-compatible', label: `${llm.model} (your key)`, own: true };
      }
      return { ...platform('heavy'), note: 'No personal key is saved in this browser, so the shared model is used.' };
    }
    if (mode === 'OLLAMA') {
      const url = llm.ollamaUrl || 'http://localhost:11434/v1';
      const model = llm.ollamaModel || 'llama3.1';
      const p = cached(`ollama:${url}`, () => makeOpenAi({ baseUrl: url }));
      return { provider: p, model, providerName: 'openai-compatible', label: `${model} on Ollama`, own: true };
    }
    return platform('heavy');
  }

  /**
   * The free providers a job may use, in the order Settings list them: every one that is switched
   * on, has a model (and a key, unless it runs locally), and may see this job (cloud free tiers only
   * for jobs marked Public).
   * @param {any} commission
   */
  function freeEntries(commission, { privateToo = false } = {}) {
    const f = getSettings().free;
    if (!f?.providers?.length) return [];
    const open = privateToo || !commission || (commission.privacy || 'PUBLIC') === 'PUBLIC';
    const out = [];
    for (const p of f.providers) {
      const def = FREE_PROVIDERS[p.id];
      if (!p.on || !def || !p.model) continue;
      if (!def.local && !open) continue;
      const key = secrets.get(`free.${p.id}`) || '';
      if (!def.local && !key) continue;
      const baseUrl = p.baseUrl || def.baseUrl;
      out.push({ id: p.id, label: def.label, model: p.model, maxOutput: def.maxOutput || null, provider: cached(`free:${p.id}:${baseUrl}:${key}`, () => makeOpenAi({ baseUrl, apiKey: key })) });
    }
    return out;
  }

  /**
   * A route that tries the free providers first and falls back to `paid` (runAgent switches to
   * route.fallback after a free attempt fails). Without usable free providers, `paid` itself.
   * @param {any} commission @param {any} paid
   */
  function freeFirst(commission, paid) {
    const entries = freeEntries(commission);
    if (!entries.length) return paid;
    const label = entries.length > 1 ? `${entries[0].model} (free, then ${entries.slice(1).map((e) => e.model).join(', ')})` : `${entries[0].model} (free)`;
    return {
      provider: createFreeChain(entries, { now, cooldown }), model: entries[0].model, providerName: 'free', label: `${label}, then ${paid.label}`,
      shadowModel: paid.shadowModel || paid.model, fallback: paid, free: true,
    };
  }

  /**
   * Free models only (the platform provider "free"): every agent, planning and supervision included,
   * runs on the free providers with no paid fallback. A provider resting after a per-minute limit is
   * waited for (up to three minutes a call). Private jobs use them only when Settings allow it.
   * @param {any} commission @param {string} shadow the Claude model this call stands in for (for the savings view)
   */
  function freeOnly(commission, shadow) {
    const entries = freeEntries(commission, { privateToo: !!getSettings().free?.privateToo });
    if (!entries.length) {
      const why = freeEntries(null).length ? 'This job isn’t marked Public, and Settings don’t allow private jobs on the free cloud models (or use Ollama).' : 'No free model is set up: in Settings, switch on a provider and give it a model and a key.';
      return { provider: { name: 'free', async complete() { throw new LlmError(why, { retryable: false, code: 'no_key' }); } }, model: 'free', providerName: 'free', label: 'Free models (none ready)', shadowModel: shadow, free: true };
    }
    const label = entries.length > 1 ? `${entries[0].model} (free, then ${entries.slice(1).map((e) => e.model).join(', ')})` : `${entries[0].model} (free)`;
    return { provider: createFreeChain(entries, { now, cooldown, patience: 3 * 60 * 1000 }), model: entries[0].model, providerName: 'free', label, shadowModel: shadow, free: true };
  }

  /** The route for work on a commission: swarm jobs draw on the swarm's pool; light work tries free models first when Settings say so. @param {any} commission @param {'heavy'|'light'} [tier] */
  function forCommission(commission, tier = 'heavy') {
    const paid = platform(tier, { pool: commission?.workforce === 'agents' ? 'swarm' : 'platform', commission });
    return tier === 'light' && getSettings().free?.light && !paid.free ? freeFirst(commission, paid) : paid;
  }

  /**
   * A swarm agent's route: the platform provider with the model Settings picked for agents. The model
   * 'free' is the free providers, falling back to `fallbackModel` on Claude.
   * @param {string} model @param {{ commission?: any, fallbackModel?: string }} [opts]
   */
  function agent(model, { commission = null, fallbackModel = null } = {}) {
    if (model === 'free') {
      const paid = platform('heavy', { pool: 'swarm', model: fallbackModel, commission });
      return paid.free ? paid : freeFirst(commission, paid);
    }
    return platform('heavy', { pool: 'swarm', model, commission });
  }

  /** Whether any free provider is ready for a job (for Settings and the swarm view). */
  function freeReady(commission = null) {
    return freeEntries(commission, { privateToo: getSettings().provider === 'free' && !!getSettings().free?.privateToo }).length > 0;
  }

  return { platform, contributor, forCommission, agent, freeFirst, freeReady, clearCache: () => cache.clear() };
}
