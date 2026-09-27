// When a submission goes to a human peer reviewer: every tile from a contributor's first
// five, a 20% sample after that, 100% of high-stakes tiles, and any tile with PEER criteria.
import { config } from './config.js';
import { unitHash } from '../lib/util.js';

export function peerReviewDecision({ tile, priorAcceptedWork, round, cfg = config }) {
  if (tile.kind === 'REVIEW') return { required: false, reason: 'Review tiles are checked automatically' };
  if ((tile.acceptanceCriteria || []).some((c) => c.check === 'PEER')) return { required: true, reason: 'The tile has criteria only a person can judge' };
  if (tile.highStakes) return { required: true, reason: 'The requester flagged this tile as high stakes' };
  if (priorAcceptedWork < cfg.peerReview.firstN) return { required: true, reason: `One of the contributor’s first ${cfg.peerReview.firstN} tiles` };
  if (unitHash(`${tile.id}:${round}`) < cfg.peerReview.sampleRate) return { required: true, reason: `Picked in the ${Math.round(cfg.peerReview.sampleRate * 100)}% random sample` };
  return { required: false, reason: 'Not sampled for peer review' };
}
