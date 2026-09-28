// Decides which provider and model each call uses.
//  - Platform agents (Scoping, Decomposer, Matcher, Reviewer, Assembler) use the platform
//    setting: the mock by default, or Claude / an OpenAI-compatible endpoint with a key
//    stored in this browser.
//  - The Translator and copilot use the contributor's own model (their key, or Ollama),
//    falling back to the shared platform model.
//  - The agent swarm uses the platform model through its own, larger rate-limit pool, and
//    so do the Reviewer and Assembler on jobs handed to the swarm.
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import { rateLimitCheck } from '../domain/limits.js';
import { config } from '../domain/config.js';
import { LlmError } from './errors.js';

/** @param {{ getSettings: () => any, secrets: any, mock: any, now?: () => number, providerFactory?: { anthropic?: Function, openai?: Function } }} opts */
export function createLlmRouter({ getSettings, secrets, mock, now = () => Date.now(), providerFactory = {} }) {
  const makeAnthropic = providerFactory.anthropic || createAnthropicProvider;
  const makeOpenAi = providerFactory.openai || createOpenAiCompatibleProvider;
  const calls = new Map();
  const cache = new Map();

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
   * @param {{ pool?: 'platform'|'swarm', model?: string|null }} [opts] model: a specific Claude model instead of the tier's
   */
  function platform(tier = 'heavy', { pool = 'platform', model = null } = {}) {
    const s = getSettings();
    const shadow = model || (tier === 'heavy' ? s.heavyModel : s.lightModel);
    const max = pool === 'swarm' ? config.limits.swarmCallsPerWindow : config.limits.llmCallsPerWindow;
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
      return { ...platform('heavy'), fallback: 'No personal key is saved in this browser, so the shared model is used.' };
    }
    if (mode === 'OLLAMA') {
      const url = llm.ollamaUrl || 'http://localhost:11434/v1';
      const model = llm.ollamaModel || 'llama3.1';
      const p = cached(`ollama:${url}`, () => makeOpenAi({ baseUrl: url }));
      return { provider: p, model, providerName: 'openai-compatible', label: `${model} on Ollama`, own: true };
    }
    return platform('heavy');
  }

  /** The route for work on a commission: swarm jobs draw on the swarm's pool. @param {any} commission @param {'heavy'|'light'} [tier] */
  function forCommission(commission, tier = 'heavy') {
    return platform(tier, { pool: commission?.workforce === 'agents' ? 'swarm' : 'platform' });
  }

  /** A swarm agent's route: the platform provider with the model Settings picked for agents. @param {string} model */
  function agent(model) {
    return platform('heavy', { pool: 'swarm', model });
  }

  return { platform, contributor, forCommission, agent, clearCache: () => cache.clear() };
}
