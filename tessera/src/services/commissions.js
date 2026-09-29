// The requester side: post a commission, answer scoping questions, edit and fund the
// plan, flag high-stakes tiles, and the Scoping and Decomposer jobs behind them.
import { UserError, must, getUser, tilesOf, transitionTile, transitionCommission, postLedger, upstreamIds } from './core.js';
import { storeFiles, summarizeUpload } from './files.js';
import { AGENTS } from '../agents/index.js';
import { runAgent } from '../llm/run-agent.js';
import { TileDraft } from '../agents/schemas.js';
import { config, skillVocabulary } from '../domain/config.js';
import { priceGraph, tilePayCents, isRush } from '../domain/pricing.js';
import { validateGraph } from '../domain/graph.js';
import { calibrationRatios, calibrateEstimate } from '../domain/estimates.js';
import { fundingEntry } from '../domain/ledger.js';
import { checkFileLimits, rateLimitCheck } from '../domain/limits.js';
import { ENUMS } from '../db/schema.js';
import { fmtMoney, HOUR } from '../lib/util.js';
import { analyzeJob, disaggregate, assessQuality, repairGraph, applyFix, jobOf, compactAnalysis, compactPlan, compactQuality } from '../decompose/index.js';

function requireOwner(tx, commissionId, actorId) {
  const c = must(tx.get('Commission', commissionId), 'Commission not found.');
  if (c.requesterId !== actorId) throw new UserError('Only the requester who posted this commission can do that.');
  return c;
}

/** Checks a new commission's fields and stores its files. */
async function preparePost(T, actorId, input) {
  const user = getUser(T.db, actorId);
  if (!user.isRequester) throw new UserError('Switch to a requester persona to post a commission.');
  const now = T.clock.now();
  const recent = T.db.filter('Commission', (c) => c.requesterId === actorId).map((c) => c.createdAt);
  const rl = rateLimitCheck(recent, config.limits.commissionsPerHour, HOUR, now);
  if (!rl.ok) throw new UserError(rl.message);

  const title = String(input.title || '').trim();
  const goal = String(input.goal || '').trim();
  const budgetCents = Math.round(Number(input.budgetCents));
  const deadline = Number(input.deadline);
  const privacy = input.privacy || 'PUBLIC';
  if (title.length < 5 || title.length > 120) throw new UserError('Give the commission a title of 5 to 120 characters.');
  if (goal.length < 20) throw new UserError('Describe the goal in at least a sentence or two (20+ characters).');
  if (goal.length > 6000) throw new UserError('Keep the goal under 6,000 characters; attach longer material as a file.');
  if (!Number.isFinite(budgetCents) || budgetCents < 5000 || budgetCents > 10000000) throw new UserError('Set a budget between $50 and $100,000.');
  if (!Number.isFinite(deadline) || deadline < now + HOUR) throw new UserError('Set a deadline at least an hour from now.');
  if (!ENUMS.Privacy.includes(privacy)) throw new UserError('Unknown privacy level.');

  const files = input.files || [];
  const errs = checkFileLimits(files.map((f) => ({ name: f.name, size: f.bytes ? f.bytes.length : (f.text || '').length })));
  if (errs.length) throw new UserError(errs.join(' '));
  const refs = await storeFiles(T, `commission-uploads/${actorId}`, files);
  refs.forEach((r, i) => {
    const f = files[i];
    const bytes = f.bytes || new TextEncoder().encode(f.text || '');
    r.summary = summarizeUpload(r.name, bytes, { restricted: privacy === 'RESTRICTED' });
  });
  return { title, goal, budgetCents, deadline, privacy, language: input.language || 'en', refs, ...workforceOf(input, now) };
}

/** Who does the work: the exchange's people (the default) or the agent swarm, run on autopilot. */
function workforceOf(input, now) {
  if (input.workforce !== 'agents') return { workforce: 'people' };
  return { workforce: 'agents', autopilot: { state: 'RUNNING', startedAt: now, note: null } };
}

