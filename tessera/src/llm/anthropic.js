// Claude through the official Anthropic SDK. In the browser the SDK is loaded from the
// vendored bundle only when this provider is used, and the key is sent straight to
// api.anthropic.com (the SDK adds the direct-browser-access header).
import { LlmError } from './errors.js';

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = typeof window === 'undefined'
      ? import('@anthropic-ai/sdk')
      : import('../../vendor/anthropic-sdk.js');
  }
  return sdkPromise;
}

/** @param {{ apiKey?: string, baseURL?: string, fetch?: typeof fetch }} [opts] */
export function createAnthropicProvider({ apiKey, baseURL, fetch: fetchImpl } = {}) {
  let client = null;
  let Anthropic = null;
  async function getClient() {
    if (!apiKey) throw new LlmError('No Anthropic API key is set.', { retryable: false, code: 'no_key' });
    if (!client) {
      const mod = await loadSdk();
      Anthropic = mod.default;
      client = new Anthropic({ apiKey, baseURL, dangerouslyAllowBrowser: true, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
    }
    return client;
  }

  function mapError(e) {
    if (!Anthropic) return new LlmError(e.message || String(e));
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return new LlmError('The Anthropic API key was rejected. Check it in settings.', { retryable: false, code: 'auth' });
    }
    if (e instanceof Anthropic.NotFoundError) return new LlmError(`Model not found: ${e.message}`, { retryable: false, code: 'not_found' });
    if (e instanceof Anthropic.RateLimitError) return new LlmError('Anthropic rate limit reached. Retrying later.', { retryable: true, code: 'rate_limit' });
    if (e instanceof Anthropic.BadRequestError) return new LlmError(`Request rejected: ${e.message}`, { retryable: false, code: 'bad_request' });
    if (e instanceof Anthropic.APIConnectionError) return new LlmError('Could not reach api.anthropic.com from this browser.', { retryable: true, code: 'connection' });
    if (e instanceof Anthropic.APIError) return new LlmError(`Anthropic API error ${e.status ?? ''}: ${e.message}`, { retryable: true, code: 'api' });
    return new LlmError(e.message || String(e));
  }

  return {
    name: 'anthropic',
    /**
     * @param {{model: string, system: string, messages: {role: string, content: string}[], jsonSchema?: object, maxTokens?: number}} req
     */
    async complete(req) {
      const c = await getClient();
      const params = {
        model: req.model,
        max_tokens: req.maxTokens || 16000,
        system: req.system,
        messages: req.messages,
      };
      if (req.jsonSchema) params.output_config = { format: { type: 'json_schema', schema: req.jsonSchema } };
      let res;
      try {
        res = await c.messages.create(params);
      } catch (e) {
        const err = mapError(e);
        // Some schemas or models may not support structured output; fall back to prompt-only JSON once.
        if (err.code === 'bad_request' && params.output_config) {
          delete params.output_config;
          try { res = await c.messages.create(params); } catch (e2) { throw mapError(e2); }
        } else throw err;
      }
      if (res.stop_reason === 'refusal') {
        throw new LlmError(`The model declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`, { retryable: false, code: 'refusal' });
      }
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (res.stop_reason === 'max_tokens') throw new LlmError('The response hit max_tokens before finishing.', { retryable: true, code: 'max_tokens' });
      return { text, model: res.model || req.model, usage: { inputTokens: res.usage?.input_tokens || 0, outputTokens: res.usage?.output_tokens || 0 } };
    },
  };
}
