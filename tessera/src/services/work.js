// Doing and checking the work: briefs, the copilot, submissions, the verification
// pipeline (AUTO checks → LLM Reviewer with escalation → peer review when required),
// revisions, reopening after two failed rounds, and partial pay.
import { UserError, must, getUser, profileOf, transitionTile, postLedger, postReputation, upstreamIds, tilesOf } from './core.js';
import { storeFiles, loadFileTexts, excerptFor } from './files.js';
import { runAutoChecks } from '../domain/autochecks.js';
import { peerReviewDecision } from '../domain/review-policy.js';
import { reviewPayCents, feeCents } from '../domain/pricing.js';
import { uncommittedCents, fundingEntry, partialPayEntries } from '../domain/ledger.js';
import { checkFileLimits, rateLimitCheck } from '../domain/limits.js';
import { config } from '../domain/config.js';
import { claimLockMs } from '../domain/matching.js';
import { AGENTS } from '../agents/index.js';
import { runAgent } from '../llm/run-agent.js';
import { redactText } from '../lib/redact.js';
import { HOUR, fmtMoney } from '../lib/util.js';

/** Files from accepted upstream tiles: a tile's only inputs besides its spec. */
export function upstreamFiles(db, tileId) {
  const tile = db.get('Tile', tileId);
  const out = [];
  const ids = tile.reworkOf ? [...upstreamIds(db, tile.reworkOf), tile.reworkOf] : upstreamIds(db, tileId);
  for (const upId of ids) {
    const up = db.get('Tile', upId);
    if (!up || up.status !== 'ACCEPTED' || !up.acceptedSubmissionId) continue;
    const sub = db.get('Submission', up.acceptedSubmissionId);
    for (const f of sub?.files || []) out.push({ ...f, fromTile: up.key, fromTitle: up.title });
  }
  return out;
}

function requireHolder(tx, tileId, actorId, statuses = ['CLAIMED', 'REVISION']) {
  const tile = must(tx.get('Tile', tileId), 'Tile not found.');
  if (tile.claimedById !== actorId) throw new UserError('You don’t hold this tile.');
  if (!statuses.includes(tile.status)) throw new UserError(`This tile is ${tile.status.toLowerCase().replace('_', ' ')}.`);
  return tile;
}

// ---------------------------------------------------------------- briefs + copilot

function tileForContributor(db, tile) {
  const c = db.get('Commission', tile.commissionId);
  const restricted = c.privacy === 'RESTRICTED';
  return {
    title: tile.title,
    spec: restricted ? redactText(tile.spec) : tile.spec,
    deliverableFormat: tile.deliverableFormat,
    acceptanceCriteria: tile.acceptanceCriteria.map((x) => ({ id: x.id, text: x.text, check: x.check, ...(x.rule ? { rule: x.rule } : {}) })),
    skillTags: tile.skillTags, estMinutes: tile.estMinutes, sensitiveInputs: tile.sensitiveInputs || [],
  };
}

/**
 * Runs the Translator on the contributor's own model (falling back to the shared model if
 * theirs can't be reached) and saves the brief. Rejects briefs whose checklist doesn't map
 * one to one onto the criteria; runAgent regenerates them.
 */
export async function generateBrief(T, actorId, tileId) {
  const tile = requireHolder(T.db, tileId, actorId, ['CLAIMED', 'REVISION', 'SUBMITTED', 'IN_REVIEW']);
  const user = getUser(T.db, actorId);
  const profile = must(profileOf(T.db, actorId), 'Set up your contributor profile first.');
  const input = {
    tile: tileForContributor(T.db, tile),
    contributor: {
      skills: profile.skills, tools: profile.tools, languages: profile.languages, briefStyle: profile.briefStyle,
    },
    language: profile.briefLanguage || profile.languages[0] || 'en',
    upstreamFiles: upstreamFiles(T.db, tileId).map((f) => f.name),
  };
  const meta = { commissionId: tile.commissionId, tileId, userId: actorId };
  let route = T.llm.contributor(user, profile);
  let fallbackNote = route.fallback || null;
  let result;
  try {
    result = await runAgent({ agent: AGENTS.translator, input, route, log: T.log, meta });
  } catch (e) {
    if (!route.own) throw e;
    fallbackNote = `Your model failed (${e.message}). The shared model wrote this brief instead.`;
    route = T.llm.platform('heavy');
    result = await runAgent({ agent: AGENTS.translator, input, route, log: T.log, meta });
  }
  return T.db.tx((tx) => tx.insert('Brief', {
    tileId, userId: actorId, content: result.output, model: result.model, provider: result.provider,
    language: input.language, style: profile.briefStyle, fallbackNote,
  }));
}

