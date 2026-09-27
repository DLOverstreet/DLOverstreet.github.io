// Matching, offers and claims. The Matcher offers an open tile to the top three eligible
// contributors for a two-hour window; after that it goes to the open board. A claim locks
// the tile for three times its estimate or 48 hours, whichever is longer.
import { UserError, must, getUser, profileOf, transitionTile, transitionCommission, postReputation, commissionWorkers, tileWorkers } from './core.js';
import { rankCandidates, checkEligibility, scoreCandidate } from '../domain/matching.js';
import { summarizeReputation } from '../domain/reputation.js';
import { userEarnings } from '../domain/ledger.js';
import { effectiveHourlyCents } from '../domain/pricing.js';
import { HELD_STATUSES } from '../domain/transitions.js';
import { config } from '../domain/config.js';
import { median } from '../lib/util.js';
import { AGENTS } from '../agents/index.js';
import { runAgent } from '../llm/run-agent.js';

/** Everything the Matcher knows about each contributor, recomputed from the event tables. */
export function buildCandidates(db, now) {
  const repEvents = db.all('ReputationEvent');
  const ledger = db.all('LedgerEntry');
  const tiles = db.all('Tile');
  const since = now - config.fairnessWindowMs;
  const out = [];
  for (const user of db.filter('User', (u) => u.isContributor)) {
    const profile = profileOf(db, user.id);
    if (!profile) continue;
    let committed = 0;
    for (const t of tiles) {
      if (t.claimedById !== user.id) continue;
      if (HELD_STATUSES.includes(t.status)) committed += t.estMinutes;
      else if (t.status === 'ACCEPTED' && (t.acceptedAt || 0) >= since) committed += t.estMinutes;
    }
    out.push({
      user, profile,
      rep: summarizeReputation(repEvents, user.id, now),
      committedMinutes: committed,
      earnings7d: userEarnings(ledger, user.id, { since }),
    });
  }
  return out;
}

/**
 * Candidates and context for ranking. `forOffers` also skips people who already let an
 * offer for this tile lapse or declined it; they can still claim it from the open board.
 */
export function matchContext(db, tile, now, { forOffers = false } = {}) {
  const commission = db.get('Commission', tile.commissionId);
  const candidates = buildCandidates(db, now);
  const excluded = new Set(tile.excludedUserIds || []);
  if (forOffers) {
    for (const o of db.filter('Offer', (x) => x.tileId === tile.id && ['DECLINED', 'EXPIRED'].includes(x.response))) excluded.add(o.contributorId);
  }
  let reviewTarget = null;
  if (tile.reviewOf) {
    reviewTarget = db.get('Tile', tile.reviewOf.tileId);
    const sub = db.get('Submission', tile.reviewOf.submissionId);
    if (sub) excluded.add(sub.contributorId);
  }
  return {
    candidates,
    ctx: {
      now, commission, excludeUserIds: excluded, reviewTarget,
      commissionWorkers: tile.reviewOf ? commissionWorkers(db, tile.commissionId) : null,
      targetWorkers: tile.reviewOf ? tileWorkers(db, tile.reviewOf.tileId) : null,
      reviewRelaxed: tile.reviewerRule === 'relaxed',
      medianEarnings7d: median(candidates.map((c) => c.earnings7d)),
    },
  };
}

/** Where one contributor stands on one tile: eligibility reasons and, if eligible, the score. */
export function explainFit(db, tileId, userId, now) {
  const tile = db.get('Tile', tileId);
  const { candidates, ctx } = matchContext(db, tile, now);
  const c = candidates.find((x) => x.user.id === userId);
  if (!c) return { eligible: false, reasons: [{ code: 'not-contributor', text: 'Set up a contributor profile first' }] };
  const el = checkEligibility(tile, c, ctx);
  return { ...el, ...(el.eligible ? scoreCandidate(tile, c, ctx) : {}) };
}

