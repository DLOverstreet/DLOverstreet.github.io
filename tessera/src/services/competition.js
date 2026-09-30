// The competition and supervision layer on swarm jobs. Each work tile becomes a task with a spec
// written before any work (src/domain/supervision.js). Several worker configs do it at once, blind;
// a supervisor on another model scores their attempts after the automatic checks; and the swarm
// accepts, flags, sends back, re-splits or escalates to you. When the blind round isn't a clean
// accept, the workers see each other's drafts and revise before a second scoring. Every attempt,
// score and action is logged; lessons, worker configs and the supervisors' record learn from them.
import { AGENTS, samplePlaceholder, workerFiles } from '../agents/index.js';
import { joinParts } from '../agents/split.js';
import { runAgent } from '../llm/run-agent.js';
import { runCostUsd } from '../llm/prices.js';
import { storeFiles, loadFileTexts } from './files.js';
import { UserError, must, upstreamIds } from './core.js';
import { submitWork } from './work.js';
import {
  buildTaskSpec, runHardChecks, rubricScore, decide, needReveal, herding, pickCompetitors, playbookFor, personalLessons,
  judgeLesson, evolveConfigs, textSimilarity, DEFAULT_CONFIGS, taskNotes, assistsFrom,
} from '../domain/supervision.js';
import { MODEL_PRICES } from '../llm/prices.js';
import { redactText } from '../lib/redact.js';
import { unitHash } from '../lib/util.js';

const LABELS = 'ABCDEFGH';
const TABLE_FILE = /\.(csv|tsv)$/i;
const DOC_FILE = /\.(md|markdown|txt)$/i;

