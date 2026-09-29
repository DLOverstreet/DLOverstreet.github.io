// How long a tile takes an agent, and whether splitting it into parts that run at the same
// time pays for itself. An agent's time is mostly the tokens it writes: the rows it hands
// back, the words of a document, a chart. Estimates use the model's writing speed measured
// from this browser's own runs when there are enough of them, and rough defaults otherwise.
// Pure, so the plan adapter, the swarm and the tests share one reading.
import { MODEL_PRICES, CACHE_WRITE } from '../llm/prices.js';

const TOKENS_PER_WORD = 1.35;
/** The approach, notes and checklist around the files in every worker reply. */
const REPLY_OVERHEAD = 450;
/** Thinking before and while writing, as a share of the visible output (medium effort). */
const THINKING = 1.3;
/** Time to the first token, per call. */
const FIRST_TOKEN_S = 5;
/** A web research step: a few searches and page reads. */
const RESEARCH_S = 40;
/** What a split plan costs to write, and what each part repeats (its own approach and notes). */
const PLAN_TOKENS = 600;
const PART_OVERHEAD = 450;
const PART_BRIEF_TOKENS = 350;
/** Output tokens per second when nothing has been measured yet. Rough; replaced by measured speed. */
const DEFAULT_TPS = 70;

const SOURCE = /requester|attached/i;
/** Row work that rewrites each row's text (translation, cleaning, summaries), not just labels it. */
const REWRITES = /\b(translat\w*|rewrit\w*|clean\w*|redact\w*|de-?identif\w*|summar\w*|describ\w*|descriptions?|captions?|transcri\w*|normali[sz]\w*|standardi[sz]\w*|fix\w*|edit\w*|proofread\w*|extract\w*)\b/i;
const PROSE = /\.(md|txt|markdown|html)$/i;

const ruleArgs = (t, name) => (t.acceptanceCriteria || []).map((c) => new RegExp(`^\\s*${name}\\(([^)]*)\\)`).exec(c.rule || '')?.[1]).filter(Boolean);

/** Rows a tile works through: its batch range, its row-count check, or the attached table it reads. */
export function tileRows(t, { sourceRows = null } = {}) {
  if (t.part && (t.part.of > 1 || t.part.to > t.part.from)) return t.part.to - t.part.from + 1;
  if (sourceRows && (t.inputs || []).some((f) => SOURCE.test(f)) && (t.outputs || []).some((f) => /\.(csv|tsv)$/i.test(f))) return sourceRows;
  return Math.max(0, ...ruleArgs(t, 'csv_min_rows').map((a) => Number(a) || 0));
}

/**
 * The work a tile asks of one agent: output tokens, the rows or words behind them, and how it
 * could split (by rows of a table, by sections of a document, or not at all).
 * @param {any} t tile
 * @param {{ sourceRows?: number|null, charsPerRow?: number|null }} [ctx]
 * @returns {{ outTokens: number, rows: number, words: number, by: 'rows'|'sections'|null, basis: string }}
 */
