// Shared service plumbing: errors, lookups, and the two transition functions. Every tile
// and commission status change goes through transitionTile / transitionCommission, which
// check the state machine and write the change and its side effects (payouts, fees,
// reputation, unlocking downstream tiles, refunds) inside the caller's transaction.
import { assertTileTransition, assertCommissionTransition } from '../domain/transitions.js';
import { acceptanceEntries, refundEntry, findOverdraw, commissionBalance } from '../domain/ledger.js';
import { REP_REASONS } from '../domain/reputation.js';
import { claimLockMs } from '../domain/matching.js';
import { config } from '../domain/config.js';

export class UserError extends Error {
  constructor(message) { super(message); this.name = 'UserError'; }
}

export function must(value, message) {
  if (!value) throw new UserError(message);
  return value;
}

export function getUser(tx, id) {
  return must(tx.get('User', id), 'Unknown user.');
}

export function profileOf(tx, userId) {
  return tx.find('ContributorProfile', (p) => p.userId === userId);
}

export function tilesOf(tx, commissionId) {
  return tx.filter('Tile', (t) => t.commissionId === commissionId);
}

export function edgesOf(tx, commissionId) {
  const ids = new Set(tilesOf(tx, commissionId).map((t) => t.id));
  return tx.filter('TileEdge', (e) => ids.has(e.toTileId));
}

export function upstreamIds(tx, tileId) {
  return tx.filter('TileEdge', (e) => e.toTileId === tileId).map((e) => e.fromTileId);
}

export function downstreamIds(tx, tileId) {
  return tx.filter('TileEdge', (e) => e.fromTileId === tileId).map((e) => e.toTileId);
}

export function platformUser(tx) {
  return tx.find('User', (u) => u.isAdmin);
}

/** Inserts ledger entries and refuses any that would take the escrow below zero. */
export function postLedger(tx, entries) {
  const rows = [];
  for (const e of entries) {
    if (!e) continue;
    rows.push(tx.insert('LedgerEntry', e));
  }
  const ids = new Set(rows.map((r) => r.commissionId).filter(Boolean));
  const all = tx.all('LedgerEntry');
  for (const cid of ids) {
    const bad = findOverdraw(all, cid);
    if (bad) throw new Error(`Escrow for this commission would go negative (${bad.type}). Nothing was paid.`);
  }
  return rows;
}

export function postReputation(tx, { userId, tags, reason, tileId = null, tier = null, note = null }) {
  const rule = REP_REASONS[reason];
  for (const tag of tags) {
    tx.insert('ReputationEvent', { userId, skillTag: tag, delta: rule.delta, reason, tileId, tier, note });
  }
}

function logChange(tx, entity, row, from, to, actor, note) {
  tx.insert('StatusChange', {
    entity, entityId: row.id, commissionId: entity === 'Commission' ? row.id : row.commissionId,
    from, to, actor: actor || 'system', note: note || null,
  });
}

/**
 * Moves a tile to `to`, applying the side effects of that move.
 * @param {object} tx transaction
 * @param {string} tileId
 * @param {string} to target status
 * @param {string} actor user id or agent name
 * @param {object} [opts] { patch, note, rematch, noVerify }
 */
export function transitionTile(tx, tileId, to, actor, opts = {}) {
  const tile = must(tx.get('Tile', tileId), 'Tile not found.');
  assertTileTransition(tile.status, to);
  const now = tx.now();
  const patch = { ...(opts.patch || {}), status: to };

  if (to === 'CLAIMED') {
    must(patch.claimedById, 'A claim needs a contributor.');
    patch.claimedAt = now;
    patch.claimExpiresAt = now + claimLockMs(tile.estMinutes);
  }
  if (to === 'OPEN' && ['CLAIMED', 'REVISION', 'IN_REVIEW'].includes(tile.status)) {
    patch.claimedById = null;
    patch.claimExpiresAt = null;
  }
  const next = tx.update('Tile', tileId, patch);
  logChange(tx, 'Tile', next, tile.status, to, actor, opts.note);

  if (to === 'OPEN' && (tile.status === 'DRAFT' || tile.status === 'LOCKED' || opts.rematch)) {
    tx.enqueue('match', { tileId }, { dedupeKey: `match:${tileId}` });
  }
  if (to === 'SUBMITTED' && !opts.noVerify) {
    tx.enqueue('verify', { submissionId: opts.submissionId, tileId }, { dedupeKey: `verify:${opts.submissionId}` });
  }
  if (to === 'CANCELLED' || to === 'CLAIMED') {
    for (const o of tx.filter('Offer', (x) => x.tileId === tileId && x.response === 'PENDING')) {
      if (to === 'CLAIMED' && o.contributorId === patch.claimedById) continue;
      tx.update('Offer', o.id, { response: 'WITHDRAWN', respondedAt: now });
    }
  }
  if (to === 'ACCEPTED') onTileAccepted(tx, next, actor);
  return next;
}

