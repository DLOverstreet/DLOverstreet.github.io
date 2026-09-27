// The ledger is append-only. Each entry's signed amount is its effect on the
// commission's escrow: funding is positive; payouts, fees and refunds are negative.
// Every balance in the app (escrow, earnings, platform revenue) is recomputed from it.
import { feeCents } from './pricing.js';

export const LEDGER_TYPES = Object.freeze(['ESCROW_FUND', 'TILE_PAYOUT', 'REVIEW_PAYOUT', 'PARTIAL_PAYOUT', 'PLATFORM_FEE', 'REFUND']);
export const PAYOUT_TYPES = Object.freeze(['TILE_PAYOUT', 'REVIEW_PAYOUT', 'PARTIAL_PAYOUT']);

function entry(type, amountCents, fields) {
  if (!Number.isInteger(amountCents)) throw new Error(`Ledger amounts are integer cents (got ${amountCents})`);
  return { type, amountCents, userId: null, commissionId: null, tileId: null, memo: null, ...fields };
}

export function fundingEntry({ commissionId, funderId, amountCents, memo = 'Escrow funded' }) {
  if (amountCents <= 0) throw new Error('Funding must be positive');
  return entry('ESCROW_FUND', amountCents, { commissionId, userId: funderId, memo });
}

/** Pay for an accepted tile plus the platform fee on it. */
export function acceptanceEntries({ commissionId, tile, contributorId }) {
  const type = tile.kind === 'REVIEW' ? 'REVIEW_PAYOUT' : 'TILE_PAYOUT';
  return [
    entry(type, -tile.payCents, { commissionId, tileId: tile.id, userId: contributorId, memo: `${tile.title}` }),
    entry('PLATFORM_FEE', -feeCents(tile.payCents), { commissionId, tileId: tile.id, memo: `10% fee on ${tile.title}` }),
  ];
}

export function partialPayEntries({ commissionId, tile, contributorId, amountCents }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Partial pay must be a positive whole number of cents');
  if (amountCents > tile.payCents) throw new Error('Partial pay cannot exceed the tile’s full pay');
  return [
    entry('PARTIAL_PAYOUT', -amountCents, { commissionId, tileId: tile.id, userId: contributorId, memo: `Partial pay for usable work on ${tile.title}` }),
    entry('PLATFORM_FEE', -feeCents(amountCents), { commissionId, tileId: tile.id, memo: `10% fee on partial pay` }),
  ];
}

export function refundEntry({ commissionId, requesterId, amountCents, memo = 'Unspent escrow refunded' }) {
  if (amountCents <= 0) return null;
  return entry('REFUND', -amountCents, { commissionId, userId: requesterId, memo });
}

export function commissionBalance(entries, commissionId) {
  let b = 0;
  for (const e of entries) if (e.commissionId === commissionId) b += e.amountCents;
  return b;
}

/** Funds a commission still owes to tiles that are neither accepted nor cancelled. */
export function committedCents(tiles) {
  let c = 0;
  for (const t of tiles) {
    if (t.status !== 'ACCEPTED' && t.status !== 'CANCELLED' && t.status !== 'DRAFT') c += t.payCents + feeCents(t.payCents);
  }
  return c;
}

/** Escrow not yet promised to any open tile: the review reserve and any leftovers. */
export function uncommittedCents(entries, commissionId, tiles) {
  return commissionBalance(entries, commissionId) - committedCents(tiles);
}

export function userEarnings(entries, userId, { since = -Infinity, until = Infinity } = {}) {
  let t = 0;
  for (const e of entries) {
    if (e.userId === userId && PAYOUT_TYPES.includes(e.type) && e.createdAt >= since && e.createdAt <= until) t -= e.amountCents;
  }
  return t;
}

export function earningsByUser(entries, opts = {}) {
  const out = {};
  for (const e of entries) {
    if (!e.userId || !PAYOUT_TYPES.includes(e.type)) continue;
    if (opts.since !== undefined && e.createdAt < opts.since) continue;
    out[e.userId] = (out[e.userId] || 0) - e.amountCents;
  }
  return out;
}

export function platformRevenue(entries) {
  return -entries.filter((e) => e.type === 'PLATFORM_FEE').reduce((n, e) => n + e.amountCents, 0);
}

/** Net amount a funder has put in: funding minus refunds. */
export function funderNet(entries, userId) {
  let t = 0;
  for (const e of entries) {
    if (e.userId !== userId) continue;
    if (e.type === 'ESCROW_FUND') t += e.amountCents;
    if (e.type === 'REFUND') t += e.amountCents;
  }
  return t;
}

/** Checks that no prefix of the commission's entries ever takes escrow below zero. */
export function findOverdraw(entries, commissionId) {
  let b = 0;
  for (const e of entries) {
    if (e.commissionId !== commissionId) continue;
    b += e.amountCents;
    if (b < 0) return e;
  }
  return null;
}
