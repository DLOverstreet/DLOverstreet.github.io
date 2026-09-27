// The two state machines. Every status change in the app goes through
// transitionTile / transitionCommission (src/services), which check these maps.

export const tileTransitions = Object.freeze({
  DRAFT: ['LOCKED', 'OPEN', 'CANCELLED'], // on funding: LOCKED if upstream tiles pending, else OPEN
  LOCKED: ['OPEN', 'CANCELLED'], // every upstream tile ACCEPTED
  OPEN: ['OFFERED', 'CLAIMED', 'CANCELLED'],
  OFFERED: ['CLAIMED', 'OPEN'], // claim window ends -> open board
  CLAIMED: ['SUBMITTED', 'OPEN'], // claim expired or released
  SUBMITTED: ['IN_REVIEW'],
  IN_REVIEW: ['ACCEPTED', 'REVISION', 'OPEN'], // OPEN when it fails with revisionCount >= 2
  REVISION: ['SUBMITTED', 'OPEN'],
  ACCEPTED: [], // payout, fee and reputation written in the same transaction
  CANCELLED: [],
});

export const commissionTransitions = Object.freeze({
  DRAFT: ['SCOPING', 'CANCELLED'],
  SCOPING: ['PLANNED', 'CANCELLED'], // Decomposer returned a graph
  PLANNED: ['FUNDED', 'SCOPING', 'CANCELLED'],
  FUNDED: ['ACTIVE'],
  ACTIVE: ['ASSEMBLING', 'CANCELLED'], // cancel refunds unspent escrow
  ASSEMBLING: ['DELIVERED'],
  DELIVERED: ['ACCEPTED', 'DISPUTED'], // auto-accept after 7 days
  DISPUTED: ['ACCEPTED', 'ACTIVE'], // panel upholds, or reopens named tiles
  ACCEPTED: [],
  CANCELLED: [],
});

export const TILE_STATUSES = Object.keys(tileTransitions);
export const COMMISSION_STATUSES = Object.keys(commissionTransitions);

export class TransitionError extends Error {
  constructor(entity, from, to) {
    super(`${entity} cannot move from ${from} to ${to}`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(map, from, to) {
  return Array.isArray(map[from]) && map[from].includes(to);
}

export function assertTileTransition(from, to) {
  if (!canTransition(tileTransitions, from, to)) throw new TransitionError('Tile', from, to);
}

export function assertCommissionTransition(from, to) {
  if (!canTransition(commissionTransitions, from, to)) throw new TransitionError('Commission', from, to);
}

/** Tile states in which a contributor currently holds the tile. */
export const HELD_STATUSES = Object.freeze(['CLAIMED', 'SUBMITTED', 'IN_REVIEW', 'REVISION']);
export const TERMINAL_TILE = Object.freeze(['ACCEPTED', 'CANCELLED']);
