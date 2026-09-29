// When a submission goes to a human peer reviewer: every tile from a contributor's first
// five, a 20% sample after that, 100% of high-stakes tiles, and any tile with PEER criteria.
// An agent's work goes to another agent only for PEER criteria and high-stakes tiles: the
// first-five and sample rules build trust in new people, and every agent tile already gets
// the automatic checks and the Reviewer.
import { config } from './config.js';
import { unitHash } from '../lib/util.js';

export function peerReviewDecision({ tile, priorAcceptedWork, round, agent = false, supervised = false, cfg = config }) {
  if (tile.kind === 'REVIEW') return { required: false, reason: 'Review tiles are checked automatically' };
  // Competing agents' work was scored by a supervisor on every criterion, PEER ones included.
  if (agent && supervised && !tile.highStakes) return { required: false, reason: 'Scored by the swarm’s supervisor against every criterion' };
  if ((tile.acceptanceCriteria || []).some((c) => c.check === 'PEER')) return { required: true, reason: 'The tile has criteria only a person can judge' };
  if (tile.highStakes) return { required: true, reason: 'The requester flagged this tile as high stakes' };
  if (agent) return { required: false, reason: 'Agent work: checked automatically and by the Reviewer' };
  if (priorAcceptedWork < cfg.peerReview.firstN) return { required: true, reason: `One of the contributor’s first ${cfg.peerReview.firstN} tiles` };
  if (unitHash(`${tile.id}:${round}`) < cfg.peerReview.sampleRate) return { required: true, reason: `Picked in the ${Math.round(cfg.peerReview.sampleRate * 100)}% random sample` };
  return { required: false, reason: 'Not sampled for peer review' };
}
