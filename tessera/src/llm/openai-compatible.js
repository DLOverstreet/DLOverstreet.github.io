// Any OpenAI-compatible chat endpoint: Ollama on the contributor's own machine
// (http://localhost:11434/v1), the free tiers of Gemini, Groq and OpenRouter (tried before Claude,
// see free-chain.js), or a self-hosted gateway. It is never used to call Claude.
import { LlmError } from './errors.js';
import { contentText } from '../lib/util.js';

/** Seconds from a Retry-After header, as milliseconds (capped at five minutes). */
function retryAfter(res) {
  const n = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(n) && n > 0 ? Math.min(300, n) * 1000 : null;
}

export function createOpenAiCompatibleProvider({ baseUrl, apiKey = '', fetchImpl = globalThis.fetch }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  const unreachable = () => {
    const local = /localhost|127\.0\.0\.1/.test(root);
    return new LlmError(local
      ? `Could not reach ${root}. Is Ollama running, and is OLLAMA_ORIGINS set to allow this site?`
      : `Could not reach ${root} from this browser.`, { retryable: true, code: 'connection' });
  };
  return {
    name: 'openai-compatible',
    async complete(req) {
      // No prompt cache to warm here, so anything waiting on this call's start can go now.
      if (req.onStart) req.onStart();
      /** @type {Record<string, any>} */
      const body = {
        model: req.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: contentText(m.content) }))],
        stream: false,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      };
      if (req.jsonSchema) body.response_format = { type: 'json_object' };
      let res;
      try {
        res = await fetchImpl(`${root}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch {
        throw unreachable();
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const msg = `${root} answered ${res.status}: ${detail.slice(0, 300)}`;
        if (res.status === 429) throw new LlmError(msg, { retryable: true, code: 'rate_limit', retryAfterMs: retryAfter(res) });
        if (res.status === 401 || res.status === 403) throw new LlmError(`${root} rejected the key (${res.status}).`, { retryable: false, code: 'auth' });
        throw new LlmError(msg, { retryable: res.status >= 500, code: `http_${res.status}` });
      }
      const json = await res.json();
      const choice = json.choices?.[0] || {};
      const text = choice.message?.content ?? '';
      const usage = { inputTokens: json.usage?.prompt_tokens || 0, outputTokens: json.usage?.completion_tokens || 0 };
      if (choice.finish_reason === 'length') throw new LlmError(`The reply from ${req.model} was cut off at its length limit.`, { retryable: true, code: 'max_tokens', usage, model: json.model || req.model });
      return { text, model: json.model || req.model, usage };
    },
    /** The models this endpoint offers (for Settings to list). */
    async models() {
      let res;
      try {
        res = await fetchImpl(`${root}/models`, { headers });
      } catch {
        throw unreachable();
      }
      if (!res.ok) throw new LlmError(`${root} answered ${res.status} when asked for its models.`, { retryable: false, code: `http_${res.status}` });
      const json = await res.json();
      return (json.data || json.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
    },
  };
}