export function latestBrief(db, tileId, userId) {
  return db.filter('Brief', (b) => b.tileId === tileId && b.userId === userId).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export async function askCopilot(T, actorId, tileId, question, history = []) {
  const tile = must(T.db.get('Tile', tileId), 'Tile not found.');
  if (tile.claimedById !== actorId) throw new UserError('The copilot is available to whoever holds the tile.');
  const user = getUser(T.db, actorId);
  const profile = profileOf(T.db, actorId);
  const brief = latestBrief(T.db, tileId, actorId);
  const input = {
    question: String(question).slice(0, 2000),
    context: {
      tile: tileForContributor(T.db, tile), brief: brief?.content || null,
      inputs: upstreamFiles(T.db, tileId).map((f) => f.name), pay: fmtMoney(tile.payCents),
    },
  };
  const route = T.llm.contributor(user, profile);
  const res = await runAgent({ agent: AGENTS.copilot, input, route, log: T.log, history: history.slice(-8), meta: { commissionId: tile.commissionId, tileId, userId: actorId }, maxTokens: 2000 });
  return { answer: res.output, model: res.model };
}

// ---------------------------------------------------------------- submissions

export async function submitWork(T, actorId, tileId, { files = [], notes = '', minutesSpent, checklist = {}, modelUsed = null, handoff = '' }) {
  const tile = requireHolder(T.db, tileId, actorId);
  if (tile.kind === 'REVIEW' && tile.dynamic) throw new UserError('Peer review tiles are submitted with the review form.');
  if (!files.length) throw new UserError('Attach at least one file.');
  const errs = checkFileLimits(files.map((f) => ({ name: f.name, size: f.bytes ? f.bytes.length : new TextEncoder().encode(f.text || '').length })));
  if (errs.length) throw new UserError(errs.join(' '));
  const now = T.clock.now();
  const agent = !!getUser(T.db, actorId).isAgent;
  const mine = agent ? [] : T.db.filter('Submission', (s) => s.contributorId === actorId).map((s) => s.createdAt);
  const rl = rateLimitCheck(mine, config.limits.submissionsPerHour, HOUR, now);
  if (!rl.ok) throw new UserError(rl.message);
  const minutes = Math.round(Number(minutesSpent));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) throw new UserError('Report the minutes you spent (1 to 1,440).');
  const round = (tile.revisionCount || 0) + 1;
  const refs = await storeFiles(T, `submissions/${tileId}/r${round}`, files);
  return T.db.tx((tx) => {
    const cur = requireHolder(tx, tileId, actorId);
    const sub = tx.insert('Submission', {
      tileId, commissionId: cur.commissionId, contributorId: actorId, round, notes: String(notes).slice(0, 4000),
      minutesSpent: minutes, files: refs, checklist, modelUsed, ...(handoff ? { handoff: String(handoff).slice(0, 2000) } : {}),
    });
    transitionTile(tx, tileId, 'SUBMITTED', actorId, { submissionId: sub.id, patch: { lastSubmissionId: sub.id }, note: `Round ${round}` });
    return sub;
  }, { actor: actorId });
}

/** How many WORK or INTEGRATION tiles a contributor has had accepted (for the first-five rule). */
function priorAcceptedWork(db, userId) {
  return db.filter('Tile', (t) => t.claimedById === userId && t.status === 'ACCEPTED' && !t.dynamic && t.kind !== 'REVIEW').length;
}

