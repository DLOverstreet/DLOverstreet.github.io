// List prices per million tokens, used for the admin cost view, and what each model supports.
// Check https://docs.claude.com/en/docs/about-claude/pricing when models change.
//   cacheRead: price of input read from the prompt cache; cacheMin: shortest prefix that caches
//   effort: accepts output_config.effort
//   webTools: takes the dynamic-filtering web search and fetch tools (4.6 and later)
//   fallbacks: takes the server-side refusal fallback (fallbacks: "default")
//   tps: rough output tokens per second (thinking included), for time estimates until the
//        swarm has timed the model on this browser's own runs
export const MODEL_PRICES = Object.freeze({
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheMin: 512, label: 'Claude Opus 5.5', effort: true, webTools: true, fallbacks: true, tps: 55 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheMin: 512, label: 'Claude Sonnet 5.5', effort: true, webTools: true, fallbacks: true, tps: 75 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1, cacheMin: 4096, label: 'Claude Haiku 4.5', effort: false, webTools: false, fallbacks: false, tps: 120 },
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25, cacheMin: 512, label: 'Claude Fable 5.1 (most capable)', effort: true, webTools: true, fallbacks: true, tps: 40 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, cacheMin: 512, label: 'Claude Opus 5 (previous)', effort: true, webTools: true, fallbacks: true, tps: 50 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, cacheMin: 1024, label: 'Claude Sonnet 5 (previous)', effort: true, webTools: true, fallbacks: false, tps: 70 },
});

export const ANTHROPIC_MODELS = Object.keys(MODEL_PRICES);

/** Web search is billed per search on top of tokens; web fetch costs only its tokens. */
export const WEB_SEARCH_USD = 10 / 1000;

/** Writing a prompt-cache entry costs this much more than plain input: five-minute and hour-long lifetimes. */
export const CACHE_WRITE = 1.25;
export const CACHE_WRITE_1H = 2;

/** @param {string} model */
export function modelCaps(model) {
  return MODEL_PRICES[model] || { effort: false, webTools: false, fallbacks: false };
}

function costAt(p, run) {
  if (!p) return 0;
  const hour = run.tokensCacheWrite1h || 0;
  const cached = ((run.tokensCacheWrite || 0) - hour) * p.in * CACHE_WRITE + hour * p.in * CACHE_WRITE_1H + (run.tokensCacheRead || 0) * (p.cacheRead ?? p.in * 0.1);
  return ((run.tokensIn || 0) * p.in + cached + (run.tokensOut || 0) * p.out) / 1e6 + (run.webSearches || 0) * WEB_SEARCH_USD;
}

/** Dollars for a run. tokensIn is uncached input; cache writes and reads are priced apart. Mock runs cost nothing. */
export function runCostUsd(run) {
  return costAt(MODEL_PRICES[run.model], run);
}

/** What a mock run would have cost at the model it stands in for. */
export function shadowCostUsd(run) {
  return costAt(MODEL_PRICES[run.shadowModel || run.model], run);
}

export function estimateTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}