function clipText(text, max) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max)}\n… (${t.length - max} more characters not shown)` : t;
}

/** A call's model cost in millionths of a dollar: whole numbers, like cents in the ledger. */
function costOf(res) {
  const u = res?.usage;
  if (!u) return 0;
  return Math.round(1e6 * runCostUsd({
    model: res.model, tokensIn: u.inputTokens, tokensOut: u.outputTokens, tokensCacheWrite: u.cacheWriteTokens,
    tokensCacheWrite1h: u.cacheWrite1hTokens, tokensCacheRead: u.cacheReadTokens, webSearches: u.webSearches, batch: !!u.batch,
  }));
}

/** A copy of a worker input that keeps the merged files the swarm computed (they aren't enumerable). */
function withPre(input, from) {
  if (from.precomputedFiles) Object.defineProperty(input, 'precomputedFiles', { value: from.precomputedFiles, enumerable: false });
  return input;
}

/** Web addresses a task may cite: its research sources and any address in its inputs. */
function citable(input) {
  const urls = (input.research?.sources || []).map((x) => x.url);
  for (const f of [...(input.inputs || []), ...(input.attachments || [])]) urls.push(...(String(f.content || '').match(/https?:\/\/[^\s)<>"'\]]+/gi) || []));
  return urls;
}

/**
 * Warm the cache, then fan out: the first call starts alone and the rest start once its
 * response begins streaming (its prompt is cached by then), so they read the cache instead of
 * each paying to write it. With `warm`, the prefix is already cached and all start at once.
 * @param {((onStart?: () => void) => Promise<any>)[]} starters
 */
async function fanOut(starters, warm) {
  if (warm || starters.length < 2) return Promise.all(starters.map((f) => f()));
  /** @type {(v?: any) => void} */
  let go = () => {};
  const started = new Promise((r) => { go = r; });
  const first = starters[0](() => go()).finally(() => go());
  await started;
  return Promise.all([first, ...starters.slice(1).map((f) => f())]);
}

/** The swarm's first worker configs, created once. */
export function ensureConfigs(T) {
  if (T.db.count('WorkerConfig')) return;
  T.db.tx((tx) => {
    for (const c of DEFAULT_CONFIGS) tx.insert('WorkerConfig', { key: c.key, name: c.name, strategyHint: c.strategyHint, model: null, status: 'active', parentConfigId: null, generation: 1 });
  });
}

/** The cheaper challenger each task includes when Settings ask for one: a free model, or a cheaper Claude. */
const CHALLENGERS = {
  free: { key: 'challenger-free', name: 'Free-model challenger', model: 'free' },
  haiku: { key: 'challenger-haiku', name: 'Haiku challenger', model: 'claude-haiku-4-5' },
  sonnet: { key: 'challenger-sonnet', name: 'Sonnet challenger', model: 'claude-sonnet-5-5' },
};
const CHALLENGER_HINT = 'Prefer the plainest correct answer: exact numbers, short sentences, every figure traced to an input. Check the criteria one by one before you hand in.';

/** The active challenger config for the current setting, created the first time it's asked for. */
export function ensureChallenger(T, s) {
  const want = s.competition !== 'off' ? CHALLENGERS[s.challenger] : null;
  if (!want) return null;
  const have = T.db.find('WorkerConfig', (c) => c.key === want.key);
  if (have) return have.status === 'active' ? have : null;
  return T.db.tx((tx) => tx.insert('WorkerConfig', { key: want.key, name: want.name, strategyHint: CHALLENGER_HINT, model: want.model, challenger: true, status: 'active', parentConfigId: null, generation: 1 }));
}

/** The next cheaper Claude model for a config's model, for clones that test whether a cheaper model is enough. */
const LADDER = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];
export function downshiftFor(s) {
  return (model) => {
    const i = LADDER.indexOf(model || s.workerModel);
    const next = i >= 0 ? LADDER[i + 1] : null;
    return next ? { model: next, label: MODEL_PRICES[next]?.label || next } : null;
  };
}

/**
 * Stores the notes a worker posted on the wire. Notes from competitors carry their config, so an
 * accepted attempt that relied on one credits its author with an assist.
 * @returns {any[]} the stored AgentMessage rows
 */
export function postMessages(T, messages, from) {
  if (!messages?.length) return [];
  return T.db.tx((tx) => messages.map((m) => tx.insert('AgentMessage', {
    commissionId: from.commissionId, tileId: from.tileId, specId: from.specId || null, attemptId: from.attemptId || null,
    configId: from.configId || null, fromName: from.fromName, label: from.label || null, taskTitle: from.taskTitle, taskType: from.taskType || 'work',
    round: from.round || null, cycle: from.cycle || null, to: m.to, kind: m.kind, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}),
  })));
}

/** Whether a swarm tile goes to competing workers: work tiles do, unless competition is off or you settled it for one agent. */
export function competes(tile, s) {
  return s.competition !== 'off' && !tile.dynamic && tile.kind !== 'REVIEW' && tile.supervision?.state !== 'single';
}

/**
 * @param {any} T
 * @param {{ setActivity?: (tileId: string, activity: any) => void, pace?: () => Promise<void>|null }} [hooks]
 */
export function createCompetition(T, { setActivity = () => {}, pace = () => null } = {}) {
  const insert = (table, row) => T.db.tx((tx) => tx.insert(table, row));
  const patch = (table, id, p) => T.db.tx((tx) => tx.update(table, id, p));

  function activity(ctx, doing) {
    setActivity(ctx.tile.id, { agentId: ctx.tile.claimedById, doing: ctx.spec.parentSpecId ? `part ${ctx.partNo}: ${doing}` : doing, since: T.clock.now(), model: ctx.route.label });
  }

  // ------------------------------------------------------------------ one task

  function newSpec(tile, s, opts = {}) {
    const spec = buildTaskSpec(tile, { threshold: s.threshold, ...opts });
    return insert('TaskSpec', { ...spec, status: 'open', herding: null, costMicroUsd: 0 });
  }

  /** The route a config works on: its own model when it has one (a cheaper clone, the challenger), else the task's. */
  function routeOf(ctx, cfg) {
    if (!cfg.model) return ctx.route;
    const c = T.db.get('Commission', ctx.tile.commissionId);
    return T.llm.agent(cfg.model, { commission: c, fallbackModel: ctx.s.workerModel });
  }

  /** The context one task runs in: its spec and input, who competes, and what they cost. */
  function taskContext(parent, spec, base, extra = {}) {
    const challenger = parent.challenger || null;
    // A challenger config competes only while Settings ask for it.
    const configs = T.db.filter('WorkerConfig', (c) => c.status === 'active' && (!c.challenger || c.id === challenger?.id));
    const playbook = parent.s.learning ? playbookFor(T.db.all('Lesson'), spec.taskType) : [];
    const pick = pickCompetitors(configs, T.db.all('WorkerStats'), spec.taskType, {
      competitors: parent.s.competitors, routing: parent.s.routing, seed: spec.id, playbookSize: playbook.length, solo: parent.s.competition === 'auto',
      include: challenger ? [challenger.id] : [],
    });
    const lessons = T.db.all('Lesson');
    const ctx0 = { ...parent, spec };
    const picked = pick.picked.map((cfg, i) => ({
      cfg, label: LABELS[i], control: cfg.id === pick.control, route: routeOf(ctx0, cfg),
      lessons: parent.s.learning ? personalLessons(lessons, cfg.id, spec.taskType) : [],
    }));
    patch('TaskSpec', spec.id, {
      competitors: picked.map((p) => ({ configId: p.cfg.id, name: p.cfg.name, label: p.label, control: p.control, model: p.route.label })),
      routing: pick.reason, playbookIds: playbook.map((l) => l.id),
    });
    return {
      ...parent, spec, base, picked, playbook, costs: new Map(), posted: new Map(), supervisorCost: 0, resplitUsed: false, dropped: [],
      sourceUrls: citable(base), shownIds: new Set((base.wire || []).map((m) => m.id)), ...extra,
    };
  }

  function competitorInput(ctx, p, { mode, cycle, round = null, prior = null, feedback = null }) {
    const { delegation, ...rest } = ctx.base;
    const input = withPre({ ...rest }, ctx.base);
    if (ctx.playbook.length && !p.control) input.playbook = { taskType: ctx.spec.taskType, lessons: ctx.playbook.map((l) => l.text) };
    const note = cycle === 1 && ctx.userFeedback ? `From the requester, who looked at the last attempts: ${ctx.userFeedback}` : null;
    input.agent = {
      config: p.cfg.name, strategyHint: p.cfg.strategyHint, mode, cycle,
      ...(p.lessons.length ? { lessons: p.lessons.map((l) => l.text) } : {}),
      ...(mode === 'reveal' || mode === 'notes' ? { yourDraft: p.label } : {}),
      ...(prior ? { priorDraft: prior } : {}),
      ...(feedback || note ? { feedback: [note, feedback].filter(Boolean).join('\n') } : {}),
    };
    if (round) input.round = round;
    return input;
  }

  function callWorker(ctx, p, input, onStart) {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 100) / 10;
    return runAgent({
      agent: AGENTS.worker, input, route: p.route, log: T.log, maxTokens: 20000, retries: 1, bestEffort: true, cache: true, onStart, effort: ctx.s.workerEffort || undefined, batch: !!ctx.s.batch,
      meta: { commissionId: ctx.tile.commissionId, tileId: ctx.tile.id, userId: ctx.tile.claimedById, competitor: `${p.label} · ${p.cfg.name}${ctx.spec.parentSpecId ? ` · part ${ctx.partNo}` : ''}` },
    }).then((res) => ({ p, input, res, seconds: seconds() }), (error) => ({ p, input, error, seconds: seconds() }));
  }

  async function recordAttempt(ctx, r, round, cycle) {
    const { p } = r;
    const base = {
      specId: ctx.spec.id, tileId: ctx.tile.id, commissionId: ctx.tile.commissionId, configId: p.cfg.id, configName: p.cfg.name, label: p.label,
      round, cycle, control: !!p.control, playbookIds: p.control ? [] : ctx.playbook.map((l) => l.id), lessonIds: p.lessons.map((l) => l.id), seconds: r.seconds,
    };
    if (r.error) {
      const row = insert('Attempt', { ...base, files: [], notes: '', error: String(r.error.message || r.error).slice(0, 500), hardPass: false, hardResults: [], costMicroUsd: 0 });
      return { p, row, output: null, hard: { pass: false, results: [] }, error: row.error };
    }
    const out = r.res.output;
    const hard = runHardChecks(ctx.spec, workerFiles(out, r.input).map((f) => ({ name: f.name, text: f.text })), { sampleProblem: samplePlaceholder(out, r.input), sourceUrls: ctx.sourceUrls });
    const refs = await storeFiles(T, `attempts/${ctx.spec.id}/${p.label}-${round}${cycle}`, out.files.map((f) => ({ name: f.name, text: f.content })));
    const cost = costOf(r.res);
    if (p.cfg.id) ctx.costs.set(p.cfg.id, (ctx.costs.get(p.cfg.id) || 0) + cost);
    const u = r.res.usage || {};
    // Only notes the worker was actually shown count as used.
    const used = (out.usedMessages || []).filter((id) => ctx.shownIds.has(id));
    const row = insert('Attempt', {
      ...base, files: refs, approach: out.approach, notes: String(out.notes || '').slice(0, 2000), handoff: out.handoff || '', problems: r.res.problems || [],
      model: r.res.model, provider: r.res.provider || null, tokensIn: u.inputTokens ?? null, tokensCached: u.cacheReadTokens || 0, tokensCacheWrite: u.cacheWriteTokens || 0, tokensOut: u.outputTokens ?? null,
      costMicroUsd: cost, hardPass: hard.pass, hardResults: hard.results, usedMessageIds: used, posted: (out.messages || []).length, edited: out.edited || 0,
    });
    postMessages(T, out.messages, {
      commissionId: ctx.tile.commissionId, tileId: ctx.tile.id, specId: ctx.spec.id, attemptId: row.id, configId: p.cfg.id, fromName: p.cfg.name, label: p.label,
      taskTitle: ctx.spec.title, taskType: ctx.spec.taskType, round, cycle,
    });
    if (p.cfg.id && out.messages?.length) ctx.posted.set(p.cfg.id, (ctx.posted.get(p.cfg.id) || 0) + out.messages.length);
    return { p, row, output: out, input: r.input, hard };
  }

  /**
   * Every competitor (or, with `extras.only`, the finalists) does the task once in this round; each
   * attempt is stored and hard-checked. Caches are per model, so competitors are grouped by model and
   * each group warms its own cache before the rest of the group reads it.
   */
  async function runRound(ctx, round, cycle, extras = {}) {
    const who = extras.only ? ctx.picked.filter((p) => extras.only.has(p.cfg.id)) : ctx.picked;
    const n = who.length;
    activity(ctx, round === 'blind' ? (n > 1 ? `${n} workers competing, blind` : 'working')
      : round === 'reveal' ? `${n} workers revising after seeing each other's drafts`
        : round === 'notes' ? `${n} workers revising after reading the scores and each other's notes`
          : `${n > 1 ? `${n} workers` : 'the worker'} fixing what the supervisor sent back`);
    await pace();
    const groups = new Map();
    for (const p of who) {
      const starter = (onStart) => callWorker(ctx, p, competitorInput(ctx, p, {
        mode: round, cycle, round: extras.round || null, prior: extras.prior?.get(p.cfg.id) || null, feedback: extras.feedback?.get(p.cfg.id) || null,
      }), onStart);
      const key = p.route.model;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(starter);
    }
    // A new cached layer (the task on its first call, the round's notes or drafts after) is written once per model, then read by the rest.
    const warm = round === 'blind' && ctx.warm;
    const results = (await Promise.all([...groups.values()].map((g) => fanOut(g, warm)))).flat();
    ctx.warm = true;
    const attempts = [];
    for (const r of results) attempts.push(await recordAttempt(ctx, r, round, cycle));
    return attempts;
  }

  /** The finalists who revise after a scored round: every attempt with output, or the best `finalists` of them. */
  function finalistsOf(ctx, scored) {
    const ranked = scored.scored.filter((a) => a.output).sort((a, b) => b.score - a.score || a.p.label.localeCompare(b.p.label));
    const keep = ctx.s.finalists > 0 ? ranked.slice(0, ctx.s.finalists) : ranked;
    // Attempts that don't go on still count as losses for their configs.
    for (const a of scored.scored) if (!keep.includes(a) && !ctx.dropped.some((d) => d.p.cfg.id === a.p.cfg.id)) ctx.dropped.push(a);
    return { keep, only: new Set(keep.map((a) => a.p.cfg.id)) };
  }

  /**
   * What every reviser reads after a scored round, shared (and cached) by all of them: the supervisor's
   * score and summary of each attempt, the notes the competitors posted, and each one's approach.
   * With `drafts`, the full blind drafts instead of the approaches (the older reveal round).
   */
  function roundNotes(ctx, scored, { drafts = false } = {}) {
    const notes = taskNotes(T.db.filter('AgentMessage', (m) => m.specId === ctx.spec.id), ctx.spec.id);
    for (const m of notes) ctx.shownIds.add(m.id);
    const scores = scored.scored.map((a) => ({
      label: a.p.label, score: Math.round(a.score * 100) / 100, passedChecks: a.hard.pass,
      ...(a.hard.pass ? {} : { failedChecks: a.hard.results.filter((r) => !r.pass).map((r) => r.reason) }),
      summary: a.verdict?.summary || (a.error ? 'The worker failed.' : ''),
    }));
    if (drafts) {
      return { drafts: scored.scored.filter((a) => a.output).map((a) => ({ label: a.p.label, files: a.output.files.map((f) => ({ name: f.name, content: clipText(f.content, 6000) })), notes: clipText(a.output.notes, 1000) })), scores, notes };
    }
    return {
      scores, notes, supervisor: { feedback: scored.verdict?.feedback || '', disagreements: scored.verdict?.disagreements || [] },
      approaches: scored.scored.filter((a) => a.output).map((a) => ({ label: a.p.label, approach: a.output.approach })),
    };
  }

  function supervisorInput(ctx, judged, round, cycle) {
    const b = ctx.base;
    return {
      job: b.job,
      task: {
        title: ctx.spec.title, ...(ctx.spec.brief ? { brief: ctx.spec.brief } : {}), spec: b.tile.spec, outputs: ctx.spec.files, ...(ctx.spec.rows ? { rows: ctx.spec.rows } : {}),
        criteria: b.tile.acceptanceCriteria.map((c) => ({ id: c.id, text: c.text, check: c.check })),
        rubric: ctx.spec.rubric.map((r) => ({ id: r.id, text: r.text, weight: r.weight })), threshold: ctx.spec.threshold,
        ...(ctx.upstream?.length ? { upstream: ctx.upstream } : {}),
      },
      inputs: [
        ...[...(b.inputs || []), ...(b.attachments || [])].map((f) => ({ name: f.name, ...(f.note ? { note: f.note } : {}), ...(typeof f.content === 'string' ? { content: clipText(f.content, 6000) } : {}) })),
        ...(b.research?.sources?.length ? [{ name: 'research sources', content: b.research.sources.map((x) => `${x.n}. ${x.title} ${x.url}`).join('\n') }] : []),
        ...(b.merged?.length ? [{ name: 'merged by the swarm', note: b.merged.map((m) => `${m.name}: ${m.rows} rows from ${m.from.length} files, not written by the workers`).join('; ') }] : []),
      ],
      round, cycle,
      attempts: judged.map((a) => ({ label: a.p.label, files: a.output.files.map((f) => ({ name: f.name, content: clipText(f.content, 8000) })), notes: clipText(a.output.notes, 1500) })),
    };
  }

  /**
   * Checks before opinions: the supervisor scores the attempts on the rubric without seeing the
   * check results (so its scores can be audited against them), and an attempt that failed a
   * check scores 0 whatever the supervisor thought of it.
   */
  async function scoreRound(ctx, attempts, round, cycle) {
    const judged = attempts.filter((a) => a.output);
    let verdict = null;
    let supervisorId = null;
    if (judged.some((a) => a.hard.pass)) {
      activity(ctx, `supervisor scoring ${judged.length} attempt${judged.length > 1 ? 's' : ''}`);
      const res = await runAgent({
        agent: AGENTS.supervisor, input: supervisorInput(ctx, judged, round, cycle), route: ctx.checkRoute, log: T.log, cache: true, effort: ctx.s.checkEffort || undefined, batch: !!ctx.s.batch,
        meta: { commissionId: ctx.tile.commissionId, tileId: ctx.tile.id, userId: ctx.tile.claimedById, competitor: `supervisor · ${round}` },
      });
      verdict = res.output;
      supervisorId = `${ctx.spec.parentSpecId ? 'branch' : 'task'} supervisor · ${res.model}`;
      ctx.supervisorCost += costOf(res);
    }
    const scored = attempts.map((a) => {
      const v = verdict?.attempts.find((x) => x.label === a.p.label) || null;
      const rubric = v ? rubricScore(ctx.spec.rubric, v.items) : 0;
      const score = a.hard.pass ? rubric : 0;
      const summary = v?.summary || (a.error ? `The worker failed: ${a.error}` : 'Not scored: every attempt failed a hard check.');
      insert('Score', {
        attemptId: a.row.id, specId: ctx.spec.id, commissionId: ctx.tile.commissionId, round, cycle, supervisorId,
        checkResults: a.hard.results, hardPass: a.hard.pass, items: v?.items || [], rubricScore: rubric, score, summary, rationale: verdict?.rationale || '',
      });
      const audit = v ? insert('SupervisorAudit', {
        supervisorId, specId: ctx.spec.id, attemptId: a.row.id, commissionId: ctx.tile.commissionId, taskType: ctx.spec.taskType,
        supervisorScore: rubric, checkResult: a.hard.pass, threshold: ctx.spec.threshold, sampled: false, yourReview: null,
      }) : null;
      return { ...a, verdict: v, rubric, score, auditId: audit?.id || null };
    });
    return { round, cycle, scored, verdict, supervisorId };
  }

  function decision(ctx, scored, failures) {
    const sup = scored.verdict;
    return decide({
      attempts: scored.scored.map((a) => ({ id: a.row.id, hardPass: a.hard.pass, score: a.score })),
      threshold: ctx.spec.threshold, agreement: sup?.agreement || 'high', failures, resplitUsed: ctx.resplitUsed, canResplit: !!resplitDelegation(ctx),
      supervisor: sup ? { canJudge: sup.canJudge, confidence: sup.confidence, tooBig: sup.tooBig, mixesJobs: sup.mixesJobs } : {},
    });
  }

  function recordAction(ctx, scored, d, extra = {}) {
    return insert('SupervisorAction', {
      specId: ctx.spec.id, tileId: ctx.tile.id, commissionId: ctx.tile.commissionId, taskType: ctx.spec.taskType, depth: ctx.spec.depth,
      cycle: scored?.cycle ?? null, round: scored?.round ?? null, action: d.action, reason: d.reason, feedback: scored?.verdict?.feedback || '',
      disagreements: scored?.verdict?.disagreements || [], sharp: !!d.sharp, spread: d.spread ?? 0, winnerAttemptId: d.winnerId || null, newChildSpecIds: [], by: 'supervisor', ...extra,
    });
  }

  /**
   * What each worker is told when it revises (sent back, or after the blind round), and the draft it
   * revises: its own, in full, so it can hand back edits instead of rewriting.
   */
  function sendBackNotes(scored, { sentBack = true } = {}) {
    const feedback = new Map();
    const prior = new Map();
    for (const a of scored.scored) {
      const fails = a.hard.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.reason}`);
      const weak = (a.verdict?.items || []).filter((i) => i.score < 3).map((i) => `${i.id} (${i.score}/4): ${i.note}`);
      feedback.set(a.p.cfg.id, [
        sentBack && scored.verdict?.feedback ? `Supervisor: ${scored.verdict.feedback}` : '',
        a.error ? `Your last try failed: ${a.error}` : '',
        fails.length ? `Your draft failed these checks: ${fails.join('; ')}` : '',
        weak.length ? `Your weakest points: ${weak.join('; ')}` : '',
      ].filter(Boolean).join('\n') || (sentBack ? 'No draft reached the bar. Check every figure and file against the inputs and the criteria.' : ''));
      if (a.output) prior.set(a.p.cfg.id, { files: a.output.files.map((f) => ({ name: f.name, content: f.content })), notes: clipText(a.output.notes, 1500) });
    }
    return { feedback, prior };
  }

  /** A config's record on the task type, the lesson trials of this task, and the configs evolving on both. */
  function recordOutcome(ctx, scored, winnerId, assists = []) {
    const s = ctx.s;
    // Finalists' last attempts, plus the attempts that didn't make the final round (losses).
    const all = [...(scored?.scored || []), ...ctx.dropped.filter((d) => !(scored?.scored || []).some((a) => a.p.cfg.id === d.p.cfg.id))];
    T.db.tx((tx) => {
      const touched = new Set();
      const bump = (configId, taskType, add) => {
        const st = tx.find('WorkerStats', (x) => x.configId === configId && x.taskType === taskType);
        if (st) {
          const next = {};
          for (const [k, v] of Object.entries(add)) next[k] = k === 'scoreSum' ? Math.round(((st[k] || 0) + v) * 1000) / 1000 : (st[k] || 0) + v;
          tx.update('WorkerStats', st.id, next);
        } else tx.insert('WorkerStats', { configId, taskType, attempts: 0, wins: 0, scoreSum: 0, costMicroUsd: 0, assists: 0, notes: 0, ...add });
      };
      for (const a of all) {
        if (!a.p.cfg.id) continue;
        bump(a.p.cfg.id, ctx.spec.taskType, { attempts: 1, wins: a.row.id === winnerId ? 1 : 0, scoreSum: a.score, costMicroUsd: ctx.costs.get(a.p.cfg.id) || 0, notes: ctx.posted.get(a.p.cfg.id) || 0 });
        if (!a.output) continue;
        // The shared playbook's lessons are trialed on everyone: with them, or (the control) without.
        const trials = [...ctx.playbook.map((l) => ({ l, used: !a.p.control })), ...a.p.lessons.map((l) => ({ l, used: true }))];
        for (const { l, used } of trials) {
          tx.insert('LessonTrial', { lessonId: l.id, attemptId: a.row.id, specId: ctx.spec.id, configId: a.p.cfg.id, used, score: a.score });
          touched.add(l.id);
          const cur = tx.get('Lesson', l.id);
          tx.update('Lesson', l.id, used
            ? { trialsWith: cur.trialsWith + 1, scoreWith: Math.round((cur.scoreWith + a.score) * 1000) / 1000 }
            : { trialsWithout: cur.trialsWithout + 1, scoreWithout: Math.round((cur.scoreWithout + a.score) * 1000) / 1000 });
        }
      }
      for (const id of touched) {
        const l = tx.get('Lesson', id);
        const status = judgeLesson(l, { minTrials: s.lessonTrials });
        if (status !== l.status) tx.update('Lesson', id, { status, decidedAt: tx.now() });
      }
      // Authors of notes the winner relied on earn assists (on the task type the note came from).
      for (const x of assists) bump(x.configId, x.taskType, { assists: 1 });
      // The challenger stays out of evolution: it is there to test a cheaper model, and Settings decide it.
      const evolving = tx.all('WorkerConfig').filter((c) => !c.challenger);
      const { retire, clones } = evolveConfigs(evolving, tx.all('WorkerStats'), { downshift: s.cheaperClones ? downshiftFor(s) : null });
      for (const id of retire) tx.update('WorkerConfig', id, { status: 'retired', retiredAt: tx.now(), why: 'Kept losing: under 15% of its tasks won.' });
      for (const c of clones) {
        const parent = tx.get('WorkerConfig', c.parentId);
        const cheaper = c.model !== (parent.model || null);
        tx.insert('WorkerConfig', {
          key: `${parent.key}-${tx.count('WorkerConfig') + 1}`, name: c.name, strategyHint: c.strategyHint, model: c.model ?? parent.model ?? null, status: 'active', parentConfigId: parent.id, generation: (parent.generation || 1) + 1,
          why: cheaper ? `Cloned from ${parent.name}, which wins over half its tasks, to see whether a cheaper model does as well.` : `Cloned from ${parent.name}, which wins over half its tasks, with a new strategy.`,
        });
      }
    });
  }

  function closeSpec(ctx, p) {
    const spent = [...ctx.costs.values()].reduce((n, x) => n + x, 0) + ctx.supervisorCost;
    patch('TaskSpec', ctx.spec.id, { ...p, costMicroUsd: spent, closedAt: T.clock.now() });
  }

  /** The winner's marks on the tile's own LLM and PEER criteria, as the verification step records them. */
  function criterionVerdicts(ctx, win) {
    const out = [];
    for (const c of ctx.base.tile.acceptanceCriteria.filter((x) => x.check === 'LLM' || x.check === 'PEER')) {
      const item = win.verdict?.items.find((i) => i.id === c.id);
      if (item) out.push({ criterionId: c.id, pass: item.score >= 2, reason: `Supervisor, ${item.score}/4: ${item.note}` });
    }
    return out;
  }

  function accept(ctx, scored, d, extra = {}) {
    const win = scored.scored.find((a) => a.row.id === d.winnerId);
    const flagged = d.action === 'accept_flag';
    recordAction(ctx, scored, d);
    const assists = assistsFrom(win.row.usedMessageIds || [], T.db.filter('AgentMessage', (m) => m.commissionId === ctx.tile.commissionId), win.p.cfg.id);
    if (win.p.cfg.id) recordOutcome(ctx, scored, win.row.id, assists);
    const others = scored.scored.filter((a) => a !== win);
    const reflect = ctx.s.learning && others.some((a) => a.output) && win.p.cfg.id;
    closeSpec(ctx, {
      status: 'accepted', winnerAttemptId: win.row.id, score: win.score, flagged, disagreements: scored.verdict?.disagreements || [], reason: d.reason,
      reflect: reflect ? 'pending' : null,
      reflectInput: reflect ? {
        taskType: ctx.spec.taskType, task: { title: ctx.spec.title, criteria: ctx.base.tile.acceptanceCriteria.map((c) => c.text) },
        winner: { label: win.p.label, config: win.p.cfg.name, score: win.score, summary: win.verdict?.summary || '', notes: clipText(win.output.notes, 1500), files: win.output.files.slice(0, 2).map((f) => ({ name: f.name, excerpt: clipText(f.content, 2500) })) },
        others: others.map((a) => ({ label: a.p.label, config: a.p.cfg.name, score: a.score, summary: a.verdict?.summary || (a.error ? `Failed: ${a.error}` : ''), failedChecks: a.hard.results.filter((r) => !r.pass).map((r) => r.reason) })),
        supervisor: { rationale: scored.verdict?.rationale || '', disagreements: scored.verdict?.disagreements || [], feedback: scored.verdict?.feedback || '' },
      } : null,
      reflectMap: Object.fromEntries(scored.scored.map((a) => [a.p.label, { configId: a.p.cfg.id, attemptId: a.row.id }])),
    });
    // A share of accepted tasks is set aside for your review, to measure how far to trust the supervisors.
    if (win.auditId && unitHash(`${ctx.spec.id}:review`) < ctx.s.reviewSamplePct / 100) patch('SupervisorAudit', win.auditId, { sampled: true });
    return {
      status: 'accepted', spec: T.db.get('TaskSpec', ctx.spec.id), output: win.output, model: win.row.model || ctx.route.model, score: win.score, flagged, reason: d.reason,
      winner: { label: win.p.label, configName: win.p.cfg.name, attemptId: win.row.id }, competitors: scored.scored.length,
      disagreements: scored.verdict?.disagreements || [], verdicts: criterionVerdicts(ctx, win), supervisorId: scored.supervisorId, confidence: scored.verdict?.confidence ?? null, ...extra,
    };
  }

  function escalate(ctx, scored, d, extra = {}) {
    recordAction(ctx, scored, { ...d, action: 'escalate', winnerId: null });
    if (scored?.scored.some((a) => a.p.cfg.id)) recordOutcome(ctx, scored, null);
    closeSpec(ctx, { status: 'escalated', reason: d.reason });
    return { status: 'escalated', spec: T.db.get('TaskSpec', ctx.spec.id), reason: d.reason, ...extra };
  }

  /**
   * One task, start to finish: the blind round, the reveal round when the blind one wasn't a
   * clean accept, then accept, send back (twice at most), re-split, or escalate.
   */
  async function runTask(ctx) {
    let failures = 0;
    let notes = null;
    for (let cycle = 1; cycle <= 3; cycle++) {
      const blind = cycle === 1;
      const attempts = await runRound(ctx, blind ? 'blind' : 'revise', cycle, notes || {});
      let scored = await scoreRound(ctx, attempts, blind ? 'blind' : 'revise', cycle);
      let d = decision(ctx, scored, failures);
      if (blind && attempts.filter((a) => a.output).length >= 2 && needReveal(ctx.s.reveal, d)) {
        // The second round: the finalists read the scores and each other's notes (or full drafts) and revise their own drafts.
        const drafts = ctx.s.exchange === 'drafts';
        const mode = drafts ? 'reveal' : 'notes';
        const { only } = finalistsOf(ctx, scored);
        recordAction(ctx, scored, { ...d, action: 'reveal', winnerId: null, reason: `${d.reason} ${ctx.s.finalists > 0 && only.size < scored.scored.filter((a) => a.output).length ? `The best ${only.size} go on and` : 'The workers'} ${drafts ? 'see each other’s blind drafts' : 'read the scores and each other’s notes'} and revise.` });
        const own = sendBackNotes(scored, { sentBack: false });
        const revealed = await runRound(ctx, mode, cycle, { round: roundNotes(ctx, scored, { drafts }), only, prior: own.prior, feedback: own.feedback });
        const rescored = await scoreRound(ctx, revealed, mode, cycle);
        const text = (a) => (a.output?.files || []).map((f) => f.content).join('\n');
        const herd = herding(scored.scored.filter((a) => a.output).map((a) => ({ configId: a.p.cfg.id, text: text(a), score: a.score })), rescored.scored.filter((a) => a.output).map((a) => ({ configId: a.p.cfg.id, text: text(a) })));
        patch('TaskSpec', ctx.spec.id, { herding: herd });
        const blindSharp = d.sharp;
        d = decision(ctx, rescored, failures);
        // A sharp disagreement in the blind round goes forward with the task even if the reveal settled it.
        if (blindSharp && d.action === 'accept') d = { ...d, action: 'accept_flag', reason: `${d.reason} The blind drafts disagreed sharply before the reveal round.` };
        scored = rescored;
      }
      if (d.action === 'accept' || d.action === 'accept_flag') return accept(ctx, scored, d);
      if (d.action === 'send_back') {
        recordAction(ctx, scored, d);
        failures++;
        // The finalists go back with the supervisor's notes, the scores and everyone's notes to learn from.
        const { only } = finalistsOf(ctx, scored);
        notes = { ...sendBackNotes(scored), round: roundNotes(ctx, scored), only: only.size ? only : null };
        continue;
      }
      if (d.action === 'resplit') {
        ctx.resplitUsed = true;
        const r = await resplit(ctx, scored, d);
        if (r) return r;
        return escalate(ctx, scored, { ...d, reason: `${d.reason} The task couldn't be re-split.` });
      }
      return escalate(ctx, scored, d);
    }
    return escalate(ctx, null, { action: 'escalate', reason: 'The task failed three rounds.', winnerId: null });
  }

  // ------------------------------------------------------------------ splitting a task

  /** How a task may be split again: by its rows when it writes a table, by sections when it writes a document. */
  function resplitDelegation(ctx) {
    const jobResplits = T.db.count('SupervisorAction', (x) => x.commissionId === ctx.tile.commissionId && x.action === 'resplit');
    if (ctx.spec.depth >= ctx.s.maxDepth || jobResplits >= ctx.s.maxResplitsPerJob) return null;
    const pre = new Set((ctx.base.precomputedFiles || []).map((f) => f.name));
    const files = ctx.spec.files.filter((n) => !pre.has(n));
    const rows = ctx.spec.rows || ctx.rows || null;
    const by = rows && rows.to > rows.from && files.some((f) => TABLE_FILE.test(f)) ? 'rows' : files.some((f) => DOC_FILE.test(f)) ? 'sections' : null;
    if (!by || !files.length) return null;
    const maxParts = Math.max(2, Math.min(ctx.s.maxParts, by === 'rows' ? rows.to - rows.from + 1 : ctx.s.maxParts));
    return { maxParts, by, files, ...(by === 'rows' ? { rows } : {}) };
  }

  /** Child tasks from a split plan: each competes on its own, as one part of the task. */
  function children(ctx, plan, reason) {
    const list = plan.parts.map((p, i) => ({ part: i + 1, brief: p.brief, files: p.files, ...(p.rows ? { rows: p.rows } : {}) }));
    return plan.parts.map((p, i) => {
      const spec = newSpec(ctx.tile, ctx.s, { brief: p.brief, files: p.files, rows: p.rows || null, parentSpecId: ctx.spec.id, depth: ctx.spec.depth + 1, reason });
      const { delegation, ...rest } = ctx.base;
      const base = withPre({ ...rest, part: { index: i + 1, of: plan.parts.length, brief: p.brief, files: p.files, ...(p.rows ? { rows: p.rows } : {}), plan: list } }, ctx.base);
      return { spec, base, partNo: i + 1 };
    });
  }

  /**
   * The children compete at the same time, each on its own spec. Their winning files are joined
   * by code, checked on the parent's hard checks, and scored by the parent's supervisor on the
   * parent's rubric (a branch supervisor sees the outputs its children produced).
   */
  async function runChildren(ctx, kids, plan, why) {
    activity(ctx, `${kids.length} parts competing at once`);
    const results = await Promise.all(kids.map((k) => runTask(taskContext(ctx, k.spec, k.base, { partNo: k.partNo, warm: true }))));
    const stuck = results.findIndex((r) => r.status !== 'accepted');
    if (stuck >= 0) return escalate(ctx, null, { action: 'escalate', winnerId: null, reason: `Part ${stuck + 1} of the split couldn't be settled: ${results[stuck].reason}` }, { parts: kids.length });
    const outs = results.map((r) => r.output);
    const d0 = ctx.delegation || resplitDelegation(ctx) || { files: ctx.spec.files };
    const idColumn = ctx.base.tile.acceptanceCriteria.map((c) => /^\s*csv_unique\((\w+)\)/.exec(c.rule || '')?.[1]).find(Boolean) || null;
    const joined = joinParts(outs, { expected: d0.files, idColumn });
    const output = {
      approach: [`Split into ${kids.length} parts (${why}): ${plan.parts.map((p) => p.brief).join(' | ')}`, ...results.map((r, i) => `Part ${i + 1}: ${r.winner?.configName || 'joined'} won with ${r.score.toFixed(2)}.`)],
      files: joined.files,
      notes: outs.map((o, i) => `Part ${i + 1}: ${o.notes}`).join('\n\n'),
      checklist: ctx.base.tile.acceptanceCriteria.map((c) => ({ criterionId: c.id, done: true, note: 'Each part was scored on its own; the checks ran on the joined files.' })),
      handoff: [...new Set(outs.map((o) => o.handoff).filter(Boolean))].join('\n'),
    };
    // The joined files are one more attempt at the parent task, made by code from the winners.
    const p = { cfg: { id: null, name: `Joined from ${kids.length} parts` }, label: 'A', control: false, lessons: [] };
    const attempt = await recordAttempt(ctx, { p, input: ctx.base, res: { output, model: 'joined by code', usage: null }, seconds: 0 }, 'merge', 1);
    const scored = await scoreRound(ctx, [attempt], 'merge', 1);
    const d = decide({
      attempts: [{ id: attempt.row.id, hardPass: attempt.hard.pass, score: scored.scored[0].score }], threshold: ctx.spec.threshold,
      agreement: 'high', failures: 2, resplitUsed: true, supervisor: scored.verdict ? { canJudge: scored.verdict.canJudge, confidence: scored.verdict.confidence } : {},
    });
    const extra = { parts: kids.length, split: { parts: kids.length, reason: plan.reason, report: joined.report, why } };
    if (d.action === 'accept' || d.action === 'accept_flag') {
      const flaggedKids = results.filter((r) => r.flagged);
      const r = accept(ctx, scored, flaggedKids.length && d.action === 'accept' ? { ...d, action: 'accept_flag', reason: `${d.reason} ${flaggedKids.length} part${flaggedKids.length > 1 ? 's were' : ' was'} flagged.` } : d, extra);
      return { ...r, disagreements: [...r.disagreements, ...flaggedKids.flatMap((k) => k.disagreements)], model: results[0].model };
    }
    const failed = attempt.hard.results.filter((x) => !x.pass).map((x) => x.reason);
    return escalate(ctx, scored, { ...d, reason: failed.length ? `The joined parts fail a check: ${failed.join(' ')}` : `The joined parts scored ${scored.scored[0].score.toFixed(2)}, under the ${ctx.spec.threshold} threshold.` }, extra);
  }

  /** The supervisor hands the task back to the disaggregator with its notes; the old task is replaced by children. */
  async function resplit(ctx, scored, d) {
    const delegation = resplitDelegation(ctx);
    if (!delegation) return null;
    const c = T.db.get('Commission', ctx.tile.commissionId);
    activity(ctx, 're-splitting the task');
    const past = T.db.filter('SupervisorAction', (x) => x.action === 'resplit' && x.taskType === ctx.spec.taskType && x.commissionId !== c.id).slice(-5).map((x) => x.notes).filter(Boolean);
    const input = {
      task: { title: ctx.spec.title, ...(ctx.spec.brief ? { brief: ctx.spec.brief } : {}), spec: ctx.base.tile.spec, outputs: ctx.spec.files, criteria: ctx.base.tile.acceptanceCriteria.map((x) => x.text) },
      notes: { reason: d.reason, feedback: scored.verdict?.feedback || '', tooBig: !!scored.verdict?.tooBig, mixesJobs: !!scored.verdict?.mixesJobs, disagreements: scored.verdict?.disagreements || [] },
      ...(past.length ? { pastResplits: past } : {}),
      delegation,
    };
    let plan;
    try {
      plan = (await runAgent({ agent: AGENTS.resplit, input, route: T.llm.forCommission(c, 'heavy'), log: T.log, meta: { commissionId: c.id, tileId: ctx.tile.id } })).output;
    } catch (e) {
      if (T.debug) console.warn('re-split failed:', e.message);
      return null;
    }
    const kids = children(ctx, plan, 'resplit');
    recordAction(ctx, scored, d, { newChildSpecIds: kids.map((k) => k.spec.id), notes: plan.reason });
    return runChildren({ ...ctx, delegation }, kids, plan, 're-split by the supervisor');
  }

  /**
   * Before anyone works on a long task, the lead decides whether to split it for speed. The call
   * writes the task's cache layers, so the competitors (or the parts) that follow read them.
   */
  async function decideSplit(ctx, offer) {
    const { delegation, ...rest } = ctx.base;
    const input = withPre({ ...rest, ...(ctx.playbook.length ? { playbook: { taskType: ctx.spec.taskType, lessons: ctx.playbook.map((l) => l.text) } } : {}), delegation: { ...offer.delegation, decideOnly: true } }, ctx.base);
    activity(ctx, 'deciding whether to split the tile');
    try {
      const res = await runAgent({
        agent: AGENTS.worker, input, route: ctx.route, log: T.log, maxTokens: 4000, retries: 1, cache: true,
        meta: { commissionId: ctx.tile.commissionId, tileId: ctx.tile.id, userId: ctx.tile.claimedById, competitor: 'lead · split decision' },
      });
      ctx.warm = true;
      return res.output.split || null;
    } catch (e) {
      if (T.debug) console.warn('split decision failed:', e.message);
      return null;
    }
  }

  /** Accepted upstream tasks, with any disagreement their supervisors flagged: the tree follows the plan's dependencies. */
  function upstreamOf(tile) {
    const out = [];
    for (const id of upstreamIds(T.db, tile.id)) {
      const up = T.db.get('Tile', id);
      const sub = up?.acceptedSubmissionId ? T.db.get('Submission', up.acceptedSubmissionId) : null;
      if (!sub) continue;
      out.push({ task: up.title, ...(typeof sub.supervised?.score === 'number' ? { score: sub.supervised.score } : {}), ...(sub.supervised?.flagged ? { flagged: sub.supervised.disagreements || [] } : {}) });
    }
    return out.slice(0, 12);
  }

  // ------------------------------------------------------------------ the public steps

  /**
   * A swarm tile, competed: returns the winning output (status "accepted") or the reason it
   * needs you (status "escalated").
   * @param {any} tile
   * @param {any} input the worker input from workerInput()
   * @param {{ route: any, checkRoute: any, s: any, offer?: any, rows?: { from: number, to: number }|null, userFeedback?: string|null }} opts
   */
  async function compete(tile, input, { route, checkRoute, s, offer = null, rows = null, userFeedback = null }) {
    ensureConfigs(T);
    const spec = newSpec(tile, s);
    if (input.precomputedFiles?.length) {
      // Kept with the task, so an attempt you accept from an escalation hands them in too.
      patch('TaskSpec', spec.id, { mergedFiles: await storeFiles(T, `attempts/${spec.id}/merged`, input.precomputedFiles) });
    }
    const challenger = ensureChallenger(T, s);
    const ctx = taskContext({ tile, route, checkRoute, s, rows, userFeedback, upstream: upstreamOf(tile), warm: false, challenger }, spec, input);
    if (offer) {
      const plan = await decideSplit(ctx, offer);
      if (plan) {
        const kids = children(ctx, plan, 'speed');
        recordAction(ctx, null, { action: 'split', reason: `Split for speed: ${plan.reason}`, winnerId: null, sharp: false, spread: 0 }, { newChildSpecIds: kids.map((k) => k.spec.id), by: 'lead worker' });
        return runChildren({ ...ctx, delegation: offer.delegation }, kids, plan, 'for speed');
      }
    }
    return runTask(ctx);
  }

  /** Lessons from one scored task. A failed reflection costs a lesson, never the job. */
  async function reflect(specId) {
    const spec = T.db.get('TaskSpec', specId);
    if (!spec || spec.reflect !== 'pending') return;
    const c = T.db.get('Commission', spec.commissionId);
    let out;
    try {
      out = (await runAgent({ agent: AGENTS.reflection, input: spec.reflectInput, route: T.llm.forCommission(c, 'light'), log: T.log, meta: { commissionId: c.id, tileId: spec.tileId }, batch: !!T.db.meta.settings.swarm?.batch })).output;
    } catch (e) {
      patch('TaskSpec', spec.id, { reflect: 'failed', reflectError: String(e.message || e).slice(0, 300) });
      return;
    }
    T.db.tx((tx) => {
      // Retired lessons count too: a lesson that didn't help isn't written again.
      const live = tx.filter('Lesson', (l) => l.taskType === spec.taskType);
      for (const l of out.lessons) {
        const from = spec.reflectMap[l.attempt];
        const configId = l.scope === 'personal' ? from?.configId || null : null;
        if (l.scope === 'personal' && !configId) continue;
        // A lesson the store already holds (or nearly) isn't written twice.
        if (live.some((x) => x.scope === l.scope && (x.configId || null) === configId && textSimilarity(x.text, l.text) > 0.5)) continue;
        // A personal lesson is tested against the config's own record before it (a before-and-after).
        const st = configId ? tx.find('WorkerStats', (x) => x.configId === configId && x.taskType === spec.taskType) : null;
        const n = st ? Math.min(st.attempts, 10) : 0;
        const row = tx.insert('Lesson', {
          scope: l.scope, configId, taskType: spec.taskType, text: l.text, evidence: l.evidence, sourceSpecId: spec.id, sourceAttemptIds: from ? [from.attemptId] : [],
          status: 'candidate', trialsWith: 0, scoreWith: 0, trialsWithout: n, scoreWithout: st && n ? Math.round((st.scoreSum / st.attempts) * n * 1000) / 1000 : 0,
        });
        live.push(row);
      }
      tx.update('TaskSpec', spec.id, { reflect: 'done', reflectInput: null, lessons: out.lessons.length });
    });
  }

  /** The root supervisor judges the whole delivery, with every flag raised on the way, before sign-off. */
  async function rootCheck(c) {
    const restricted = c.privacy === 'RESTRICTED';
    const flags = T.db.filter('TaskSpec', (x) => x.commissionId === c.id && x.flagged && !x.parentSpecId).map((x) => ({ task: x.title, disagreements: x.disagreements || [] }));
    const settled = T.db.filter('SupervisorAction', (x) => x.commissionId === c.id && x.by === 'requester').map((x) => ({ task: T.db.get('Tile', x.tileId)?.title || x.tileId, how: x.reason }));
    const d = c.delivery || {};
    const input = {
      job: { title: c.title, goal: clipText(restricted ? redactText(c.goal) : c.goal, 4000), requirements: (c.plan?.analysis?.requirements || []).map((r) => r.text || String(r)).slice(0, 30) },
      deliverable: { title: d.title, summary: d.summary, sections: (d.sections || []).map((s) => ({ heading: s.heading, body: clipText(s.body, 1500) })) },
      gaps: d.gaps || [], conflicts: d.conflicts || [], flags, ...(settled.length ? { settledByRequester: settled } : {}),
    };
    const res = await runAgent({ agent: AGENTS.rootSupervisor, input, route: T.llm.forCommission(c, 'heavy'), log: T.log, meta: { commissionId: c.id } });
    T.db.tx((tx) => {
      const cur = tx.get('Commission', c.id);
      tx.update('Commission', c.id, { autopilot: { ...(cur.autopilot || {}), rootCheck: { ...res.output, flags: flags.length, model: res.model, deliveredAt: cur.deliveredAt, at: tx.now() } } });
    });
    return res.output;
  }

  return { compete, reflect, rootCheck };
}