export async function postCommission(T, actorId, input) {
  if (input.plan) return postCommissionWithPlan(T, actorId, input);
  const { title, goal, budgetCents, deadline, privacy, refs, workforce, autopilot } = await preparePost(T, actorId, input);
  return T.db.tx((tx) => {
    const c = tx.insert('Commission', {
      requesterId: actorId, title, goal, budgetCents, deadline, privacy, language: input.language || 'en',
      clarifications: { questions: [], answers: {} }, status: 'DRAFT', files: refs, plan: null, delivery: null, workforce, autopilot: autopilot || null,
    });
    transitionCommission(tx, c.id, 'SCOPING', actorId, { note: 'Posted' });
    tx.enqueue('scope', { commissionId: c.id }, { dedupeKey: `scope:${c.id}` });
    return tx.get('Commission', c.id);
  }, { actor: actorId });
}

function commissionForPrompt(c) {
  return {
    title: c.title, goal: c.goal, budgetUsd: c.budgetCents / 100,
    deadline: new Date(c.deadline).toISOString(), privacy: c.privacy, language: c.language,
  };
}

export async function runScopingJob(T, { commissionId }) {
  const c = T.db.get('Commission', commissionId);
  if (!c || c.status !== 'SCOPING' || c.clarifications.scopedAt) return;
  const input = { commission: commissionForPrompt(c), files: c.files.map((f) => ({ name: f.name, summary: f.summary })) };
  const { output } = await runAgent({ agent: AGENTS.scoping, input, route: T.llm.forCommission(c, 'heavy'), log: T.log, meta: { commissionId } });
  T.db.tx((tx) => {
    const cur = tx.get('Commission', commissionId);
    if (cur.status !== 'SCOPING') return;
    const questions = output.questions.slice(0, config.scoping.maxQuestions);
    tx.update('Commission', commissionId, { clarifications: { ...cur.clarifications, questions, scopedAt: tx.now() }, planError: null });
    if (!questions.length) {
      tx.update('Commission', commissionId, { planState: 'DECOMPOSING' });
      tx.enqueue('decompose', { commissionId }, { dedupeKey: `decompose:${commissionId}` });
    }
  });
}

export function answerScoping(T, actorId, commissionId, answers) {
  return T.db.tx((tx) => {
    const c = requireOwner(tx, commissionId, actorId);
    if (c.status !== 'SCOPING' || !c.clarifications.scopedAt) throw new UserError('Scoping questions aren’t ready yet.');
    const clean = {};
    for (const q of c.clarifications.questions) clean[q.id] = String(answers[q.id] ?? '').trim().slice(0, 1000);
    tx.update('Commission', commissionId, { clarifications: { ...c.clarifications, answers: clean, answeredAt: tx.now() }, planState: 'DECOMPOSING', planError: null });
    tx.enqueue('decompose', { commissionId }, { dedupeKey: `decompose:${commissionId}` });
  }, { actor: actorId });
}

function calibrationFor(tx) {
  const samples = [];
  for (const s of tx.all('Submission')) {
    const t = tx.get('Tile', s.tileId);
    if (!t || t.status !== 'ACCEPTED' || t.acceptedSubmissionId !== s.id || t.dynamic) continue;
    // An agent's minutes say nothing about how long a person takes.
    if (tx.get('User', s.contributorId)?.isAgent) continue;
    samples.push({ tags: t.skillTags, estMinutes: t.estMinutes, minutesSpent: s.minutesSpent });
  }
  return calibrationRatios(samples);
}

/**
 * The Decomposer's input: the commission plus the engine's reading of it and, for a real
 * model, the engine's own split to start from.
 */
