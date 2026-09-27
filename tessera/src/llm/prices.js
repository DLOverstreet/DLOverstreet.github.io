// List prices per million tokens, used for the admin cost view. Check
// https://docs.claude.com/en/docs/about-claude/pricing when models change.
export const MODEL_PRICES = Object.freeze({
  'claude-fable-5-1': { in: 10, out: 50, label: 'Claude Fable 5.1' },
  'claude-opus-5': { in: 5, out: 25, label: 'Claude Opus 5' },
  'claude-sonnet-5': { in: 2, out: 10, label: 'Claude Sonnet 5' },
  'claude-haiku-4-5': { in: 1, out: 5, label: 'Claude Haiku 4.5' },
});

export const ANTHROPIC_MODELS = Object.keys(MODEL_PRICES);

/** Dollars for a run. Mock runs cost nothing but report a "shadow" cost at the model they stand in for. */
export function runCostUsd(run) {
  const p = MODEL_PRICES[run.model];
  if (!p) return 0;
  return ((run.tokensIn || 0) * p.in + (run.tokensOut || 0) * p.out) / 1e6;
}

export function shadowCostUsd(run) {
  const p = MODEL_PRICES[run.shadowModel || run.model];
  if (!p) return 0;
  return ((run.tokensIn || 0) * p.in + (run.tokensOut || 0) * p.out) / 1e6;
}

export function estimateTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}