function onTileAccepted(tx, tile, actor) {
  const contributorId = must(tile.claimedById, 'An accepted tile needs a contributor.');
  postLedger(tx, acceptanceEntries({ commissionId: tile.commissionId, tile, contributorId }));
  const tags = tile.reviewOf ? tx.get('Tile', tile.reviewOf.tileId)?.skillTags || tile.skillTags : tile.skillTags;
  postReputation(tx, { userId: contributorId, tags, reason: tile.kind === 'REVIEW' && tile.dynamic ? 'REVIEW_COMPLETED' : 'ACCEPTED', tileId: tile.id, tier: tile.tier });

  // Open downstream tiles whose upstream tiles are now all accepted.
  for (const downId of downstreamIds(tx, tile.id)) {
    const down = tx.get('Tile', downId);
    if (!down || down.status !== 'LOCKED') continue;
    const ups = upstreamIds(tx, downId).map((id) => tx.get('Tile', id));
    if (ups.every((u) => u && (u.status === 'ACCEPTED' || u.status === 'CANCELLED'))) {
      transitionTile(tx, downId, 'OPEN', 'system', { note: 'Every upstream tile was accepted' });
    }
  }
  maybeStartAssembly(tx, tile.commissionId, actor);
}

export function maybeStartAssembly(tx, commissionId, actor = 'system') {
  const c = tx.get('Commission', commissionId);
  if (!c || c.status !== 'ACTIVE') return;
  const tiles = tilesOf(tx, commissionId);
  if (tiles.length && tiles.every((t) => t.status === 'ACCEPTED' || t.status === 'CANCELLED')) {
    transitionCommission(tx, commissionId, 'ASSEMBLING', actor, { note: 'Every tile is accepted' });
  }
}

/** Refunds what is left in escrow, returning the most recent funding first (so an unused platform guarantee goes back to the platform). */
export function refundRemaining(tx, commissionId) {
  let left = commissionBalance(tx.all('LedgerEntry'), commissionId);
  if (left <= 0) return;
  const entries = tx.all('LedgerEntry').filter((e) => e.commissionId === commissionId);
  const byFunder = new Map();
  for (const e of entries) {
    if (!e.userId) continue;
    if (e.type === 'ESCROW_FUND') byFunder.set(e.userId, { funded: (byFunder.get(e.userId)?.funded || 0) + e.amountCents, refunded: byFunder.get(e.userId)?.refunded || 0, last: e.createdAt });
    if (e.type === 'REFUND') { const f = byFunder.get(e.userId) || { funded: 0, refunded: 0, last: 0 }; f.refunded -= e.amountCents; byFunder.set(e.userId, f); }
  }
  const funders = [...byFunder.entries()].sort((a, b) => b[1].last - a[1].last);
  for (const [userId, f] of funders) {
    if (left <= 0) break;
    const amt = Math.min(left, f.funded - f.refunded);
    if (amt > 0) {
      postLedger(tx, [refundEntry({ commissionId, requesterId: userId, amountCents: amt })]);
      left -= amt;
    }
  }
}

/**
 * Moves a commission to `to`, applying its side effects.
 * @param {object} [opts] { patch, note }
 */
export function transitionCommission(tx, commissionId, to, actor, opts = {}) {
  const c = must(tx.get('Commission', commissionId), 'Commission not found.');
  assertCommissionTransition(c.status, to);
  const now = tx.now();
  const patch = { ...(opts.patch || {}), status: to };
  if (to === 'DELIVERED') {
    patch.deliveredAt = now;
    patch.autoAcceptAt = now + config.autoAcceptMs;
  }
  if (to === 'ACCEPTED') patch.acceptedAt = now;
  const next = tx.update('Commission', commissionId, patch);
  logChange(tx, 'Commission', next, c.status, to, actor, opts.note);
  if (to === 'ASSEMBLING') tx.enqueue('assemble', { commissionId }, { dedupeKey: `assemble:${commissionId}` });
  if (to === 'ACCEPTED' || to === 'CANCELLED') refundRemaining(tx, commissionId);
  return next;
}

/** Everyone who has held or submitted work on a commission (they can't review or sit on its panel). */
export function commissionWorkers(tx, commissionId) {
  const ids = new Set();
  const dynamic = new Set();
  for (const t of tilesOf(tx, commissionId)) {
    if (t.dynamic) { dynamic.add(t.id); continue; }
    if (t.claimedById) ids.add(t.claimedById);
  }
  for (const s of tx.filter('Submission', (x) => x.commissionId === commissionId && !dynamic.has(x.tileId))) ids.add(s.contributorId);
  return ids;
}

/** Everyone who has held or submitted work on one tile. */
export function tileWorkers(tx, tileId) {
  const ids = new Set();
  const t = tx.get('Tile', tileId);
  if (t?.claimedById) ids.add(t.claimedById);
  for (const s of tx.filter('Submission', (x) => x.tileId === tileId)) ids.add(s.contributorId);
  return ids;
}
