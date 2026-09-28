// Eligibility is a set of hard filters; the score only ranks eligible people, and it
// depends only on fit, so nobody can win work by accepting less money.
//   score = 0.45·S + 0.25·R + 0.15·A + 0.10·F + 0.05·G
import { config } from './config.js';
import { effectiveHourlyCents } from './pricing.js';
import { reputationFor, hasEarnedReputation, highestTier } from './reputation.js';
import { nextAvailableAt } from './availability.js';
import { HOUR, fmtRate } from '../lib/util.js';

/** How long a claim locks a tile: three times its estimate or 48 hours, whichever is longer. */
export function claimLockMs(estMinutes, cfg = config) {
  return Math.max(cfg.claimMultiplier * estMinutes * 60 * 1000, cfg.claimMinMs);
}

/** An agent's profile has anySkill: it takes any tag at a fixed level. */
function skillLevel(profile, tag) {
  if (profile.anySkill) return profile.anySkill;
  const s = (profile.skills || []).find((x) => x.tag === tag);
  return s ? s.selfLevel : 0;
}

/**
 * @param {object} tile priced tile with skillTags, payCents, estMinutes, kind, languages
 * @param {object} c candidate { user, profile, rep, committedMinutes, earnings7d }
 * @param {object} ctx { now, commission, excludeUserIds, commissionWorkers, reviewTarget, cfg }
 * @returns {{ eligible: boolean, reasons: {code: string, text: string}[] }}
 */
export function checkEligibility(tile, c, ctx) {
  const cfg = ctx.cfg || config;
  const reasons = [];
  const { user, profile } = c;
  const add = (code, text) => reasons.push({ code, text });
  if (!user || !user.isContributor || !profile) {
    add('not-contributor', 'Not set up as a contributor');
    return { eligible: false, reasons };
  }
  if (ctx.commission && ctx.commission.requesterId === user.id) add('own-commission', 'This is your own commission');
  // Jobs handed to the agent swarm are done by agents only, and agents take no other work.
  const swarmJob = ctx.commission?.workforce === 'agents';
  if (swarmJob && !user.isAgent) add('agents-only', 'The agent swarm is doing this job');
  if (!swarmJob && user.isAgent) add('people-only', 'Agents only work on jobs handed to the swarm');
  if (ctx.excludeUserIds && ctx.excludeUserIds.has(user.id)) add('excluded', 'Already had this tile');

  const rate = effectiveHourlyCents(tile);
  const floor = Math.max(profile.payFloorCents || 0, cfg.platformFloorCents);
  if (rate < floor) add('below-floor', `Pays ${fmtRate(rate)}, under the ${fmtRate(floor)} floor`);

  if (tile.kind === 'REVIEW' && ctx.reviewTarget) {
    const tags = ctx.reviewTarget.skillTags;
    const earned = tags.some((t) => hasEarnedReputation(c.rep, t));
    const bootstrap = tags.some((t) => skillLevel(profile, t) >= (cfg.reviewerBootstrapLevel || 3));
    if (!earned && !bootstrap) add('no-reviewer-rep', 'Needs earned reputation in one of this tile’s skills');
    if (ctx.reviewRelaxed) {
      if (ctx.targetWorkers && ctx.targetWorkers.has(user.id)) add('worked-on-tile', 'Worked on this tile, so can’t review it');
    } else if (ctx.commissionWorkers && ctx.commissionWorkers.has(user.id)) add('worked-on-commission', 'Worked on this commission, so can’t review it');
  } else if (!tile.skillTags.some((t) => skillLevel(profile, t) > 0)) {
    add('no-skill', `Needs one of: ${tile.skillTags.join(', ')}`);
  }

  const langs = tile.languages && tile.languages.length ? tile.languages : [ctx.commission?.language || 'en'];
  if (!langs.some((l) => (profile.languages || []).includes(l))) add('language', `Works in ${langs.join('/')}`);

  const lock = claimLockMs(tile.estMinutes, cfg);
  const nextAt = nextAvailableAt(ctx.now, profile.availability, profile.timezone);
  if (nextAt === null || nextAt > ctx.now + lock) add('no-availability', 'No availability window before the claim would expire');

  const cap = (profile.weeklyHoursCap || 0) * 60;
  if ((c.committedMinutes || 0) + tile.estMinutes > cap) add('over-cap', `Would exceed the ${profile.weeklyHoursCap} h weekly cap`);

  return { eligible: reasons.length === 0, reasons };
}

/** The ranking score and its parts. `ctx.medianEarnings7d` must be precomputed. */
export function scoreCandidate(tile, c, ctx) {
  const cfg = ctx.cfg || config;
  const w = cfg.matchWeights;
  const tags = tile.kind === 'REVIEW' && ctx.reviewTarget ? ctx.reviewTarget.skillTags : tile.skillTags;
  const S = tags.reduce((n, t) => n + skillLevel(c.profile, t) / 5, 0) / tags.length;
  const R = tags.reduce((n, t) => n + reputationFor(c.rep, t, cfg), 0) / tags.length;
  const nextAt = nextAvailableAt(ctx.now, c.profile.availability, c.profile.timezone);
  const until = nextAt === null ? Infinity : nextAt - ctx.now;
  const A = until <= 24 * HOUR ? 1 : until <= 72 * HOUR ? 0.5 : 0;
  const med = ctx.medianEarnings7d || 0;
  const e = c.earnings7d || 0;
  const F = med > 0 ? Math.max(0, 1 - e / med) : (e > 0 ? 0 : 1);
  const G = tags.some((t) => tile.tier === highestTier(c.rep, t) + 1) ? 1 : 0;
  const score = w.S * S + w.R * R + w.A * A + w.F * F + w.G * G;
  return { score: Math.round(score * 1000) / 1000, breakdown: { S: round3(S), R: round3(R), A, F: round3(F), G } };
}

function round3(n) { return Math.round(n * 1000) / 1000; }

/** Ranks every candidate; ineligible ones are returned too, with their reasons. */
export function rankCandidates(tile, candidates, ctx) {
  const out = candidates.map((c) => {
    const el = checkEligibility(tile, c, ctx);
    const sc = el.eligible ? scoreCandidate(tile, c, ctx) : { score: 0, breakdown: null };
    return { userId: c.user.id, eligible: el.eligible, reasons: el.reasons, ...sc };
  });
  return out.sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score) || a.userId.localeCompare(b.userId));
}

export const SCORE_LABELS = Object.freeze({
  S: 'Skill: your self-rated level in the tile’s skills',
  R: 'Reputation: your smoothed acceptance rate in those skills',
  A: 'Availability: a window in the next 24 hours scores 1, within 72 hours 0.5',
  F: 'Fair rotation: higher when you’ve earned less than the median over the last 7 days',
  G: 'Growth: 1 when the tile is one tier above your best accepted tier in the skill',
});
