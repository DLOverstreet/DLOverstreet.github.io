// The competition and supervision layer, as pure functions. On a swarm job each task goes to
// competing worker configs; a supervisor scores their outputs against a spec written before any
// work started (hard checks first, then a rubric), and accepts, flags, sends back, re-splits or
// escalates. Winning and losing attempts turn into lessons that are tested before they stay,
// worker configs evolve on their record, and the supervisors are scored too.
import { runAutoChecks } from './autochecks.js';

/** The swarm's first worker configs: one model, three strategies, so the competitors actually differ. */
export const DEFAULT_CONFIGS = Object.freeze([
  { key: 'careful', name: 'Careful', strategyHint: 'Work step by step. Before you hand in, check every number, id and name against the inputs and fix anything that doesn’t match.' },
  { key: 'reader', name: 'Reader first', strategyHint: 'Start from what the reader must be able to do with this output. Make it complete and clear for them first, and cut anything that doesn’t help.' },
  { key: 'skeptic', name: 'Skeptic', strategyHint: 'Distrust the obvious approach. Look for what could be missing, ambiguous or wrong in the inputs and the spec, handle those cases explicitly, and say how.' },
]);

/** Strategies a winning config's clone may try instead of its parent's. */
export const HINT_BANK = Object.freeze([
  'Outline the whole deliverable before writing any of it, then fill the outline in order.',
  'Work from the acceptance criteria backwards: make each one pass first, then improve the rest.',
  'Prefer the plainest correct answer. Short sentences, exact numbers, no filler.',
  'Cross-check the output against a second reading of the inputs, looking only for omissions.',
  'Write as the domain expert the requester would hire, and state the assumptions you make.',
  'Draft quickly, then spend most of the effort revising for accuracy and consistency.',
]);

/** Rubric items every task is judged on, beside its own criteria. */
const GENERIC_RUBRIC = [
  { id: 'fidelity', text: 'Does exactly what the task asks: the right files, columns, sections and length', weight: 1 },
  { id: 'accuracy', text: 'Every fact, number and quote matches the inputs or a cited source', weight: 2 },
  { id: 'usefulness', text: 'Clear and usable by the person it is for', weight: 1 },
];