export function decomposerInput(c, { instruction = null, ratios = {}, rush = false, reference = true } = {}) {
  const analysis = analyzeJob(jobOf(c, { instruction }));
  /** @type {any} */
  const input = {
    commission: commissionForPrompt(c),
    clarifications: { questions: c.clarifications?.questions || [], answers: c.clarifications?.answers || {} },
    files: (c.files || []).map((f) => ({ name: f.name, summary: f.summary })),
    estimateCalibration: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, v.ratio])),
    ...(instruction ? { requesterInstruction: instruction } : {}),
    analysis: compactAnalysis(analysis),
  };
  if (reference) {
    const ref = disaggregate(jobOf(c, { instruction }), { maxTotalCents: c.budgetCents, rush, maxTiles: 60 });
    input.referencePlan = compactPlan(ref.tiles);
  }
  return { input, analysis };
}

/**
 * Makes any plan valid, grades it, and for a model-made plan that grades below C asks the
 * model once to fix what the report found.
 */
/** @param {any} T @param {any[]} tiles @param {any} analysis @param {{ route?: any, meta?: object, commission?: any }} [opts] */
export async function finishPlan(T, tiles, analysis, opts = {}) {
  const { route = null, meta = {}, commission = null } = opts;
  const repaired = repairGraph(tiles);
  let out = repaired.tiles;
  let quality = assessQuality(out, analysis);
  const changes = [...repaired.changes];
  let refined = false;
  if (route && route.providerName !== 'mock' && quality.score < 70) {
    try {
      const res = await runAgent({ agent: AGENTS.decomposerRefine, input: { commission, analysis: compactAnalysis(analysis), tiles: out, quality: compactQuality(quality) }, route, log: T.log, meta });
      const again = repairGraph(res.output.tiles);
      const q2 = assessQuality(again.tiles, analysis);
      if (q2.score >= quality.score) { out = again.tiles; quality = q2; changes.push(res.output.rationale, ...again.changes); refined = true; }
    } catch (e) {
      changes.push(`The refine pass failed (${e.message}); kept the first plan.`);
    }
  }
  return { tiles: out, quality, changes, refined };
}

const PLAN_FIELDS = ['inputs', 'outputs', 'stream', 'phase', 'archetype', 'partOf', 'part', 'covers', 'priority', 'handoff', 'agentMode', 'collapsed', 'webResearch', 'independentCheck'];

function insertPlanTiles(tx, commissionId, tiles, rush) {
  const idByKey = new Map();
  for (const t of tiles) {
    const extra = Object.fromEntries(PLAN_FIELDS.filter((f) => t[f] !== undefined).map((f) => [f, t[f]]));
    const row = tx.insert('Tile', {
      commissionId, key: t.key, kind: t.kind, title: t.title, spec: t.spec, deliverableFormat: t.deliverableFormat,
      acceptanceCriteria: t.acceptanceCriteria, skillTags: t.skillTags, tier: t.tier, estMinutes: t.estMinutes,
      originalEstMinutes: t.originalEstMinutes ?? t.estMinutes, calibration: t.calibration || null, payCents: tilePayCents(t, { rush }),
      sensitiveInputs: t.sensitiveInputs || [], languages: t.languages || [], status: 'DRAFT', claimedById: null,
      claimExpiresAt: null, revisionCount: 0, highStakes: !!t.highStakes, dynamic: false, reviewOf: null, excludedUserIds: [], ...extra,
    });
    idByKey.set(t.key, row.id);
  }
  for (const t of tiles) {
    for (const d of t.dependsOn || []) if (idByKey.has(d)) tx.insert('TileEdge', { id: `edg_${idByKey.get(d)}_${idByKey.get(t.key)}`, fromTileId: idByKey.get(d), toTileId: idByKey.get(t.key) });
  }
  return idByKey;
}

function clearDraftTiles(tx, commissionId) {
  for (const old of tilesOf(tx, commissionId)) {
    for (const e of tx.filter('TileEdge', (x) => x.toTileId === old.id || x.fromTileId === old.id)) tx.remove('TileEdge', e.id);
    tx.remove('Tile', old.id);
  }
}

