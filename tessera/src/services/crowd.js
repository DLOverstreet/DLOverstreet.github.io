// The crowd simulation. When it's on, the seeded contributors you aren't playing act on
// their own after a short, human-looking delay: they accept offers, submit sample work
// (occasionally a weak first attempt, to show the revision loop), review each other's
// tiles and vote on dispute panels. It uses the same API a person would.
//
// Ownership follows who started the work, not the persona: the crowd only continues tiles
// it claimed itself and never touches a tile you claimed. Personas you've played are left
// to you, except that an offer only they could take is picked up after a longer wait once
// you've switched away, so the demo never stalls on a persona nobody is playing.
import { generateSampleWork, generatePeerVerdicts } from '../agents/mock/sample-work.js';
import { respondToOffer, claimFromBoard, explainFit } from './market.js';
import { submitWork, submitPeerReview, requesterReview, upstreamFiles } from './work.js';
import { castPanelVote } from './delivery.js';
import { unitHash, hashString } from '../lib/util.js';

const DELAYS = { offer: [1000, 2500], work: [2500, 5500], board: [3000, 6000], vote: [2000, 4000], fallback: [25000, 40000] };

/**
 * During the guided demo the crowd leaves the visitor's commission alone until the visitor
 * has claimed one of its tiles as a contributor, so there is still a tile left to try.
 */
export function guideHoldCommission(db) {
  const g = db.meta.guide || {};
  if (!g.startedAt || g.dismissed || !g.commissionId) return null;
  const human = new Set(db.meta.humanPersonaIds || []);
  const claimed = db.filter('Tile', (t) => t.commissionId === g.commissionId && !t.dynamic && t.claimedById && human.has(t.claimedById) && !db.get('User', t.claimedById)?.isRequester).length;
  return claimed ? null : g.commissionId;
}

