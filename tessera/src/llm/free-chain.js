// Free model providers tried before a paid Claude call: Google's Gemini free tier, Groq, OpenRouter's
// free models, or a model running on your own computer with Ollama. They all speak the
// OpenAI-compatible chat API. The chain tries each in order; one that hits its rate limit or daily
// quota is set aside for a while, and when none can answer, runAgent sends the call to Claude (the
// route's fallback). A reply that fails its schema goes to Claude the same way.

import { LlmError } from './errors.js';

/**
 * The providers Settings offer, with what their free tiers allow as of September 2026. Limits change;
 * the Settings page links each provider's own page. `local`: runs on your machine, so private jobs may
 * use it. The cloud free tiers may keep or learn from what you send (Google says its free tier does),
 * so only jobs marked Public go to them.
 */
export const FREE_PROVIDERS = Object.freeze({
  gemini: {
    label: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',
    keyHint: 'A Google AI Studio key (aistudio.google.com/apikey).', limits: 'About 10 requests a minute and 250 a day on Flash (Flash-Lite: 15 and 1,000).',
    privacy: 'Google may use free-tier prompts and replies to improve its products, and people may review them.', local: false,
  },
  groq: {
    label: 'Groq (free tier)', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b',
    keyHint: 'A Groq key (console.groq.com/keys).', limits: 'About 30 requests a minute and 1,000 a day per model, with small per-minute token limits: long prompts fall through to Claude.',
    privacy: 'Check Groq’s terms before sending anything confidential.', local: false,
  },
  openrouter: {
    label: 'OpenRouter free models', baseUrl: 'https://openrouter.ai/api/v1', model: '',
    keyHint: 'An OpenRouter key (openrouter.ai/keys). Pick a model whose id ends in :free.', limits: '50 free requests a day (1,000 once you have bought $10 of credits), 20 a minute.',
    privacy: 'Free models’ hosts may log prompts; check each model’s page.', local: false,
  },
  ollama: {
    label: 'Ollama on this computer', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1',
    keyHint: 'No key. Start Ollama with OLLAMA_ORIGINS set to this site’s address.', limits: 'No limits but your computer’s speed.',
    privacy: 'Nothing leaves your computer, so private jobs may use it too.', local: true,
  },
});

const QUOTA = /per[ -]?day|daily|RPD|quota|exhausted|limit: 0/i;

/**
 * @param {{ id: string, label: string, provider: { complete: (req: any) => Promise<any> }, model: string }[]} entries in the order to try
 * @param {{ now?: () => number, cooldown?: Map<string, number> }} [opts] cooldown: shared across chains, provider id → time it may be tried again
 */
export function createFreeChain(entries, { now = () => Date.now(), cooldown = new Map() } = {}) {
  return {
    name: 'free',
    async complete(req) {
      const tried = [];
      for (const e of entries) {
        if ((cooldown.get(e.id) || 0) > now()) { tried.push(`${e.label}: resting after its limit`); continue; }
        try {
          const res = await e.provider.complete({ ...req, model: e.model });
          return { ...res, model: res.model || e.model, freeProvider: e.id };
        } catch (err) {
          const msg = String(err?.message || err);
          tried.push(`${e.label}: ${msg.slice(0, 160)}`);
          // Out of requests: rest the provider (a daily quota for an hour, a per-minute limit for as long as it asks).
          if (err instanceof LlmError && (err.code === 'rate_limit' || err.code === 'http_429')) {
            cooldown.set(e.id, now() + (QUOTA.test(msg) ? 60 * 60 * 1000 : Math.max(err.retryAfterMs || 0, 60 * 1000)));
          }
        }
      }
      if (req.onStart) req.onStart();
      throw new LlmError(`No free model could answer (${tried.join('; ') || 'none set up'}).`, { retryable: true, code: 'free_exhausted' });
    },
  };
}