export async function runDecomposeJob(T, { commissionId, instruction = null }) {
  const c = T.db.get('Commission', commissionId);
  if (!c || c.status !== 'SCOPING') return;
  const now = T.clock.now();
  const rush = isRush(c.deadline, now);
  const ratios = calibrationFor(T.db);
  const route = T.llm.forCommission(c, 'heavy');
  const { input: base, analysis } = decomposerInput(c, { instruction, ratios, rush, reference: route.providerName !== 'mock' });
  /** @type {any} */
  let input = base;
  let attempt = 0;
  let graph;
  let tiles;
  let priced;
  let finished;
  for (;;) {
    const res = await runAgent({ agent: AGENTS.decomposer, input: { ...input, skillVocabulary }, route, log: T.log, meta: { commissionId } });
    graph = res.output;
    finished = await finishPlan(T, graph.tiles, analysis, { route, meta: { commissionId }, commission: base.commission });
    tiles = finished.tiles.map((t) => {
      const cal = calibrateEstimate(t.estMinutes, t.skillTags, ratios);
      const changed = cal.tagsUsed.length && cal.estMinutes !== t.estMinutes;
      return { ...t, originalEstMinutes: t.estMinutes, estMinutes: cal.estMinutes, calibration: changed ? { ratio: cal.ratio, tags: cal.tagsUsed } : null };
    });
    priced = priceGraph(tiles, { rush });
    if (priced.total <= c.budgetCents || attempt >= config.budgetRetries) break;
    attempt += 1;
    input = {
      ...base,
      scopeInstruction: {
        maxTotalCents: c.budgetCents, previousTotalCents: priced.total, rush,
        message: `The last graph priced at ${fmtMoney(priced.total)} including fees and the peer review reserve, over the ${fmtMoney(c.budgetCents)} budget. Propose a smaller scope that fits. Don't lower estimates below realistic time; rates are fixed.`,
      },
    };
  }
  T.db.tx((tx) => {
    const cur = tx.get('Commission', commissionId);
    if (cur.status !== 'SCOPING') return;
    clearDraftTiles(tx, commissionId);
    insertPlanTiles(tx, commissionId, tiles, rush);
    tx.update('Commission', commissionId, {
      planState: null,
      planError: null,
      plan: {
        rationale: graph.rationale, attempts: attempt + 1, overBudget: priced.total > cur.budgetCents,
        pricing: { total: priced.total, payTotal: priced.payTotal, feeTotal: priced.feeTotal, reserveTotal: priced.reserveTotal, rush },
        decomposedAt: tx.now(), instruction, source: route.providerName === 'mock' ? 'engine' : 'model',
        analysis: compactAnalysis(analysis), quality: compactQuality(finished.quality),
        repairs: finished.changes.filter(Boolean).slice(0, 20), refined: finished.refined,
      },
    });
    transitionCommission(tx, commissionId, 'PLANNED', 'decomposer', { note: `${tiles.length} tiles` });
  });
}

/** The draft graph in Decomposer shape, with dependsOn keys rebuilt from edges. */
export function draftGraph(db, commissionId) {
  const tiles = tilesOf(db, commissionId).filter((t) => !t.dynamic);
  const keyById = new Map(tiles.map((t) => [t.id, t.key]));
  return tiles.map((t) => ({ ...t, dependsOn: upstreamIds(db, t.id).map((id) => keyById.get(id)).filter(Boolean) }));
}

export function quote(db, commissionId, now) {
  const c = db.get('Commission', commissionId);
  const rush = isRush(c.deadline, now);
  const tiles = draftGraph(db, commissionId).filter((t) => t.status !== 'CANCELLED');
  const priced = priceGraph(tiles, { rush });
  return { ...priced, overBudget: priced.total > c.budgetCents, issues: validateGraph(tiles) };
}