export async function runVerifyJob(T, { submissionId }) {
  const sub = T.db.get('Submission', submissionId);
  if (!sub) return;
  let tile = T.db.get('Tile', sub.tileId);
  if (tile.status === 'SUBMITTED' && tile.lastSubmissionId === sub.id) {
    T.db.tx((tx) => transitionTile(tx, tile.id, 'IN_REVIEW', 'verifier', { note: 'Automatic checks started' }));
    tile = T.db.get('Tile', sub.tileId);
  }
  if (tile.status !== 'IN_REVIEW' || tile.lastSubmissionId !== sub.id) return;
  const commission = T.db.get('Commission', tile.commissionId);
  const restricted = commission.privacy === 'RESTRICTED';
  const files = await loadFileTexts(T, sub.files);

  const auto = runAutoChecks(tile.acceptanceCriteria, files);
  const llmCriteria = [...tile.acceptanceCriteria.filter((c) => c.check === 'LLM'), ...auto.deferred];
  let llm = null;
  if (llmCriteria.length) {
    const input = {
      tile: { title: tile.title, spec: restricted ? redactText(tile.spec) : tile.spec, deliverableFormat: tile.deliverableFormat },
      criteria: llmCriteria.map((c) => ({ id: c.id, text: c.text })),
      submission: { notes: sub.notes, files: files.map((f) => ({ name: f.name, excerpt: excerptFor(f, { restricted }) })) },
    };
    // On a swarm job the Reviewer also sees what the tile worked from, so it can check that
    // every number and quote traces back to an input or a cited source.
    if (commission.workforce === 'agents') {
      const ups = await loadFileTexts(T, upstreamFiles(T.db, tile.id).slice(0, 8), { maxChars: 6000 });
      if (ups.length) input.inputs = ups.map((f) => ({ name: f.name, excerpt: excerptFor(f, { restricted, max: 2500 }) }));
      if (tile.research?.sources?.length) input.researchSources = tile.research.sources.slice(0, 15).map((x) => ({ title: x.title, url: x.url }));
    }
    const meta = { commissionId: tile.commissionId, tileId: tile.id, userId: sub.contributorId };
    const light = await runAgent({ agent: AGENTS.reviewer, input, route: T.llm.forCommission(commission, 'light'), log: T.log, meta });
    llm = { ...light.output, model: light.model, escalated: false };
    if (light.output.confidence < config.reviewConfidenceFloor) {
      const heavy = await runAgent({ agent: AGENTS.reviewer, input, route: T.llm.forCommission(commission, 'heavy'), log: T.log, meta });
      llm = { ...heavy.output, model: heavy.model, escalated: true, lightConfidence: light.output.confidence };
    }
  }

  T.db.tx((tx) => {
    const cur = tx.get('Tile', tile.id);
    if (cur.status !== 'IN_REVIEW' || cur.lastSubmissionId !== sub.id) return;
    const autoFailed = auto.results.some((r) => !r.pass);
    if (auto.results.length) {
      tx.insert('Review', { submissionId: sub.id, tileId: tile.id, source: 'AUTO', reviewerId: null, verdict: autoFailed ? 'FAIL' : 'PASS', criteria: auto.results });
    }
    if (llm) {
      tx.insert('Review', {
        submissionId: sub.id, tileId: tile.id, source: 'LLM', reviewerId: null, verdict: llm.overall === 'PASS' ? 'PASS' : 'FAIL',
        criteria: llm.criteria, confidence: llm.confidence, model: llm.model, escalated: llm.escalated, lightConfidence: llm.lightConfidence ?? null,
      });
    }
    if (autoFailed || (llm && llm.overall !== 'PASS')) {
      failTile(tx, cur, sub, 'verifier');
      return;
    }
    const decision = peerReviewDecision({ tile: cur, priorAcceptedWork: priorAcceptedWork(tx, sub.contributorId), round: sub.round, agent: !!tx.get('User', sub.contributorId)?.isAgent });
    if (decision.required) createPeerReviewTile(tx, cur, sub, decision.reason);
    else acceptTile(tx, cur.id, sub.id, 'verifier', decision.reason);
  });
}

export function acceptTile(tx, tileId, submissionId, actor, note) {
  return transitionTile(tx, tileId, 'ACCEPTED', actor, {
    patch: { acceptedSubmissionId: submissionId, acceptedAt: tx.now(), pendingReviewTileId: null }, note,
  });
}

/** A failed round goes back for revision; after two revisions the tile reopens to others. */
export function failTile(tx, tile, sub, actor) {
  const holder = sub.contributorId;
  postReputation(tx, { userId: holder, tags: tile.skillTags, reason: 'REVIEW_FAILED', tileId: tile.id, tier: tile.tier });
  if ((tile.revisionCount || 0) >= config.maxRevisionRounds) {
    return transitionTile(tx, tile.id, 'OPEN', actor, {
      rematch: true,
      note: `Failed round ${sub.round}; reopened to other contributors`,
      patch: {
        revisionCount: 0, pendingReviewTileId: null,
        excludedUserIds: [...(tile.excludedUserIds || []), holder],
        partialPayCandidate: { contributorId: holder, submissionId: sub.id, paidCents: 0 },
        reopenCount: (tile.reopenCount || 0) + 1,
      },
    });
  }
  return transitionTile(tx, tile.id, 'REVISION', actor, {
    note: `Failed round ${sub.round}; back for revision`,
    patch: { revisionCount: (tile.revisionCount || 0) + 1, pendingReviewTileId: null, claimExpiresAt: tx.now() + claimLockMs(tile.estMinutes) },
  });
}

