// Any OpenAI-compatible chat endpoint: Ollama on the contributor's own machine
// (http://localhost:11434/v1), OpenRouter, or a self-hosted gateway. Used for contributors
// who bring a non-Claude model; it is never used to call Claude.
import { LlmError } from './errors.js';
import { contentText } from '../lib/util.js';

export function createOpenAiCompatibleProvider({ baseUrl, apiKey = '', fetchImpl = globalThis.fetch }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  return {
    name: 'openai-compatible',
    async complete(req) {
      const body = {
        model: req.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: contentText(m.content) }))],
        stream: false,
      };
      if (req.jsonSchema) body.response_format = { type: 'json_object' };
      let res;
      try {
        res = await fetchImpl(`${root}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(body),
        });
      } catch {
        const local = /localhost|127\.0\.0\.1/.test(root);
        throw new LlmError(local
          ? `Could not reach ${root}. Is Ollama running, and is OLLAMA_ORIGINS set to allow this site?`
          : `Could not reach ${root}.`, { retryable: true, code: 'connection' });
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new LlmError(`${root} answered ${res.status}: ${detail.slice(0, 200)}`, { retryable: res.status >= 500 || res.status === 429, code: `http_${res.status}` });
      }
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? '';
      return { text, model: json.model || req.model, usage: { inputTokens: json.usage?.prompt_tokens || 0, outputTokens: json.usage?.completion_tokens || 0 } };
    },
  };
}