function requirePlanned(tx, tileId, actorId) {
  const t = must(tx.get('Tile', tileId), 'Tile not found.');
  const c = requireOwner(tx, t.commissionId, actorId);
  if (c.status !== 'PLANNED' || t.status !== 'DRAFT') throw new UserError('Tiles can only be edited while the plan is waiting for approval.');
  return { t, c };
}

function setDependencies(tx, tile, dependsOnKeys) {
  const siblings = tilesOf(tx, tile.commissionId);
  const idByKey = new Map(siblings.map((s) => [s.key, s.id]));
  for (const e of tx.filter('TileEdge', (x) => x.toTileId === tile.id)) tx.remove('TileEdge', e.id);
  for (const k of dependsOnKeys) {
    const from = idByKey.get(k);
    if (!from) throw new UserError(`No tile has the key "${k}".`);
    tx.insert('TileEdge', { id: `edg_${from}_${tile.id}`, fromTileId: from, toTileId: tile.id });
  }
}

function assertValidGraph(tx, commissionId) {
  const issues = validateGraph(draftGraph(tx, commissionId).filter((t) => t.status !== 'CANCELLED'));
  const blocking = issues.filter((i) => ['cycle', 'missing-dependency', 'self-dependency', 'duplicate-key', 'duplicate-criterion'].includes(i.code));
  if (blocking.length) throw new UserError(blocking.map((i) => i.message).join(' '));
}

export function updateDraftTile(T, actorId, tileId, patch) {
  return T.db.tx((tx) => {
    const { t, c } = requirePlanned(tx, tileId, actorId);
    const current = draftGraph(tx, c.id).find((x) => x.id === tileId);
    const merged = { ...current, ...patch };
    const parsed = TileDraft.safeParse(merged);
    if (!parsed.success) throw new UserError(`Check the tile: ${parsed.error.message}`);
    const d = parsed.data;
    if (d.key !== t.key && tilesOf(tx, c.id).some((o) => o.key === d.key && o.id !== t.id)) throw new UserError(`Another tile already uses the key "${d.key}".`);
    tx.update('Tile', tileId, {
      key: d.key, kind: d.kind, title: d.title, spec: d.spec, deliverableFormat: d.deliverableFormat,
      acceptanceCriteria: d.acceptanceCriteria, skillTags: d.skillTags, tier: d.tier, estMinutes: d.estMinutes,
      languages: d.languages, sensitiveInputs: d.sensitiveInputs,
      highStakes: patch.highStakes ?? t.highStakes,
      payCents: tilePayCents(d, { rush: isRush(c.deadline, tx.now()) }),
      editedByRequester: true,
    });
    if (patch.dependsOn) setDependencies(tx, tx.get('Tile', tileId), d.dependsOn);
    assertValidGraph(tx, c.id);
    return tx.get('Tile', tileId);
  }, { actor: actorId });
}

export function addDraftTile(T, actorId, commissionId, draft = {}) {
  return T.db.tx((tx) => {
    const c = requireOwner(tx, commissionId, actorId);
    if (c.status !== 'PLANNED') throw new UserError('Tiles can only be added while the plan is waiting for approval.');
    const keys = new Set(tilesOf(tx, commissionId).map((t) => t.key));
    let n = 1;
    while (keys.has(`new-tile-${n}`)) n++;
    const d = TileDraft.parse({
      key: `new-tile-${n}`, kind: 'WORK', title: 'New tile', deliverableFormat: 'Markdown file',
      spec: 'Describe the work, its inputs and the exact files to deliver.',
      acceptanceCriteria: [{ id: 'c1', text: 'The deliverable matches the spec', check: 'LLM' }],
      skillTags: ['research'], tier: 2, estMinutes: 60, dependsOn: [], ...draft,
    });
    const row = tx.insert('Tile', {
      commissionId, key: d.key, kind: d.kind, title: d.title, spec: d.spec, deliverableFormat: d.deliverableFormat,
      acceptanceCriteria: d.acceptanceCriteria, skillTags: d.skillTags, tier: d.tier, estMinutes: d.estMinutes,
      originalEstMinutes: d.estMinutes, calibration: null, payCents: tilePayCents(d, { rush: isRush(c.deadline, tx.now()) }),
      sensitiveInputs: d.sensitiveInputs, languages: d.languages, status: 'DRAFT', claimedById: null, claimExpiresAt: null,
      revisionCount: 0, highStakes: false, dynamic: false, reviewOf: null, excludedUserIds: [], editedByRequester: true,
    });
    if (d.dependsOn.length) setDependencies(tx, row, d.dependsOn);
    assertValidGraph(tx, commissionId);
    return row;
  }, { actor: actorId });
}

