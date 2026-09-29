// Claude through the official Anthropic SDK. In the browser the SDK is loaded from the
// vendored bundle only when this provider is used, and the key is sent straight to
// api.anthropic.com (the SDK adds the direct-browser-access header).
//
// A request can carry Anthropic's server tools (web search and web fetch): they run on
// Anthropic's servers inside the same call, a long turn that pauses (stop_reason
// "pause_turn") is resumed here, and the sources the model read or cited come back with
// the text. Models that support it get effort and the server-side refusal fallback.
import { LlmError } from './errors.js';
import { modelCaps } from './prices.js';

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = typeof window === 'undefined'
      ? import('@anthropic-ai/sdk')
      : import('../../vendor/anthropic-sdk.js');
  }
  return sdkPromise;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Text blocks marked `cache` get a prompt-cache breakpoint: five minutes by default, an hour for
 * `cache: '1h'` (hour-long entries must come before five-minute ones). Strings pass through.
 */
export function apiMessages(messages) {
  return messages.map((m) => (typeof m.content === 'string' ? m : {
    role: m.role,
    content: m.content.map((b) => ({ type: 'text', text: b.text, ...(b.cache ? { cache_control: b.cache === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } } : {}) })),
  }));
}
const MAX_CONTINUATIONS = 5;

/** Sources from a response: what the model cited first, then pages it fetched, then search results it saw. */
export function sourcesOf(content) {
  const cited = [];
  const fetched = [];
  const seen = [];
  for (const b of content || []) {
    if (b.type === 'text') {
      for (const c of b.citations || []) if (c.url) cited.push({ url: c.url, title: c.title || '', quote: c.cited_text || '', kind: 'cited' });
    } else if (b.type === 'web_fetch_tool_result' && b.content?.type === 'web_fetch_result') {
      fetched.push({ url: b.content.url, title: b.content.content?.title || '', retrievedAt: b.content.retrieved_at || null, kind: 'fetched' });
    } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) seen.push({ url: r.url, title: r.title || '', pageAge: r.page_age || null, kind: 'searched' });
    }
  }
  const out = [];
  const urls = new Set();
  for (const s of [...cited, ...fetched, ...seen]) {
    if (urls.has(s.url)) continue;
    urls.add(s.url);
    out.push(s);
  }
  return out;
}

/** @param {{ apiKey?: string, baseURL?: string, fetch?: typeof fetch }} [opts] */
export function createAnthropicProvider({ apiKey, baseURL, fetch: fetchImpl } = {}) {
  let client = null;
  let Anthropic = null;
  let fallbacksOff = false;
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
    if (e instanceof Anthropic.BadRequestError) {
      // An organization can switch the web tools off in the Claude Console.
      if (/web[ _-]?(search|fetch)/i.test(e.message || '')) return new LlmError(`Web access isn't available for this key: ${e.message}`, { retryable: false, code: 'web_disabled' });
      return new LlmError(`Request rejected: ${e.message}`, { retryable: false, code: 'bad_request' });
    }
    if (e instanceof Anthropic.APIConnectionError) return new LlmError('Could not reach api.anthropic.com from this browser.', { retryable: true, code: 'connection' });
    if (e instanceof Anthropic.APIError) return new LlmError(`Anthropic API error ${e.status ?? ''}: ${e.message}`, { retryable: true, code: 'api' });
    return new LlmError(e.message || String(e));
  }

  /**
   * One request, falling back to a plainer one if the API rejects an optional feature. With
   * `onStart`, the request streams and onStart fires on its first event: the prompt is read and
   * any cache entry it writes can be read by requests sent from then on.
   */
  async function send(c, params, onStart = null) {
    const caps = modelCaps(params.model);
    const withFallback = caps.fallbacks && !fallbacksOff;
    const call = (p, fb) => {
      const body = fb ? { ...p, betas: [FALLBACK_BETA], fallbacks: 'default' } : p;
      if (!onStart) return fb ? c.beta.messages.create(body) : c.messages.create(body);
      const stream = fb ? c.beta.messages.stream(body) : c.messages.stream(body);
      let started = false;
      stream.on('streamEvent', () => { if (!started) { started = true; onStart(); } });
      return stream.finalMessage();
    };
    try {
      return await call(params, withFallback);
    } catch (e) {
      const err = mapError(e);
      if (err.code !== 'bad_request') throw err;
      // Drop the optional parts one at a time: the fallback beta, then structured output and effort.
      if (withFallback && /fallback|beta/i.test(err.message)) {
        fallbacksOff = true;
        try { return await call(params, false); } catch (e2) { throw mapError(e2); }
      }
      if (params.output_config) {
        const { output_config: _, ...rest } = params;
        try { return await call(rest, withFallback && !fallbacksOff); } catch (e2) { throw mapError(e2); }
      }
      throw err;
    }
  }

  return {
    name: 'anthropic',
    /**
     * @param {{model: string, system: string, messages: any[], jsonSchema?: object, maxTokens?: number, tools?: any[], effort?: string, onStart?: () => void}} req
     *   messages: content is a string, or text blocks ({ type: 'text', text, cache? }) where `cache` marks a prompt-cache breakpoint
     */
    async complete(req) {
      const c = await getClient();
      const caps = modelCaps(req.model);
      const tools = req.tools && req.tools.length ? req.tools : null;
      /** @type {any} */
      const messages = apiMessages(req.messages);
      const params = { model: req.model, max_tokens: req.maxTokens || 16000, system: req.system, messages };
      const outputConfig = {};
      // Structured output is left off when tools run: web search always cites, and citations
      // can't be combined with a JSON format. Those replies are parsed from the text instead.
      if (req.jsonSchema && !tools) outputConfig.format = { type: 'json_schema', schema: req.jsonSchema };
      if (req.effort && caps.effort) outputConfig.effort = req.effort;
      if (Object.keys(outputConfig).length) params.output_config = outputConfig;
      if (tools) params.tools = tools;

      const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, webSearches: 0, webFetches: 0 };
      let turn = [];
      let res;
      for (let hop = 0; ; hop++) {
        res = await send(c, turn.length ? { ...params, messages: [...messages, { role: 'assistant', content: turn }] } : params, hop === 0 ? req.onStart || null : null);
        usage.inputTokens += res.usage?.input_tokens || 0;
        usage.outputTokens += res.usage?.output_tokens || 0;
        usage.cacheWriteTokens += res.usage?.cache_creation_input_tokens || 0;
        usage.cacheWrite1hTokens += res.usage?.cache_creation?.ephemeral_1h_input_tokens || 0;
        usage.cacheReadTokens += res.usage?.cache_read_input_tokens || 0;
        usage.webSearches += res.usage?.server_tool_use?.web_search_requests || 0;
        usage.webFetches += res.usage?.server_tool_use?.web_fetch_requests || 0;
        turn = [...turn, ...res.content];
        // A long server-tool turn pauses; sending it back unchanged resumes it.
        if (res.stop_reason !== 'pause_turn' || hop >= MAX_CONTINUATIONS) break;
      }
      if (res.stop_reason === 'refusal') {
        throw new LlmError(`The model declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`, { retryable: false, code: 'refusal' });
      }
      if (res.stop_reason === 'max_tokens') throw new LlmError('The response hit max_tokens before finishing.', { retryable: true, code: 'max_tokens' });
      if (res.stop_reason === 'pause_turn') throw new LlmError('The web research turn kept pausing and was stopped.', { retryable: true, code: 'pause_turn' });
      const text = turn.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { text, model: res.model || req.model, usage, sources: tools ? sourcesOf(turn) : [] };
    },
  };
}