/** Makes sure escrow can cover `need` beyond what open tiles already hold, topping up from the requester if not. */
function ensureUncommitted(tx, commissionId, need, memo) {
  const c = tx.get('Commission', commissionId);
  const free = uncommittedCents(tx.all('LedgerEntry'), commissionId, tilesOf(tx, commissionId));
  if (free >= need) return 0;
  const top = need - free;
  postLedger(tx, [fundingEntry({ commissionId, funderId: c.requesterId, amountCents: top, memo })]);
  return top;
}

function createPeerReviewTile(tx, tile, sub, reason) {
  const pay = reviewPayCents(tile.tier, { rush: !!tile.rush });
  ensureUncommitted(tx, tile.commissionId, pay + feeCents(pay), `Top-up for an extra peer review of ${tile.title}`);
  const criteria = tile.acceptanceCriteria.some((c) => c.check === 'PEER')
    ? tile.acceptanceCriteria.filter((c) => c.check === 'PEER')
    : tile.acceptanceCriteria;
  const review = tx.insert('Tile', {
    commissionId: tile.commissionId, key: `${tile.key}-review-${sub.round}${tile.reopenCount ? `-${tile.reopenCount}` : ''}`, kind: 'REVIEW',
    title: `Peer review: ${tile.title}`,
    spec: `Check another contributor's submission for "${tile.title}" against the criteria below. Open each file, judge each criterion pass or fail, and give a reason they can act on. Reason for this review: ${reason}.`,
    deliverableFormat: 'A pass or fail verdict with a reason for each criterion',
    acceptanceCriteria: criteria.map((c) => ({ id: c.id, text: c.text, check: 'PEER' })),
    skillTags: tile.skillTags, tier: tile.tier, estMinutes: config.reviewTileMinutes, payCents: pay, rush: !!tile.rush,
    languages: tile.languages || [], sensitiveInputs: [], status: 'DRAFT', claimedById: null, claimExpiresAt: null,
    revisionCount: 0, highStakes: false, dynamic: true, reviewOf: { tileId: tile.id, submissionId: sub.id, reason }, excludedUserIds: [],
  });
  tx.update('Tile', tile.id, { pendingReviewTileId: review.id, peerReviewReason: reason });
  transitionTile(tx, review.id, 'OPEN', 'verifier', { note: reason });
  return review;
}

function applyHumanVerdict(tx, target, sub, verdicts, source, reviewerId) {
  const pass = verdicts.every((v) => v.pass);
  tx.insert('Review', { submissionId: sub.id, tileId: target.id, source, reviewerId, verdict: pass ? 'PASS' : 'FAIL', criteria: verdicts });
  if (pass) acceptTile(tx, target.id, sub.id, reviewerId, `${source === 'PEER' ? 'Peer' : 'Requester'} review passed`);
  else failTile(tx, tx.get('Tile', target.id), sub, reviewerId);
}

function checkVerdicts(verdicts, criteria) {
  const ids = criteria.map((c) => c.id).sort();
  const got = verdicts.map((v) => v.criterionId).sort();
  if (JSON.stringify(ids) !== JSON.stringify(got)) throw new UserError('Give a verdict for every criterion.');
  for (const v of verdicts) {
    if (typeof v.pass !== 'boolean') throw new UserError('Mark each criterion pass or fail.');
    if (String(v.reason || '').trim().length < 10) throw new UserError('Give each verdict a reason of at least 10 characters that the contributor can act on.');
  }
}