/** AUTO rules a part of a split task can meet on its own share (row counts and lengths apply to the whole). */
const PART_RULES = /^\s*(csv_columns|json_valid|json_keys)\(/;

/** Whether a part writes the kind of file an AUTO rule checks (a document part isn't held to the table's columns). */
function ruleFits(rule, files) {
  if (/^\s*csv_/.test(rule)) return files.some((f) => /\.(csv|tsv)$/i.test(f));
  if (/^\s*json_/.test(rule)) return files.some((f) => /\.(json|geojson)$/i.test(f));
  return true;
}

/**
 * The spec a task is judged against, written when the task is created and before any work:
 * hard checks (automatic, pass or fail), a weighted rubric for the supervisor, and the
 * threshold the best attempt must clear.
 * @param {any} tile
 * @param {{ threshold?: number, brief?: string|null, files?: string[]|null, rows?: {from:number,to:number}|null, parentSpecId?: string|null, depth?: number, reason?: string|null }} [opts]
 */
export function buildTaskSpec(tile, { threshold = 0.7, brief = null, files = null, rows = null, parentSpecId = null, depth = 0, reason = null } = {}) {
  const criteria = tile.acceptanceCriteria || [];
  const child = !!parentSpecId;
  const auto = criteria.filter((c) => c.check === 'AUTO' && (!child || (PART_RULES.test(c.rule || '') && ruleFits(c.rule, files || []))));
  return {
    tileId: tile.id, commissionId: tile.commissionId, parentSpecId, depth, reason,
    title: child && brief ? brief.slice(0, 120) : tile.title,
    brief, files: files || tile.outputs || [], rows,
    taskType: tile.archetype || (tile.kind === 'INTEGRATION' ? 'assemble' : 'work'),
    hardChecks: [
      ...auto.map((c) => ({ id: c.id, kind: 'auto', rule: c.rule, text: c.text })),
      { id: 'files', kind: 'files', text: 'Every file the task owes is handed in and not empty' },
      { id: 'no-sample', kind: 'no-sample', text: 'No placeholder or SAMPLE data when the real data is in the inputs' },
      ...(tile.webResearch ? [{ id: 'sources', kind: 'sources', text: 'Every web address cited appears in the research sources or the inputs' }] : []),
    ],
    rubric: [
      ...criteria.filter((c) => c.check === 'LLM' || c.check === 'PEER').map((c) => ({ id: c.id, text: c.text, weight: 2, criterionId: c.id })),
      ...GENERIC_RUBRIC,
    ],
    threshold,
  };
}

const URL = /https?:\/\/[^\s)<>"'\]]+/gi;
const normUrl = (u) => String(u).replace(/[.,;:!?]+$/, '').replace(/\/+$/, '').replace(/^https?:\/\//i, '').toLowerCase();

/**
 * Checks before opinions: the task's automatic checks on an attempt's files. An attempt that
 * fails one can't win, however it reads.
 * @param {ReturnType<typeof buildTaskSpec>} spec
 * @param {{ name: string, text: string }[]} files
 * @param {{ sampleProblem?: string|null, sourceUrls?: string[] }} [ctx] a placeholder-data problem found by the caller, and the URLs the task may cite
 */
export function runHardChecks(spec, files, { sampleProblem = null, sourceUrls = [] } = {}) {
  const results = [];
  const autos = spec.hardChecks.filter((h) => h.kind === 'auto');
  if (autos.length) {
    const { results: r } = runAutoChecks(autos.map((h) => ({ id: h.id, check: 'AUTO', rule: h.rule, text: h.text })), files.map((f) => ({ name: f.name, size: f.text.length, text: f.text })));
    for (const x of r) results.push({ id: x.criterionId, pass: x.pass, reason: x.reason });
  }
  for (const h of spec.hardChecks) {
    if (h.kind === 'files') {
      const missing = spec.files.filter((n) => !files.some((f) => f.name === n && f.text.trim()));
      results.push({ id: h.id, pass: !missing.length, reason: missing.length ? `Missing or empty: ${missing.join(', ')}.` : 'Every owed file is there.' });
    } else if (h.kind === 'no-sample') {
      results.push({ id: h.id, pass: !sampleProblem, reason: sampleProblem || 'No placeholder data.' });
    } else if (h.kind === 'sources') {
      const allowed = new Set(sourceUrls.map(normUrl));
      const cited = [...new Set(files.flatMap((f) => f.text.match(URL) || []))];
      const unknown = allowed.size ? cited.filter((u) => !allowed.has(normUrl(u))) : [];
      results.push({ id: h.id, pass: !unknown.length, reason: unknown.length ? `Cited but not in the research: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}.` : 'Every cited address is in the research or the inputs.' });
    }
  }
  return { pass: results.every((r) => r.pass), results };
}

/** An attempt's rubric score on 0..1: the weighted mean of the supervisor's 0–4 marks. */
export function rubricScore(rubric, items) {
  const total = rubric.reduce((n, r) => n + r.weight, 0) || 1;
  const got = rubric.reduce((n, r) => n + r.weight * Math.max(0, Math.min(4, Number(items.find((i) => i.id === r.id)?.score ?? 0))) / 4, 0);
  return Math.round((got / total) * 1000) / 1000;
}

/**
 * How far apart the competitors are. Sharp disagreement is the supervisor saying so, or the
 * attempts that passed the hard checks landing far apart on the rubric.
 * @param {{ hardPass: boolean, score: number }[]} attempts
 * @param {string} agreement 'high', 'mixed' or 'low': the supervisor's reading of how much the attempts agree
 */
export function disagreement(attempts, agreement) {
  const passing = attempts.filter((a) => a.hardPass).map((a) => a.score);
  const spread = passing.length > 1 ? Math.max(...passing) - Math.min(...passing) : 0;
  return { sharp: agreement === 'low' || spread >= 0.4, spread: Math.round(spread * 1000) / 1000 };
}

/**
 * The supervisor's action on a scored round, following the blueprint's triggers:
 * accept when the best attempt clears the threshold and the workers mostly agree; accept with a
 * flag when they disagreed sharply; send back on a first or second failure; re-split on the
 * third (or when the task is too big or mixes two jobs); escalate when a re-split was already
 * tried, isn't possible, or the supervisor can't judge.
 * @param {{ attempts: { id: string, hardPass: boolean, score: number }[], threshold: number, agreement: string,
 *   failures: number, resplitUsed?: boolean, canResplit?: boolean, supervisor?: { canJudge?: boolean, confidence?: number, tooBig?: boolean, mixesJobs?: boolean }, maxSendBacks?: number }} p
 * @returns {{ action: 'accept'|'accept_flag'|'send_back'|'resplit'|'escalate', winnerId: string|null, reason: string, sharp: boolean, spread: number }}
 */
export function decide({ attempts, threshold, agreement, failures, resplitUsed = false, canResplit = true, supervisor = {}, maxSendBacks = 2 }) {
  const { sharp, spread } = disagreement(attempts, agreement);
  const ranked = attempts.filter((a) => a.hardPass).sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const out = (action, reason) => ({ action, winnerId: best && (action === 'accept' || action === 'accept_flag') ? best.id : null, reason, sharp, spread });
  if (supervisor.canJudge === false || (supervisor.confidence ?? 1) < 0.3) return out('escalate', 'The supervisor can’t judge this task with confidence.');
  if (best && best.score >= threshold) {
    return sharp
      ? out('accept_flag', `The best attempt scored ${best.score.toFixed(2)} (threshold ${threshold}), but the workers disagreed sharply.`)
      : out('accept', `The best attempt scored ${best.score.toFixed(2)} (threshold ${threshold}) and the workers mostly agree.`);
  }
  const why = best ? `The best attempt scored ${best.score.toFixed(2)}, under the ${threshold} threshold.` : 'No attempt passed the hard checks.';
  const resplit = canResplit && !resplitUsed;
  if ((supervisor.tooBig || supervisor.mixesJobs) && resplit) return out('resplit', `${why} The supervisor says the task ${supervisor.mixesJobs ? 'mixes two jobs' : 'is too big'}.`);
  if (failures < maxSendBacks) return out('send_back', `${why} Failure ${failures + 1}: back to the same workers with feedback.`);
  if (resplit) return out('resplit', `${why} Third failure: back to the disaggregator to split it differently.`);
  return out('escalate', `${why} ${resplitUsed ? 'A re-split was already tried.' : 'It can’t be split further.'}`);
}

/**
 * Whether a round of revision after seeing each other's drafts runs: always, never, or (auto)
 * only when the blind round didn't end in a clean accept, so agreement stays independent. It
 * never runs when seeing each other's drafts can't help: the supervisor can't judge the task,
 * or the task itself is the problem (too big, or two jobs in one).
 * @param {'auto'|'always'|'never'} mode
 */
export function needReveal(mode, blindDecision) {
  if (mode === 'never' || blindDecision.action === 'escalate' || blindDecision.action === 'resplit') return false;
  return mode === 'always' || blindDecision.action !== 'accept';
}

function shingles(text) {
  const w = String(text || '').toLowerCase().match(/[a-z0-9áéíóúñü']+/g) || [];
  const out = new Set();
  for (let i = 0; i + 2 < Math.min(w.length, 4000); i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** How alike two outputs read: word-triple overlap, 0 to 1. */
export function textSimilarity(a, b) {
  const x = shingles(a);
  const y = shingles(b);
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const s of x) if (y.has(s)) both++;
  return both / (x.size + y.size - both || 1);
}

/**
 * Herding: in the reveal round, how many workers moved toward the blind draft that scored
 * worst. Too many means workers copy the first confident answer instead of catching its errors.
 * @param {{ configId: string, text: string, score: number }[]} blind
 * @param {{ configId: string, text: string }[]} reveal
 */
export function herding(blind, reveal) {
  if (blind.length < 2) return { revisions: 0, towardWorst: 0 };
  const worst = [...blind].sort((a, b) => a.score - b.score)[0];
  let revisions = 0;
  let towardWorst = 0;
  for (const r of reveal) {
    const own = blind.find((b) => b.configId === r.configId);
    if (!own || own === worst) continue;
    revisions++;
    if (textSimilarity(r.text, worst.text) - textSimilarity(own.text, worst.text) > 0.05) towardWorst++;
  }
  return { revisions, towardWorst };
}

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * Who competes on a task: the active configs most likely to win this task type, with room for
 * ones not tried on it yet. Once one config clearly dominates a type, two compete instead of
 * three; with `solo` (competition on "auto"), a config that wins nearly every task of a type
 * does it alone, still scored and sent back by the supervisor. When the task type has a shared
 * playbook, one competitor works without it: a control group that tests the lessons and keeps
 * the swarm from all converging on one approach.
 * @param {any[]} configs active worker configs
 * @param {any[]} stats WorkerStats rows
 * @param {string} taskType
 * @param {{ competitors?: number, routing?: boolean, seed?: string, playbookSize?: number, solo?: boolean, include?: string[] }} [opts] include: configs that must compete (the cheaper challenger)
 * @returns {{ picked: any[], control: string|null, reason: string }}
 */
export function pickCompetitors(configs, stats, taskType, { competitors = 3, routing = true, seed = '', playbookSize = 0, solo = false, include = [] } = {}) {
  const on = (c) => stats.find((s) => s.configId === c.id && s.taskType === taskType) || { attempts: 0, wins: 0, scoreSum: 0 };
  const rated = configs.map((c) => {
    const s = on(c);
    const avg = s.attempts ? s.scoreSum / s.attempts : 0.6;
    // Notes other agents' winning work relied on earn a small bonus: sharing what helps pays.
    const assist = s.attempts ? Math.min(0.05, (0.1 * (s.assists || 0)) / s.attempts) : 0;
    const rank = avg + 0.25 / Math.sqrt(s.attempts + 1) + assist;
    // Configs that score about the same (within 0.03) are ranked cheapest first, so a cheaper model
    // that keeps up with a dearer one gets the work.
    return { c, s, rank, band: Math.round(rank / 0.03), cost: s.attempts ? (s.costMicroUsd || 0) / s.attempts : Infinity };
  }).sort((a, b) => b.band - a.band || a.cost - b.cost || b.rank - a.rank || a.c.id.localeCompare(b.c.id));
  const leader = rated.find((r) => r.s.attempts >= 6 && r.s.wins / r.s.attempts >= 0.7);
  const settled = solo && rated.find((r) => r.s.attempts >= 10 && r.s.wins / r.s.attempts >= 0.8);
  const n = Math.max(1, Math.min(rated.length, settled ? 1 : routing && leader ? Math.min(2, competitors) : competitors));
  let chosen = settled ? [settled] : rated.slice(0, n);
  // A config that must compete (the cheaper challenger) takes the place of the lowest-ranked pick.
  if (!settled) {
    for (const id of include) {
      const r = rated.find((x) => x.c.id === id);
      if (!r || chosen.includes(r)) continue;
      const out = [...chosen].reverse().find((x) => !include.includes(x.c.id));
      chosen = out && chosen.length >= n ? chosen.map((x) => (x === out ? r : x)) : [...chosen, r].slice(0, Math.max(n, 1));
    }
  }
  const picked = chosen.map((r) => r.c);
  const control = playbookSize > 0 && picked.length >= 2 ? picked[hash(seed) % picked.length].id : null;
  const top = settled || leader;
  const reason = top && n < competitors
    ? `${top.c.name} wins ${Math.round((top.s.wins / top.s.attempts) * 100)}% of ${taskType} tasks, so ${n === 1 ? 'it works alone' : `${n} compete`} instead of ${competitors}.`
    : n === 1 ? 'One config works alone.' : `${n} configs compete.`;
  return { picked, control, reason };
}

/**
 * The wire as a worker reads it: the job's team notes, oldest first, the newest `max` of them and
 * no more than `maxChars` in all, each with its id (to cite it) and who posted it where.
 * @param {any[]} messages AgentMessage rows of one job
 */
export function wireFor(messages, { max = 15, maxChars = 4000 } = {}) {
  const team = messages.filter((m) => m.to === 'team').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const out = [];
  let chars = 0;
  for (const m of team.reverse()) {
    if (out.length >= max || chars + m.text.length > maxChars) break;
    chars += m.text.length;
    out.push({ id: m.id, from: `${m.fromName || 'an agent'} on “${m.taskTitle || 'another tile'}”`, kind: m.kind, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
  }
  return out.reverse();
}

/** The notes a task's own competitors posted, for the next round: every note, labeled by attempt. */
export function taskNotes(messages, specId) {
  return messages.filter((m) => m.specId === specId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, from: m.label || 'a worker', to: m.to, kind: m.kind, text: m.text }));
}

/**
 * Assists from an accepted attempt: every note it relied on that another config posted earns that
 * config one assist on the note's task type (once per note). Notes the attempt wasn't shown, its
 * own config's notes and notes without a config earn nothing.
 * @param {string[]} usedIds the ids the winning attempt cited, already limited to notes it was shown
 * @param {any[]} messages AgentMessage rows
 * @param {string|null} winnerConfigId
 * @returns {{ messageId: string, configId: string, taskType: string }[]}
 */
export function assistsFrom(usedIds, messages, winnerConfigId) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out = [];
  for (const id of new Set(usedIds)) {
    const m = byId.get(id);
    if (!m || !m.configId || m.configId === winnerConfigId) continue;
    out.push({ messageId: id, configId: m.configId, taskType: m.taskType || 'work' });
  }
  return out;
}

/** Shared lessons for a task type, as they go into the playbook layer: proven ones first, then newest candidates under test. */
export function playbookFor(lessons, taskType, { max = 8 } = {}) {
  const live = lessons.filter((l) => l.scope === 'shared' && l.taskType === taskType && l.status !== 'retired');
  return [...live].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.createdAt - a.createdAt).slice(0, max);
}

/** A config's own lessons for a task type, newest first. */
export function personalLessons(lessons, configId, taskType, { max = 3 } = {}) {
  return lessons.filter((l) => l.scope === 'personal' && l.configId === configId && l.taskType === taskType && l.status !== 'retired').sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
}

/** Mean score with the lesson minus without it, once both sides have some trials. */
export function lessonLift(l) {
  if (!(l.trialsWith >= 3 && l.trialsWithout >= 3)) return null;
  return Math.round((l.scoreWith / l.trialsWith - l.scoreWithout / l.trialsWithout) * 1000) / 1000;
}

/**
 * A lesson's status after its trials: a candidate is promoted when it raised scores over enough
 * tasks and retired when it didn't; an active lesson is retired if it later turns out to lower them.
 * @returns {'candidate'|'active'|'retired'}
 */
export function judgeLesson(l, { minTrials = 20, minLift = 0.02 } = {}) {
  const lift = lessonLift(l);
  const n = (l.trialsWith || 0) + (l.trialsWithout || 0);
  if (lift === null || n < minTrials) return l.status;
  if (l.status === 'candidate') return lift >= minLift ? 'active' : 'retired';
  if (l.status === 'active' && n >= 2 * minTrials && lift < 0) return 'retired';
  return l.status;
}

/**
 * Evolving the configs: ones that keep losing are retired (keeping a few active), and a winning
 * config is cloned, first onto the next cheaper model (`downshift`, when given) with its own
 * strategy, then with one change of strategy, so the swarm keeps searching.
 * @param {any[]} configs
 * @param {any[]} stats
 * @param {{ maxActive?: number, minActive?: number, retireBelow?: number, retireAfter?: number, cloneAbove?: number, cloneAfter?: number, downshift?: ((model: string|null) => { model: string, label: string }|null)|null }} [opts]
 * @returns {{ retire: string[], clones: { parentId: string, name: string, strategyHint: string, model: string|null }[] }}
 */
export function evolveConfigs(configs, stats, { maxActive = 6, minActive = 3, retireBelow = 0.15, retireAfter = 12, cloneAbove = 0.5, cloneAfter = 6, downshift = null } = {}) {
  const active = configs.filter((c) => c.status === 'active');
  const totals = new Map(active.map((c) => [c.id, { attempts: 0, wins: 0 }]));
  for (const s of stats) { const t = totals.get(s.configId); if (t) { t.attempts += s.attempts; t.wins += s.wins; } }
  const rate = (id) => { const t = totals.get(id); return t.attempts ? t.wins / t.attempts : 0; };
  const retire = [];
  for (const c of [...active].sort((a, b) => rate(a.id) - rate(b.id))) {
    if (active.length - retire.length <= minActive) break;
    if (totals.get(c.id).attempts >= retireAfter && rate(c.id) < retireBelow) retire.push(c.id);
  }
  const clones = [];
  const used = new Set(configs.map((c) => c.strategyHint));
  let room = maxActive - (active.length - retire.length);
  for (const c of [...active].sort((a, b) => rate(b.id) - rate(a.id))) {
    if (room <= 0) break;
    if (retire.includes(c.id) || totals.get(c.id).attempts < cloneAfter || rate(c.id) < cloneAbove) continue;
    if (configs.some((x) => x.parentConfigId === c.id && x.status === 'active')) continue;
    // A winner first tries its own strategy on a cheaper model: if the clone keeps up, routing
    // prefers it (same score, lower cost), and the swarm has learned where the cheaper model is enough.
    const cheaper = downshift ? downshift(c.model || null) : null;
    if (cheaper && !configs.some((x) => x.parentConfigId === c.id && x.model === cheaper.model)) {
      clones.push({ parentId: c.id, name: `${c.name} · ${cheaper.label}`, strategyHint: c.strategyHint, model: cheaper.model });
      room--;
      continue;
    }
    const hint = HINT_BANK.find((h) => !used.has(h));
    if (!hint) break;
    used.add(hint);
    clones.push({ parentId: c.id, name: `${c.name} ${configs.filter((x) => x.parentConfigId === c.id).length + 2}`, strategyHint: hint, model: c.model || null });
    room--;
  }
  return { retire, clones };
}

/**
 * How reliable a supervisor is: how often its verdict (score at or over the threshold) agrees with
 * the hard checks, and with your own reviews of accepted tasks.
 * @param {{ supervisorScore: number, checkResult: boolean, yourReview?: 'agree'|'disagree'|null }[]} audits
 */
export function supervisorReliability(audits, threshold = 0.7) {
  const scored = audits.length;
  const agree = audits.filter((a) => (a.supervisorScore >= threshold) === !!a.checkResult).length;
  const reviewed = audits.filter((a) => a.yourReview);
  return {
    scored,
    checkAgreement: scored ? Math.round((agree / scored) * 1000) / 1000 : null,
    reviewed: reviewed.length,
    reviewAgreement: reviewed.length ? Math.round((reviewed.filter((a) => a.yourReview === 'agree').length / reviewed.length) * 1000) / 1000 : null,
  };
}

/** The leaderboard: every config on every task type it has competed on, best win rate first. */
export function leaderboard(stats, configs) {
  const name = new Map(configs.map((c) => [c.id, c]));
  return stats.filter((s) => s.attempts > 0).map((s) => ({
    configId: s.configId, name: name.get(s.configId)?.name || s.configId, status: name.get(s.configId)?.status || 'active', taskType: s.taskType,
    wins: s.wins, attempts: s.attempts, winRate: s.wins / s.attempts, avgScore: s.scoreSum / s.attempts, avgCostUsd: (s.costMicroUsd || 0) / 1e6 / s.attempts,
    assists: s.assists || 0, notes: s.notes || 0, model: name.get(s.configId)?.model || null,
  })).sort((a, b) => a.taskType.localeCompare(b.taskType) || b.winRate - a.winRate || b.avgScore - a.avgScore);
}
