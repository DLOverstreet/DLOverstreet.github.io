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
    label: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', maxOutput: 65536,
    keyHint: 'A Google AI Studio key (aistudio.google.com/apikey).', limits: 'About 10 requests a minute and 250 a day on Flash (Flash-Lite: 15 and 1,000).',
    privacy: 'Google may use free-tier prompts and replies to improve its products, and people may review them.', local: false,
  },
  groq: {
    label: 'Groq (free tier)', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', maxOutput: 32768,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The least reply room a free call gets. Free models think before they answer, and the thinking counts
 * against max_tokens, so a small allowance (a 20-token connection test, a short note) is used up
 * before any text comes back. Free tokens cost nothing, so every call gets at least this much.
 */
export const MIN_FREE_TOKENS = 8192;

/** The reply allowance for a free call: at least MIN_FREE_TOKENS, at most the provider's ceiling. */
export function freeBudget(asked, cap) {
  const want = Math.max(asked || 0, MIN_FREE_TOKENS);
  return cap ? Math.min(want, cap) : want;
}

/** A "model not found / no longer available" answer: the provider retired the model (or never had it). */
const GONE = /\b404\b|not[ _-]?found|no longer available|does not exist|unknown model|not supported for generateContent/i;

/**
 * The best stand-in from a provider's model list for a model it no longer serves: a text model of the
 * same family (Flash before Flash-Lite, newest version first), never image, audio, embedding or live models.
 * @param {string[]} names @param {string} gone
 */
export function pickReplacement(names, gone = '') {
  const text = names.filter((n) => n !== gone && !/image|tts|audio|live|embed|vision|imagen|veo|aqa|learnlm|gemma|robotics|computer|native/i.test(n));
  const version = (n) => Number((/(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
  const family = /flash/i.test(gone) ? text.filter((n) => /flash/i.test(n)) : text;
  const pool = (family.length ? family : text).filter((n) => !/preview|exp/i.test(n));
  const ranked = (pool.length ? pool : family.length ? family : text).sort((a, b) => (/latest/.test(b) ? 1 : 0) - (/latest/.test(a) ? 1 : 0) || (/lite/i.test(a) ? 1 : 0) - (/lite/i.test(b) ? 1 : 0) || version(b) - version(a) || a.localeCompare(b));
  return ranked[0] || null;
}

/**
 * @param {{ id: string, label: string, provider: { complete: (req: any) => Promise<any> }, model: string, maxOutput?: number|null }[]} entries in the order to try
 * @param {{ now?: () => number, cooldown?: Map<string, number>, patience?: number, wait?: (ms: number) => Promise<void>, onModelChange?: (id: string, model: string) => void }} [opts]
 *   cooldown: shared across chains, provider id → time it may be tried again. patience: how long to
 *   wait for a provider resting after a per-minute limit before giving up (free-only mode waits;
 *   free-first gives up at once, since Claude is there to take the call)
 */
export function createFreeChain(entries, { now = () => Date.now(), cooldown = new Map(), patience = 0, wait = sleep, onModelChange = () => {} } = {}) {
  /** A provider whose model was retired: ask it which models it has, switch to the best one, and remember it. */
  async function replace(e) {
    if (e.replaced || typeof e.provider.models !== 'function') return false;
    e.replaced = true;
    let names;
    try { names = await e.provider.models(); } catch { return false; }
    const next = pickReplacement(names, e.model);
    if (!next) return false;
    e.model = next;
    onModelChange(e.id, next);
    return true;
  }
  /**
   * One provider, one call: enough room to think and answer (never past the provider's ceiling), and a
   * reply cut off at its length limit is asked once more with four times the room.
   */
  async function ask(e, req) {
    const cap = e.maxOutput || 65536;
    let maxTokens = freeBudget(req.maxTokens, cap);
    for (let tries = 0; ; tries++) {
      try {
        const res = await e.provider.complete({ ...req, model: e.model, maxTokens });
        return { ...res, model: res.model || e.model, freeProvider: e.id };
      } catch (err) {
        if (!(err instanceof LlmError) || err.code !== 'max_tokens' || tries >= 1 || maxTokens >= cap) throw err;
        maxTokens = Math.min(cap, maxTokens * 4);
      }
    }
  }
  return {
    name: 'free',
    async complete(req) {
      const deadline = now() + patience;
      for (;;) {
        const tried = [];
        for (const e of entries) {
          if ((cooldown.get(e.id) || 0) > now()) { tried.push(`${e.label}: resting after its limit`); continue; }
          try {
            return await ask(e, req);
          } catch (err) {
            const msg = String(err?.message || err);
            // The model was retired: switch to one the provider still serves and try again.
            if (GONE.test(msg) && await replace(e)) {
              try {
                return await ask(e, req);
              } catch (err2) {
                tried.push(`${e.label} (${e.model}): ${String(err2?.message || err2).slice(0, 160)}`);
                continue;
              }
            }
            tried.push(`${e.label}: ${msg.slice(0, 160)}`);
            // Out of requests: rest the provider (a daily quota for an hour, a per-minute limit for as long as it asks).
            if (err instanceof LlmError && (err.code === 'rate_limit' || err.code === 'http_429')) {
              cooldown.set(e.id, now() + (QUOTA.test(msg) ? 60 * 60 * 1000 : Math.max(err.retryAfterMs || 0, 60 * 1000)));
            }
          }
        }
        // A provider back within our patience (a per-minute limit): wait for it rather than fail.
        const back = Math.min(...entries.map((e) => cooldown.get(e.id) || Infinity));
        if (patience && Number.isFinite(back) && back > now() && back <= deadline) {
          await wait(back - now() + 250);
          continue;
        }
        if (req.onStart) req.onStart();
        const resting = entries.length && entries.every((e) => (cooldown.get(e.id) || 0) > deadline);
        throw new LlmError(resting
          ? `Every free model is out of requests for now (daily quota); try again later or add another provider (${tried.join('; ')}).`
          : `No free model could answer (${tried.join('; ') || 'none set up'}).`, { retryable: !resting, code: resting ? 'free_quota' : 'free_exhausted' });
      }
    },
  };
}