export function deleteDraftTile(T, actorId, tileId) {
  return T.db.tx((tx) => {
    const { t, c } = requirePlanned(tx, tileId, actorId);
    const ups = upstreamIds(tx, tileId);
    for (const e of tx.filter('TileEdge', (x) => x.fromTileId === tileId)) {
      tx.remove('TileEdge', e.id);
      for (const u of ups) if (!tx.get('TileEdge', `edg_${u}_${e.toTileId}`)) tx.insert('TileEdge', { id: `edg_${u}_${e.toTileId}`, fromTileId: u, toTileId: e.toTileId });
    }
    for (const e of tx.filter('TileEdge', (x) => x.toTileId === tileId)) tx.remove('TileEdge', e.id);
    tx.remove('Tile', t.id);
    if (!tilesOf(tx, c.id).length) throw new UserError('A plan needs at least one tile.');
  }, { actor: actorId });
}

export function redecompose(T, actorId, commissionId, instruction = '') {
  return T.db.tx((tx) => {
    const c = requireOwner(tx, commissionId, actorId);
    transitionCommission(tx, commissionId, 'SCOPING', actorId, { note: 'Asked for a new plan', patch: { planState: 'DECOMPOSING', planError: null } });
    tx.enqueue('decompose', { commissionId, instruction: String(instruction || '').slice(0, 1000) || null }, { dedupeKey: `decompose:${c.id}` });
  }, { actor: actorId });
}

/** Approves the plan: funds escrow for pay, fees and the review reserve, then opens tiles. */
export function fundCommission(T, actorId, commissionId, { acceptOverBudget = false } = {}) {
  return T.db.tx((tx) => {
    const c = requireOwner(tx, commissionId, actorId);
    if (c.status !== 'PLANNED') throw new UserError('Only a planned commission can be funded.');
    const now = tx.now();
    if (c.deadline <= now) throw new UserError('The deadline has passed. Post the commission again with a new deadline.');
    const rush = isRush(c.deadline, now);
    const tiles = draftGraph(tx, commissionId);
    assertValidGraph(tx, commissionId);
    for (const t of tiles) tx.update('Tile', t.id, { payCents: tilePayCents(t, { rush }), rush });
    const priced = priceGraph(tiles, { rush });
    if (priced.total > c.budgetCents && !acceptOverBudget) {
      throw new UserError(`The plan costs ${fmtMoney(priced.total)}, over your ${fmtMoney(c.budgetCents)} budget. Cut tiles, ask for a smaller plan, or confirm funding above budget.`);
    }
    postLedger(tx, [fundingEntry({ commissionId, funderId: actorId, amountCents: priced.total, memo: `Escrow: ${fmtMoney(priced.payTotal)} tile pay + ${fmtMoney(priced.feeTotal)} platform fee + ${fmtMoney(priced.reserveTotal)} peer review reserve` })]);
    transitionCommission(tx, commissionId, 'FUNDED', actorId, { patch: { fundedAt: now, fundedCents: priced.total, rush } });
    transitionCommission(tx, commissionId, 'ACTIVE', 'system');
    for (const t of tiles) {
      const hasUp = upstreamIds(tx, t.id).length > 0;
      transitionTile(tx, t.id, hasUp ? 'LOCKED' : 'OPEN', 'system', { note: hasUp ? 'Waiting on upstream tiles' : 'Funded' });
    }
    return tx.get('Commission', commissionId);
  }, { actor: actorId });
}