export function estimateAgentWork(t, { sourceRows = null, charsPerRow = null } = {}) {
  const outputs = t.outputs || [];
  const rows = tileRows(t, { sourceRows });
  const rewrites = REWRITES.test(`${t.title} ${t.archetype || ''}`) || ['translate', 'clean', 'edit', 'enrich', 'migrate', 'transcribe'].includes(t.archetype);
  const perRow = rewrites ? Math.max(20, Math.round((charsPerRow || 160) / 3.5)) + 12 : 28;
  const words = (() => {
    const wc = ruleArgs(t, 'word_count')[0];
    if (!wc) return 0;
    const [lo, hi] = wc.split(',').map((x) => Number(x.trim()) || 0);
    return Math.round(((lo || 0) + (hi || lo || 0)) / 2);
  })();
  let tokens = 0;
  let proseSeen = false;
  const basis = [];
  for (const name of outputs) {
    // A final assembly's tables are merged from the batches by code; the agent writes the rest.
    if (/\.(csv|tsv)$/i.test(name) && t.kind === 'INTEGRATION') { tokens += 150; basis.push(`${name}: merged by code`); continue; }
    if (/\.(csv|tsv)$/i.test(name)) {
      const n = rows || 20;
      tokens += n * perRow + 40;
      basis.push(`${name}: ${n} rows × ~${perRow} tokens`);
    } else if (PROSE.test(name)) {
      const w = !proseSeen && words ? words : 500;
      proseSeen = true;
      tokens += Math.round(w * TOKENS_PER_WORD) + (/\.html$/i.test(name) ? 1200 : 0);
      basis.push(`${name}: ~${w} words`);
    } else if (/\.svg$/i.test(name)) { tokens += 1300; basis.push(`${name}: a chart`); }
    else if (/\.json$/i.test(name)) { tokens += 400; basis.push(`${name}: a small JSON file`); }
    else if (/\.(py|r|sql|js|ts)$/i.test(name)) { tokens += 1100; basis.push(`${name}: a script`); }
    else { tokens += 500; basis.push(`${name}`); }
  }
  if (!outputs.length) tokens += 800;
  const csvRows = t.kind !== 'INTEGRATION' && outputs.some((f) => /\.(csv|tsv)$/i.test(f)) && rows >= 8;
  const by = csvRows ? 'rows' : words >= 1200 ? 'sections' : null;
  return { outTokens: tokens + REPLY_OVERHEAD, rows, words, by, basis: basis.join('; ') };
}

/** Seconds for one agent to write `outTokens` at `tps` output tokens per second. */
export function secondsFor(outTokens, tps = DEFAULT_TPS) {
  return Math.round(FIRST_TOKEN_S + (outTokens * THINKING) / Math.max(5, tps));
}

/** The expected agent time of a tile, research included. */
export function agentSeconds(t, ctx = {}) {
  const w = estimateAgentWork(t, ctx);
  return secondsFor(w.outTokens, ctx.tps) + (t.webResearch && !t.research ? RESEARCH_S : 0);
}

/**
 * Measured writing speed per model, from logged runs: output tokens over time, from successful
 * worker runs long enough to measure. Models with fewer than `min` runs are left out.
 * @param {{ agent: string, provider: string, model: string, tokensOut?: number|null, latencyMs?: number|null, error?: string|null }[]} runs
 * @returns {Record<string, number>}
 */
export function measuredSpeeds(runs, { min = 3 } = {}) {
  const by = new Map();
  for (const r of runs) {
    // Research runs wait on searches, so only worker runs measure writing speed.
    if (r.error || r.provider === 'mock' || r.agent !== 'worker') continue;
    if (!(r.tokensOut >= 300) || !(r.latencyMs > FIRST_TOKEN_S * 1000 + 1000)) continue;
    const list = by.get(r.model) || [];
    list.push(r.tokensOut / (r.latencyMs / 1000 - FIRST_TOKEN_S));
    by.set(r.model, list);
  }
  /** @type {Record<string, number>} */
  const out = {};
  for (const [model, list] of by) {
    if (list.length < min) continue;
    // Logged output tokens include thinking, the same tokens secondsFor() plans for.
    const sorted = list.slice(-30).sort((a, b) => a - b);
    out[model] = Math.round(sorted[Math.floor(sorted.length / 2)]);
  }
  return out;
}

/** The writing speed to plan with: measured for this model if there is enough data, the model's rough default otherwise. */
export function speedFor(model, measured = {}) {
  return measured[model] || MODEL_PRICES[model]?.tps || DEFAULT_TPS;
}

/**
 * The longest chain of tiles by expected agent time: how long the job takes with enough agents.
 * @returns {{ seconds: number, keys: string[] }}
 */