export function runMatchJob(T, { tileId }) {
  const now = T.clock.now();
  T.db.tx((tx) => {
    const tile = tx.get('Tile', tileId);
    if (!tile || tile.status !== 'OPEN') return;
    const { candidates, ctx } = matchContext(tx, tile, now, { forOffers: true });
    let ranked = rankCandidates(tile, candidates, ctx);
    if (tile.reviewOf && !ctx.reviewRelaxed && !ranked.some((r) => r.eligible)) {
      // No one independent of the whole commission is free to review. Fall back to anyone
      // who didn't work on this tile, and say so on the tile.
      ranked = rankCandidates(tile, candidates, { ...ctx, reviewRelaxed: true });
      if (ranked.some((r) => r.eligible)) tx.update('Tile', tileId, { reviewerRule: 'relaxed' });
    }
    const top = ranked.filter((r) => r.eligible).slice(0, config.offersPerTile);
    const counts = {};
    for (const r of ranked) for (const reason of r.reasons) counts[reason.code] = (counts[reason.code] || 0) + 1;
    tx.update('Tile', tileId, { matchSummary: { at: now, eligible: ranked.filter((r) => r.eligible).length, offered: top.length, reasons: counts } });
    if (!top.length) return;
    for (const r of top) {
      tx.insert('Offer', {
        tileId, commissionId: tile.commissionId, contributorId: r.userId, score: r.score, breakdown: r.breakdown,
        expiresAt: now + config.offerWindowMs, response: 'PENDING', note: null,
      });
    }
    transitionTile(tx, tileId, 'OFFERED', 'matcher', { note: `Offered to ${top.length}` });
    tx.enqueue('matcherNote', { tileId }, { dedupeKey: `note:${tileId}:${now}` });
  });
}

/** Writes the one-line "why this fits you" notes with the light model. Offers work without them. */
export async function runMatcherNoteJob(T, { tileId }) {
  const tile = T.db.get('Tile', tileId);
  if (!tile) return;
  const offers = T.db.filter('Offer', (o) => o.tileId === tileId && o.response === 'PENDING' && !o.note);
  if (!offers.length) return;
  const now = T.clock.now();
  const tags = tile.reviewOf ? T.db.get('Tile', tile.reviewOf.tileId)?.skillTags || tile.skillTags : tile.skillTags;
  const candidates = offers.map((o) => {
    const profile = profileOf(T.db, o.contributorId);
    const rep = summarizeReputation(T.db.all('ReputationEvent'), o.contributorId, now);
    const skill = (profile.skills || []).filter((s) => tags.includes(s.tag)).sort((a, b) => b.selfLevel - a.selfLevel)[0];
    return {
      userId: o.contributorId, breakdown: o.breakdown, floorCents: Math.max(profile.payFloorCents, config.platformFloorCents),
      topSkill: skill ? { tag: skill.tag, level: skill.selfLevel } : null,
      accepted: skill ? Math.round(rep.skills[skill.tag]?.accepted || 0) : 0,
    };
  });
  const input = { tile: { title: tile.title, skillTags: tags, tier: tile.tier, estMinutes: tile.estMinutes, rateCents: effectiveHourlyCents(tile) }, candidates };
  const { output } = await runAgent({ agent: AGENTS.matcherNote, input, route: T.llm.platform('light'), log: T.log, meta: { commissionId: tile.commissionId, tileId } });
  T.db.tx((tx) => {
    for (const n of output.notes) {
      const o = offers.find((x) => x.contributorId === n.userId);
      const cur = o && tx.get('Offer', o.id);
      if (cur && cur.response === 'PENDING') tx.update('Offer', o.id, { note: n.note });
    }
  });
}

function afterOfferClosed(tx, tileId, actor) {
  const tile = tx.get('Tile', tileId);
  if (tile.status !== 'OFFERED') return;
  const pending = tx.filter('Offer', (o) => o.tileId === tileId && o.response === 'PENDING');
  if (!pending.length) transitionTile(tx, tileId, 'OPEN', actor, { note: 'No offer was taken; now on the open board' });
}

/** @param {{ crowd?: boolean }} [opts] crowd: the claim is made by the crowd simulation */
export function respondToOffer(T, actorId, offerId, accept, opts = {}) {
  return T.db.tx((tx) => {
    const offer = must(tx.get('Offer', offerId), 'Offer not found.');
    if (offer.contributorId !== actorId) throw new UserError('That offer was made to someone else.');
    if (offer.response !== 'PENDING') throw new UserError(`This offer is no longer open (${offer.response.toLowerCase()}).`);
    const now = tx.now();
    if (offer.expiresAt <= now) {
      tx.update('Offer', offerId, { response: 'EXPIRED', respondedAt: now });
      afterOfferClosed(tx, offer.tileId, 'system');
      throw new UserError('This offer’s claim window has ended.');
    }
    const tile = tx.get('Tile', offer.tileId);
    if (!accept) {
      tx.update('Offer', offerId, { response: 'DECLINED', respondedAt: now });
      afterOfferClosed(tx, offer.tileId, actorId);
      return null;
    }
    if (tile.status !== 'OFFERED') throw new UserError('Someone else has already claimed this tile.');
    tx.update('Offer', offerId, { response: 'ACCEPTED', respondedAt: now });
    return transitionTile(tx, tile.id, 'CLAIMED', actorId, { patch: { claimedById: actorId, crowdClaimed: !!opts.crowd }, note: 'Accepted an offer' });
  }, { actor: actorId });
}