export function setHighStakes(T, actorId, tileId, highStakes) {
  return T.db.tx((tx) => {
    const t = must(tx.get('Tile', tileId), 'Tile not found.');
    requireOwner(tx, t.commissionId, actorId);
    if (t.status === 'ACCEPTED' || t.status === 'CANCELLED') throw new UserError('This tile is finished.');
    return tx.update('Tile', tileId, { highStakes: !!highStakes });
  }, { actor: actorId });
}

export function cancelCommission(T, actorId, commissionId) {
  return T.db.tx((tx) => {
    const c = requireOwner(tx, commissionId, actorId);
    if (!['DRAFT', 'SCOPING', 'PLANNED', 'ACTIVE'].includes(c.status)) throw new UserError(`A ${c.status.toLowerCase()} commission can’t be cancelled.`);
    const tiles = tilesOf(tx, commissionId);
    if (tiles.some((t) => t.status === 'SUBMITTED' || t.status === 'IN_REVIEW')) throw new UserError('Some tiles are being reviewed. Cancel after those reviews finish.');
    for (const t of tiles) {
      if (['OFFERED', 'CLAIMED', 'REVISION'].includes(t.status)) transitionTile(tx, t.id, 'OPEN', actorId, { note: 'Commission cancelled' });
    }
    for (const t of tilesOf(tx, commissionId)) {
      if (['DRAFT', 'LOCKED', 'OPEN'].includes(t.status)) transitionTile(tx, t.id, 'CANCELLED', actorId, { note: 'Commission cancelled' });
    }
    transitionCommission(tx, commissionId, 'CANCELLED', actorId, { note: 'Cancelled by the requester' });
  }, { actor: actorId });
}

/** Posts a commission with a plan made in the breakdown tool, skipping scoping and the Decomposer. */
export async function postCommissionWithPlan(T, actorId, input) {
  const { title, goal, budgetCents, deadline, privacy, language, refs, workforce, autopilot } = await preparePost(T, actorId, input);
  const plan = input.plan;
  const draft = repairGraph(plan.tiles || []).tiles;
  const bad = draft.map((t) => TileDraft.safeParse(t)).find((p) => !p.success);
  if (bad) throw new UserError(`The plan has a tile that doesn’t check out: ${bad.error.message}`);
  const issues = validateGraph(draft).filter((i) => i.code !== 'no-work');
  if (issues.length) throw new UserError(issues.map((i) => i.message).join(' '));
  const now = T.clock.now();
  const rush = isRush(deadline, now);
  const analysis = analyzeJob({ title, goal, files: refs, privacy, language });
  const quality = assessQuality(draft, analysis);
  const priced = priceGraph(draft, { rush });
  return T.db.tx((tx) => {
    const c = tx.insert('Commission', {
      requesterId: actorId, title, goal, budgetCents, deadline, privacy, language,
      clarifications: { questions: [], answers: {}, scopedAt: now, answeredAt: now }, status: 'DRAFT', files: refs, plan: null, delivery: null,
      workforce, autopilot: autopilot || null,
    });
    transitionCommission(tx, c.id, 'SCOPING', actorId, { note: 'Posted with a plan from the breakdown tool' });
    insertPlanTiles(tx, c.id, draft, rush);
    tx.update('Commission', c.id, {
      planState: null, planError: null,
      plan: {
        rationale: plan.rationale || 'Planned in the breakdown tool.', attempts: 0, overBudget: priced.total > budgetCents,
        pricing: { total: priced.total, payTotal: priced.payTotal, feeTotal: priced.feeTotal, reserveTotal: priced.reserveTotal, rush },
        decomposedAt: now, instruction: null, source: plan.source || 'breakdown', analysis: compactAnalysis(analysis), quality: compactQuality(quality), repairs: [],
      },
    });
    transitionCommission(tx, c.id, 'PLANNED', actorId, { note: `${draft.length} tiles from the breakdown tool` });
    return tx.get('Commission', c.id);
  }, { actor: actorId });
}