export function createCrowd(T) {
  const due = new Map();
  let busy = false;

  function isDue(key, kind, force) {
    if (force) return true;
    const now = Date.now();
    if (!due.has(key)) {
      const [lo, hi] = DELAYS[kind];
      due.set(key, now + lo + unitHash(key) * (hi - lo));
    }
    return now >= due.get(key);
  }

  function contributor(userId) {
    const u = T.db.get('User', userId);
    return u && u.isContributor && !u.isAdmin && !u.isAgent && userId !== T.db.meta.activePersonaId ? u : null;
  }
  /** A persona the crowd plays freely: not the active one, and never played by you. */
  function simulated(userId) {
    return !!contributor(userId) && !(T.db.meta.humanPersonaIds || []).includes(userId);
  }
  /** A persona you played earlier but aren't playing now: a last resort for work nobody else can take. */
  function idleHuman(userId) {
    return !!contributor(userId) && (T.db.meta.humanPersonaIds || []).includes(userId);
  }

  /** The reviewed tile, limited to the criteria this review covers, with their original check types. */
  function reviewTarget(reviewTile) {
    const target = T.db.get('Tile', reviewTile.reviewOf.tileId);
    return { ...target, acceptanceCriteria: reviewTile.acceptanceCriteria.map((c) => target.acceptanceCriteria.find((x) => x.id === c.id) || c) };
  }

  async function step({ force = false } = {}) {
    if (busy) return 0;
    if (!force && !T.db.meta.settings.crowd) return 0;
    busy = true;
    let actions = 0;
    const act = async (fn) => { try { await fn(); actions++; } catch (e) { if (T.debug) console.warn('crowd:', e.message); } };
    try {
      // 1. Accept pending offers. Whoever answers first gets the tile, so the pick is spread
      //    across the offered people rather than always the top score.
      const hold = force ? null : guideHoldCommission(T.db);
      const byTile = new Map();
      for (const o of T.db.filter('Offer', (x) => x.response === 'PENDING' && x.commissionId !== hold)) {
        (byTile.get(o.tileId) || byTile.set(o.tileId, []).get(o.tileId)).push(o);
      }
      for (const [tileId, offers] of byTile) {
        const pick = (list) => list.sort((a, b) => a.contributorId.localeCompare(b.contributorId))[hashString(`first:${tileId}`) % list.length];
        const sims = offers.filter((o) => simulated(o.contributorId));
        const idle = offers.filter((o) => idleHuman(o.contributorId));
        if (sims.length) {
          const o = pick(sims);
          if (isDue(`offer:${o.id}`, 'offer', force)) await act(() => respondToOffer(T, o.contributorId, o.id, true, { crowd: true }));
        } else if (idle.length && offers.every((o) => o.contributorId !== T.db.meta.activePersonaId)) {
          const o = pick(idle);
          if (isDue(`offer-fallback:${o.id}`, 'fallback', force)) await act(() => respondToOffer(T, o.contributorId, o.id, true, { crowd: true }));
        }
      }
      // 2. Do held work.
      for (const t of T.db.filter('Tile', (x) => ['CLAIMED', 'REVISION'].includes(x.status) && x.crowdClaimed && x.claimedById && contributor(x.claimedById))) {
        const key = `work:${t.id}:${t.status}:${t.revisionCount || 0}`;
        if (!isDue(key, 'work', force)) continue;
        if (t.dynamic && t.reviewOf) {
          const verdicts = generatePeerVerdicts(reviewTarget(t), { seed: t.id });
          await act(() => submitPeerReview(T, t.claimedById, t.id, { verdicts, notes: 'Reviewed every file against each criterion.' }));
        } else {
          const firstRound = (t.revisionCount || 0) === 0 && !t.reopenCount;
          const weak = firstRound && unitHash(`weak:${t.id}`) < (T.db.meta.settings.crowdFailRate ?? 0.12);
          const work = generateSampleWork(t, { seed: `${t.id}:${t.revisionCount || 0}`, quality: weak ? 'bad' : 'good', upstreamFiles: upstreamFiles(T.db, t.id).map((f) => f.name) });
          await act(() => submitWork(T, t.claimedById, t.id, { ...work, modelUsed: 'simulated contributor' }));
        }
      }
      // 3. Pick up tiles that sat on the open board.
      const now = T.clock.now();
      for (const t of T.db.filter('Tile', (x) => x.status === 'OPEN' && x.commissionId !== hold)) {
        if (!isDue(`board:${t.id}:${t.updatedAt || t.createdAt}`, 'board', force)) continue;
        const fitsOf = (users) => users.map((u) => ({ u, fit: explainFit(T.db, t.id, u.id, now) })).filter((x) => x.fit.eligible).sort((a, b) => b.fit.score - a.fit.score || a.u.id.localeCompare(b.u.id));
        let fits = fitsOf(T.db.filter('User', (u) => simulated(u.id)));
        if (!fits.length && isDue(`board-fallback:${t.id}:${t.updatedAt || t.createdAt}`, 'fallback', force)) fits = fitsOf(T.db.filter('User', (u) => idleHuman(u.id)));
        if (fits.length) await act(() => claimFromBoard(T, fits[0].u.id, t.id, { crowd: true }));
      }
      // 4. A requester who isn't being played settles peer reviews no one is eligible for.
      for (const t of T.db.filter('Tile', (x) => x.dynamic && x.status === 'OPEN' && x.matchSummary && x.matchSummary.eligible === 0)) {
        const c = T.db.get('Commission', t.commissionId);
        if (c.requesterId === T.db.meta.activePersonaId || c.workforce === 'agents') continue;
        if (!isDue(`self-review:${t.id}`, 'board', force)) continue;
        const verdicts = generatePeerVerdicts(reviewTarget(t), { seed: t.id });
        await act(() => requesterReview(T, c.requesterId, t.reviewOf.tileId, verdicts));
      }
      // 5. Vote on dispute panels.
      for (const d of T.db.filter('Dispute', (x) => x.status === 'OPEN')) {
        for (const p of d.panel) {
          if (d.votes[p]) continue;
          const due = simulated(p) ? isDue(`vote:${d.id}:${p}`, 'vote', force) : idleHuman(p) && isDue(`vote-fallback:${d.id}:${p}`, 'fallback', force);
          if (!due) continue;
          const reopen = (hashString(`${d.id}:${p}`) % 100) < (/missing|wrong|incorrect|broken|incomplete|error/i.test(d.reason) ? 70 : 30);
          await act(() => castPanelVote(T, p, d.id, reopen ? 'REOPEN' : 'UPHOLD', reopen ? 'The disputed output does not fully meet what the requester describes.' : 'The accepted work meets its criteria as written.'));
        }
      }
    } finally {
      busy = false;
    }
    return actions;
  }

  return { step, reset: () => due.clear() };
}