// ------------------------------------------------------------------ what you do in the dashboard

function requireOwner(T, actorId, commissionId) {
  const c = must(T.db.get('Commission', commissionId), 'Job not found.');
  const u = must(T.db.get('User', actorId), 'Unknown user.');
  if (c.requesterId !== actorId && !u.isAdmin) throw new UserError('Only the requester can settle this job’s escalated tasks.');
  return c;
}

/**
 * Settles a task the supervisor escalated to you: accept one of its attempts (action 'accept'
 * with attemptId), send it back to the competitors with your feedback ('send_back' with
 * feedback), or give it to one agent without competition ('single').
 */
export async function resolveEscalation(T, actorId, tileId, { action, attemptId = null, feedback = '' }) {
  const tile = must(T.db.get('Tile', tileId), 'Tile not found.');
  requireOwner(T, actorId, tile.commissionId);
  const sv = tile.supervision;
  if (sv?.state !== 'escalated') throw new UserError('This task isn’t waiting for you.');
  const spec = T.db.get('TaskSpec', sv.specId);
  const log = (reason, extra = {}) => T.db.tx((tx) => tx.insert('SupervisorAction', {
    specId: spec?.id || null, tileId, commissionId: tile.commissionId, taskType: spec?.taskType || null, depth: 0, cycle: null, round: null,
    action: action === 'accept' ? 'accept' : action === 'send_back' ? 'send_back' : 'single', reason, feedback: String(feedback || '').slice(0, 2000),
    disagreements: [], sharp: false, spread: 0, winnerAttemptId: null, newChildSpecIds: [], by: 'requester', actorId, ...extra,
  }));
  if (action === 'accept') {
    const att = must(attemptId && T.db.get('Attempt', attemptId), 'Pick the attempt to accept.');
    if (att.tileId !== tileId || !att.files?.length) throw new UserError('That attempt isn’t one of this task’s, or it handed in no files.');
    const files = [...await loadFileTexts(T, att.files), ...await loadFileTexts(T, spec?.mergedFiles || [])].filter((f) => typeof f.text === 'string');
    await submitWork(T, tile.claimedById, tileId, {
      files: files.map((f) => ({ name: f.name, text: f.text })), minutesSpent: 1, checklist: {},
      notes: [`Accepted by the requester from an escalated task: attempt ${att.label} (${att.configName}).`, att.approach?.map((a, i) => `${i + 1}. ${a}`).join('\n'), att.notes].filter(Boolean).join('\n\n'),
      modelUsed: `${att.model} (agent)`, handoff: att.handoff || '', supervised: { by: 'requester', actorId, specId: spec?.id || null, attemptId: att.id },
    });
    T.db.tx((tx) => {
      const cur = tx.get('Tile', tileId);
      tx.update('Tile', tileId, { supervision: { ...cur.supervision, state: 'resolved', resolvedAt: tx.now(), how: 'accepted an attempt' } });
      if (spec) tx.update('TaskSpec', spec.id, { status: 'accepted', winnerAttemptId: att.id, by: 'requester' });
      const st = att.configId && spec ? tx.find('WorkerStats', (x) => x.configId === att.configId && x.taskType === spec.taskType) : null;
      if (st) tx.update('WorkerStats', st.id, { wins: st.wins + 1 });
    });
    log(`The requester accepted attempt ${att.label} (${att.configName}).`, { winnerAttemptId: att.id });
    return;
  }
  if (action !== 'send_back' && action !== 'single') throw new UserError('Accept an attempt, send the task back, or give it to one agent.');
  const note = String(feedback || '').trim();
  if (action === 'send_back' && note.length < 10) throw new UserError('Say what the workers should change (at least 10 characters).');
  T.db.tx((tx) => {
    const cur = tx.get('Tile', tileId);
    tx.update('Tile', tileId, { supervision: { ...cur.supervision, state: action === 'single' ? 'single' : 'retry', feedback: note || null, retries: (cur.supervision.retries || 0) + 1, resolvedAt: tx.now() } });
  });
  log(action === 'single' ? 'The requester gave the task to one agent, without competition.' : 'The requester sent the task back to the competitors with feedback.');
  T.swarm?.reset();
}