export function criticalPath(tiles, secondsOf) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const memo = new Map();
  const visit = (key, guard = new Set()) => {
    if (memo.has(key)) return memo.get(key);
    if (guard.has(key)) return { seconds: 0, keys: [] };
    guard.add(key);
    const t = byKey.get(key);
    let best = { seconds: 0, keys: [] };
    for (const d of t.dependsOn || []) {
      if (!byKey.has(d)) continue;
      const up = visit(d, guard);
      if (up.seconds > best.seconds) best = up;
    }
    const out = { seconds: best.seconds + secondsOf(t), keys: [...best.keys, key] };
    memo.set(key, out);
    return out;
  };
  let top = { seconds: 0, keys: [] };
  for (const t of tiles) { const p = visit(t.key); if (p.seconds > top.seconds) top = p; }
  return top;
}

/** Tiles that must stay in one agent's hands: shared conventions, final assembly, reviews and checks of others' work. */
export function splittable(t) {
  return t.kind === 'WORK' && t.phase !== 'conventions' && !t.independentCheck && !t.dynamic && t.agentMode !== 'prepare';
}

/**
 * Whether a tile may be split into parts that run at the same time, and into how many. It pays
 * when the tile is long, the work divides (rows or sections), the time saved is real, and the
 * extra cost stays within the allowance: the lead agent's plan, the shared context each part
 * reads again (from the prompt cache, written by the lead's call), and each part's own notes.
 * @param {{ tile: any, work: ReturnType<typeof estimateAgentWork>, inputTokens: number, model: string, tps?: number,
 *   settings: { split?: boolean, splitAboveSeconds: number, maxParts: number, splitMaxExtraPct: number, spendCapUsd?: number }, spentUsd?: number }} p
 * @returns {null | { parts: number, by: 'rows'|'sections', estSeconds: number, splitSeconds: number, savedSeconds: number, baseUsd: number, extraUsd: number, reason: string }}
 */
export function splitOffer({ tile, work, inputTokens, model, tps = DEFAULT_TPS, settings, spentUsd = 0 }) {
  if (!settings.split || !splittable(tile) || !work.by) return null;
  const estSeconds = secondsFor(work.outTokens, tps);
  if (estSeconds <= settings.splitAboveSeconds) return null;
  const p = MODEL_PRICES[model] || { in: 3, out: 15, cacheRead: 0.3, cacheMin: 1024 };
  const cached = inputTokens >= (p.cacheMin || 1024);
  const read = cached ? p.cacheRead ?? p.in * 0.1 : p.in;
  const write = cached ? p.in * CACHE_WRITE : p.in;
  const usd = (tin, tout, rate = p.in) => (tin * rate + tout * p.out) / 1e6;
  const baseUsd = usd(inputTokens, work.outTokens);
  const content = work.outTokens - REPLY_OVERHEAD;
  // No more parts than the rows or sections allow, or than it takes to get under the target time.
  const most = Math.min(settings.maxParts, Math.max(2, Math.ceil(estSeconds / settings.splitAboveSeconds)), work.by === 'rows' ? Math.floor(work.rows / 4) : Math.floor(work.words / 500));
  for (let k = most; k >= 2; k--) {
    const plan = usd(inputTokens, PLAN_TOKENS, write);
    const parts = k * usd(inputTokens, 0, read) + usd(k * PART_BRIEF_TOKENS, content + k * PART_OVERHEAD);
    const extraUsd = plan + parts - baseUsd;
    if (extraUsd > baseUsd * (settings.splitMaxExtraPct / 100)) continue;
    if (settings.spendCapUsd > 0 && spentUsd + plan + parts > settings.spendCapUsd) continue;
    const splitSeconds = secondsFor(PLAN_TOKENS, tps) + secondsFor(Math.ceil(content / k) + PART_OVERHEAD, tps);
    const savedSeconds = estSeconds - splitSeconds;
    if (savedSeconds < 15) return null;
    return {
      parts: k, by: work.by, estSeconds, splitSeconds, savedSeconds, baseUsd, extraUsd,
      reason: `about ${estSeconds} s for one agent (${work.basis}); ${k} parts at once take about ${splitSeconds} s for about $${extraUsd.toFixed(3)} more`,
    };
  }
  return null;
}