/** Claims a tile from the open board. The same hard filters as offers apply. */
/** @param {{ crowd?: boolean }} [opts] */
export function claimFromBoard(T, actorId, tileId, opts = {}) {
  const now = T.clock.now();
  return T.db.tx((tx) => {
    const tile = must(tx.get('Tile', tileId), 'Tile not found.');
    if (tile.status === 'OFFERED') {
      const mine = tx.find('Offer', (o) => o.tileId === tileId && o.contributorId === actorId && o.response === 'PENDING');
      if (mine) return respondToOffer(T, actorId, mine.id, true, opts);
      throw new UserError('This tile is in its offer window. It reaches the open board if no one takes it.');
    }
    if (tile.status !== 'OPEN') throw new UserError('This tile isn’t open.');
    const fit = explainFit(tx, tileId, actorId, now);
    if (!fit.eligible) throw new UserError(`You can’t claim this tile: ${fit.reasons.map((r) => r.text).join('; ')}.`);
    return transitionTile(tx, tileId, 'CLAIMED', actorId, { patch: { claimedById: actorId, crowdClaimed: !!opts.crowd }, note: 'Claimed from the board' });
  }, { actor: actorId });
}

export function releaseClaim(T, actorId, tileId) {
  return T.db.tx((tx) => {
    const tile = must(tx.get('Tile', tileId), 'Tile not found.');
    if (tile.claimedById !== actorId || !['CLAIMED', 'REVISION'].includes(tile.status)) throw new UserError('You don’t hold this tile.');
    return transitionTile(tx, tileId, 'OPEN', actorId, {
      rematch: true, note: 'Released by the contributor (no penalty)',
      patch: { excludedUserIds: [...(tile.excludedUserIds || []), actorId], revisionCount: 0 },
    });
  }, { actor: actorId });
}

/**
 * The timer sweep, run by the worker every few seconds and after the clock moves:
 * expires offer windows and claims, and auto-accepts deliveries after seven days.
 */
export function runTick(T) {
  const now = T.clock.now();
  T.db.tx((tx) => {
    for (const o of tx.filter('Offer', (x) => x.response === 'PENDING' && x.expiresAt <= now)) {
      tx.update('Offer', o.id, { response: 'EXPIRED', respondedAt: now });
      afterOfferClosed(tx, o.tileId, 'system');
    }
    for (const t of tx.filter('Tile', (x) => ['CLAIMED', 'REVISION'].includes(x.status) && x.claimExpiresAt && x.claimExpiresAt <= now)) {
      const holder = t.claimedById;
      const prior = tx.filter('ReputationEvent', (e) => e.userId === holder && (e.reason === 'CLAIM_EXPIRED' || e.reason === 'CLAIM_EXPIRED_FIRST'));
      const first = prior.length === 0;
      postReputation(tx, { userId: holder, tags: t.skillTags.slice(0, 1), reason: first ? 'CLAIM_EXPIRED_FIRST' : 'CLAIM_EXPIRED', tileId: t.id, tier: t.tier });
      transitionTile(tx, t.id, 'OPEN', 'system', {
        rematch: true, note: first ? 'Claim expired (first time, no penalty)' : 'Claim expired',
        patch: { excludedUserIds: [...(t.excludedUserIds || []), holder], revisionCount: 0 },
      });
    }
    for (const c of tx.filter('Commission', (x) => x.status === 'DELIVERED' && x.autoAcceptAt && x.autoAcceptAt <= now)) {
      transitionCommission(tx, c.id, 'ACCEPTED', 'auto-accept', { note: 'Accepted automatically after seven days without a response' });
    }
  });
}

/** Tiles on the open board, split into ones this contributor can claim and hidden counts by reason. */
export function boardFor(db, userId, now) {
  const open = db.filter('Tile', (t) => t.status === 'OPEN');
  const visible = [];
  const hidden = {};
  const user = getUser(db, userId);
  for (const t of open) {
    const c = db.get('Commission', t.commissionId);
    if (c.requesterId === userId) continue;
    const fit = user.isContributor ? explainFit(db, t.id, userId, now) : { eligible: false, reasons: [{ code: 'not-contributor', text: '' }] };
    if (fit.eligible) visible.push({ tile: t, fit });
    else for (const r of fit.reasons) hidden[r.code] = (hidden[r.code] || 0) + 1;
  }
  visible.sort((a, b) => (b.fit.score || 0) - (a.fit.score || 0));
  return { visible, hidden, totalOpen: open.length };
}