/** Your verdict on an accepted task the swarm sampled for review: it scores the supervisor that accepted it. */
export function reviewAudit(T, actorId, auditId, verdict) {
  if (!['agree', 'disagree'].includes(verdict)) throw new UserError('Agree or disagree with the supervisor.');
  const a = must(T.db.get('SupervisorAudit', auditId), 'Review not found.');
  requireOwner(T, actorId, a.commissionId);
  return T.db.tx((tx) => tx.update('SupervisorAudit', auditId, { yourReview: verdict, reviewedAt: tx.now(), reviewerId: actorId }));
}

/** Retires a worker config or brings one back. At least two stay active. */
export function setWorkerConfigStatus(T, actorId, configId, status) {
  const u = must(T.db.get('User', actorId), 'Unknown user.');
  if (!u.isRequester && !u.isAdmin) throw new UserError('Switch to a requester persona to manage the swarm.');
  if (!['active', 'retired'].includes(status)) throw new UserError('A config is active or retired.');
  return T.db.tx((tx) => {
    const c = must(tx.get('WorkerConfig', configId), 'Config not found.');
    if (status === 'retired' && c.status === 'active' && tx.count('WorkerConfig', (x) => x.status === 'active') <= 2) throw new UserError('Keep at least two configs active so tasks still compete.');
    return tx.update('WorkerConfig', configId, { status, why: status === 'retired' ? 'Retired by you.' : 'Brought back by you.', ...(status === 'retired' ? { retiredAt: tx.now() } : {}) });
  }, { actor: actorId });
}