/** A peer reviewer submits verdicts; the review tile is accepted (and paid) and the verdict applied. */
export function submitPeerReview(T, actorId, reviewTileId, { verdicts, notes = '', minutesSpent = config.reviewTileMinutes }) {
  return T.db.tx((tx) => {
    const rt = requireHolder(tx, reviewTileId, actorId, ['CLAIMED']);
    if (!rt.dynamic || !rt.reviewOf) throw new UserError('This isn’t a peer review tile.');
    checkVerdicts(verdicts, rt.acceptanceCriteria);
    const target = tx.get('Tile', rt.reviewOf.tileId);
    const targetSub = tx.get('Submission', rt.reviewOf.submissionId);
    const sub = tx.insert('Submission', {
      tileId: rt.id, commissionId: rt.commissionId, contributorId: actorId, round: 1, notes: String(notes).slice(0, 2000),
      minutesSpent: Math.max(1, Math.round(minutesSpent)), files: [], checklist: Object.fromEntries(verdicts.map((v) => [v.criterionId, v.pass])), modelUsed: null,
    });
    transitionTile(tx, rt.id, 'SUBMITTED', actorId, { noVerify: true, submissionId: sub.id, patch: { lastSubmissionId: sub.id } });
    transitionTile(tx, rt.id, 'IN_REVIEW', 'verifier', { note: 'Checked that every criterion has a reasoned verdict' });
    tx.insert('Review', { submissionId: sub.id, tileId: rt.id, source: 'AUTO', reviewerId: null, verdict: 'PASS', criteria: [{ criterionId: 'complete', pass: true, reason: 'Every criterion has a verdict and a reason.' }] });
    acceptTile(tx, rt.id, sub.id, 'verifier', 'Review complete');
    if (target.status === 'IN_REVIEW' && target.pendingReviewTileId === rt.id) {
      applyHumanVerdict(tx, target, targetSub, verdicts, 'PEER', actorId);
    }
    return sub;
  }, { actor: actorId });
}

/** The requester can settle a pending peer review themselves (for example when no reviewer is free). */
export function requesterReview(T, actorId, tileId, verdicts) {
  return T.db.tx((tx) => {
    const target = must(tx.get('Tile', tileId), 'Tile not found.');
    const c = tx.get('Commission', target.commissionId);
    if (c.requesterId !== actorId) throw new UserError('Only the requester can review this tile themselves.');
    if (target.status !== 'IN_REVIEW' || !target.pendingReviewTileId) throw new UserError('This tile isn’t waiting for a peer review.');
    const rt = tx.get('Tile', target.pendingReviewTileId);
    checkVerdicts(verdicts, rt.acceptanceCriteria);
    if (['OFFERED', 'CLAIMED'].includes(rt.status)) transitionTile(tx, rt.id, 'OPEN', actorId, { note: 'The requester reviewed the tile directly' });
    if (tx.get('Tile', rt.id).status === 'OPEN') transitionTile(tx, rt.id, 'CANCELLED', actorId, { note: 'Not needed: the requester reviewed it' });
    const sub = tx.get('Submission', rt.reviewOf.submissionId);
    applyHumanVerdict(tx, target, sub, verdicts, 'REQUESTER', actorId);
  }, { actor: actorId });
}

/** After a tile reopens, the requester may pay the previous contributor for usable work. */
export function grantPartialPay(T, actorId, tileId, amountCents) {
  return T.db.tx((tx) => {
    const tile = must(tx.get('Tile', tileId), 'Tile not found.');
    const c = tx.get('Commission', tile.commissionId);
    if (c.requesterId !== actorId) throw new UserError('Only the requester can grant partial pay.');
    const cand = tile.partialPayCandidate;
    if (!cand || cand.paidCents) throw new UserError('There is no reopened submission awaiting a partial-pay decision.');
    const amt = Math.round(Number(amountCents));
    if (!(amt > 0) || amt > tile.payCents) throw new UserError(`Partial pay must be between $0.01 and ${fmtMoney(tile.payCents)}.`);
    ensureUncommitted(tx, c.id, amt + feeCents(amt), `Top-up for partial pay on ${tile.title}`);
    postLedger(tx, partialPayEntries({ commissionId: c.id, tile, contributorId: cand.contributorId, amountCents: amt }));
    tx.update('Tile', tileId, { partialPayCandidate: { ...cand, paidCents: amt, decidedAt: tx.now() } });
  }, { actor: actorId });
}

export function declinePartialPay(T, actorId, tileId) {
  return T.db.tx((tx) => {
    const tile = must(tx.get('Tile', tileId), 'Tile not found.');
    const c = tx.get('Commission', tile.commissionId);
    if (c.requesterId !== actorId) throw new UserError('Only the requester can decide on partial pay.');
    if (!tile.partialPayCandidate) throw new UserError('Nothing to decide.');
    tx.update('Tile', tileId, { partialPayCandidate: { ...tile.partialPayCandidate, paidCents: -1, decidedAt: tx.now() } });
  }, { actor: actorId });
}