/** Replaces a planned commission's draft tiles with an edited plan (split, merge, fix). */
export function replacePlan(T, actorId, commissionId, tiles, note = 'Edited the plan') {
  return T.db.tx((tx) => {
    const c = requireOwner(tx, commissionId, actorId);
    if (c.status !== 'PLANNED') throw new UserError('The plan can only be changed while it waits for approval.');
    const bad = tiles.map((t) => TileDraft.safeParse(t)).find((p) => !p.success);
    if (bad) throw new UserError(`Check the tile: ${bad.error.message}`);
    const blocking = validateGraph(tiles).filter((i) => ['cycle', 'missing-dependency', 'self-dependency', 'duplicate-key', 'duplicate-criterion'].includes(i.code));
    if (blocking.length) throw new UserError(blocking.map((i) => i.message).join(' '));
    const rush = isRush(c.deadline, tx.now());
    const high = new Map(tilesOf(tx, commissionId).map((t) => [t.key, t.highStakes]));
    clearDraftTiles(tx, commissionId);
    insertPlanTiles(tx, commissionId, tiles.map((t) => ({ ...t, highStakes: high.get(t.key) || false, editedByRequester: true })), rush);
    const analysis = c.plan?.analysis ? { requirements: c.plan.analysis.requirements || [] } : null;
    tx.update('Commission', commissionId, { plan: { ...c.plan, quality: compactQuality(assessQuality(tiles, analysis)), edits: [...(c.plan?.edits || []), { at: tx.now(), note }].slice(-30) } });
    return tx.get('Commission', commissionId);
  }, { actor: actorId });
}

/** Applies one fix (split, merge, add a wait, add an assembly tile, repair) to a planned commission. */
export function applyPlanFix(T, actorId, commissionId, fix) {
  const current = draftGraph(T.db, commissionId).filter((t) => t.status !== 'CANCELLED');
  let next;
  try { next = applyFix(current, fix); } catch (e) { throw new UserError(e.message); }
  const note = { split: 'Split a tile', merge: 'Merged tiles', addEdge: 'Added a missing wait', addIntegration: 'Added a final assembly tile', repair: 'Repaired the plan', drop: 'Removed a tile', cover: 'Covered a requirement' }[fix.op] || 'Edited the plan';
  return replacePlan(T, actorId, commissionId, next, note);
}

/**
 * The breakdown tool: splits any job without posting it. With a real platform model and
 * useModel, the Decomposer starts from the engine's reading and reference plan.
 */
export async function breakdown(T, job, { useModel = false, budgetCents = null, rush = false } = {}) {
  const base = disaggregate(job, { maxTotalCents: budgetCents, rush });
  const route = T.llm.platform('heavy');
  if (!useModel || route.providerName === 'mock') return { ...base, source: 'engine', model: null };
  const c = { title: job.title || 'Untitled job', goal: job.goal || '', budgetCents: budgetCents || 1000000, deadline: T.clock.now() + 14 * 24 * HOUR, privacy: job.privacy || 'PUBLIC', language: job.language || 'en', clarifications: { questions: [], answers: job.answers || {} }, files: job.files || [] };
  const { input } = decomposerInput(c, { rush });
  const res = await runAgent({ agent: AGENTS.decomposer, input: { ...input, skillVocabulary }, route, log: T.log, meta: { breakdown: true } });
  const finished = await finishPlan(T, res.output.tiles, base.analysis, { route, meta: { breakdown: true }, commission: input.commission });
  return { ...base, tiles: finished.tiles, quality: finished.quality, rationale: res.output.rationale, repairs: finished.changes, source: 'model', model: route.label, pricing: priceGraph(finished.tiles, { rush }) };
}
