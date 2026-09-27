// Reputation is per skill, built only from accepted work and reviews, and recomputed
// from the append-only ReputationEvent table every time it's read.
//   R_t = (accepted_t + 2) / (attempts_t + 4)      events older than 12 months count half
import { config } from './config.js';

export const REP_REASONS = Object.freeze({
  ACCEPTED: { delta: 1, accepted: 1, attempt: 1, label: 'Tile accepted' },
  REVIEW_COMPLETED: { delta: 0.5, accepted: 1, attempt: 1, label: 'Peer review completed' },
  REVIEW_FAILED: { delta: -0.5, accepted: 0, attempt: 1, label: 'Submission failed review' },
  CLAIM_EXPIRED: { delta: -0.5, accepted: 0, attempt: 1, label: 'Claim expired' },
  CLAIM_EXPIRED_FIRST: { delta: 0, accepted: 0, attempt: 0, label: 'First expired claim (no penalty)' },
  DISPUTE_REOPENED: { delta: -1, accepted: -1, attempt: 0, label: 'Accepted tile reopened by a dispute panel' },
});

export function eventWeight(event, now, cfg = config) {
  return now - event.createdAt > cfg.reputationHalfWeightMs ? 0.5 : 1;
}

/** Smoothed acceptance rate. Every new contributor starts at 0.5. */
export function smoothedRate(accepted, attempts, cfg = config) {
  return (accepted + cfg.reputationPrior.accepted) / (attempts + cfg.reputationPrior.attempts);
}

/**
 * Summarizes one user's events into per-skill records.
 * @returns {{ skills: Record<string, {tag: string, accepted: number, attempts: number, score: number, highestTier: number, points: number, lastAt: number, events: number}>, totalAccepted: number, totalPoints: number }}
 */
export function summarizeReputation(events, userId, now, cfg = config) {
  /** @type {Record<string, any>} */
  const skills = {};
  let totalAccepted = 0;
  let totalPoints = 0;
  for (const e of events) {
    if (e.userId !== userId) continue;
    const rule = REP_REASONS[e.reason];
    if (!rule) continue;
    const w = eventWeight(e, now, cfg);
    const s = (skills[e.skillTag] ||= { tag: e.skillTag, accepted: 0, attempts: 0, score: 0, highestTier: 0, points: 0, lastAt: 0, events: 0 });
    s.accepted += rule.accepted * w;
    s.attempts += rule.attempt * w;
    s.points += e.delta;
    s.events += 1;
    s.lastAt = Math.max(s.lastAt, e.createdAt);
    if (e.reason === 'ACCEPTED' && e.tier) s.highestTier = Math.max(s.highestTier, e.tier);
    if (rule.accepted > 0) totalAccepted += w;
    totalPoints += e.delta;
  }
  for (const s of Object.values(skills)) {
    s.accepted = Math.max(0, s.accepted);
    s.score = smoothedRate(s.accepted, s.attempts, cfg);
  }
  return { skills, totalAccepted, totalPoints };
}

export function reputationFor(summary, tag, cfg = config) {
  const s = summary.skills[tag];
  return s ? s.score : smoothedRate(0, 0, cfg);
}

export function hasEarnedReputation(summary, tag) {
  const s = summary.skills[tag];
  return !!s && s.accepted >= 1;
}

export function highestTier(summary, tag) {
  return summary.skills[tag]?.highestTier || 0;
}
