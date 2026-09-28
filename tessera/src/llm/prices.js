// List prices per million tokens, used for the admin cost view, and what each model supports.
// Check https://docs.claude.com/en/docs/about-claude/pricing when models change.
//   effort: accepts output_config.effort
//   webTools: takes the dynamic-filtering web search and fetch tools (4.6 and later)
//   fallbacks: takes the server-side refusal fallback (fallbacks: "default")
export const MODEL_PRICES = Object.freeze({
  'claude-opus-5-5': { in: 4, out: 20, label: 'Claude Opus 5.5', effort: true, webTools: true, fallbacks: true },
  'claude-sonnet-5-5': { in: 2, out: 10, label: 'Claude Sonnet 5.5', effort: true, webTools: true, fallbacks: true },
  'claude-haiku-4-5': { in: 1, out: 5, label: 'Claude Haiku 4.5', effort: false, webTools: false, fallbacks: false },
  'claude-fable-5-1': { in: 10, out: 50, label: 'Claude Fable 5.1 (most capable)', effort: true, webTools: true, fallbacks: true },
  'claude-opus-5': { in: 5, out: 25, label: 'Claude Opus 5 (previous)', effort: true, webTools: true, fallbacks: true },
  'claude-sonnet-5': { in: 2, out: 10, label: 'Claude Sonnet 5 (previous)', effort: true, webTools: true, fallbacks: false },
});

export const ANTHROPIC_MODELS = Object.keys(MODEL_PRICES);

/** Web search is billed per search on top of tokens; web fetch costs only its tokens. */
export const WEB_SEARCH_USD = 10 / 1000;

/** @param {string} model */
export function modelCaps(model) {
  return MODEL_PRICES[model] || { effort: false, webTools: false, fallbacks: false };
}

/** Dollars for a run. Mock runs cost nothing but report a "shadow" cost at the model they stand in for. */
export function runCostUsd(run) {
  const p = MODEL_PRICES[run.model];
  if (!p) return 0;
  return ((run.tokensIn || 0) * p.in + (run.tokensOut || 0) * p.out) / 1e6 + (run.webSearches || 0) * WEB_SEARCH_USD;
}

export function shadowCostUsd(run) {
  const p = MODEL_PRICES[run.shadowModel || run.model];
  if (!p) return 0;
  return ((run.tokensIn || 0) * p.in + (run.tokensOut || 0) * p.out) / 1e6 + (run.webSearches || 0) * WEB_SEARCH_USD;
}

export function estimateTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}
