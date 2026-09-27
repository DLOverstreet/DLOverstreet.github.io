// Pay depends only on the work: estimated time, a tier rate and a rush premium.
//   pay            = (estMinutes / 60) × rate(tier) × (1 + 0.25 × rush)
//   requester cost = pay × 1.10
import { config } from './config.js';

export function tierRate(tier, cfg = config) {
  const r = cfg.tierRates[tier];
  if (!r) throw new Error(`Unknown tier ${tier}`);
  return r;
}

/** Rush applies when the deadline is under 72 hours from `now`. */
export function isRush(deadlineMs, nowMs, cfg = config) {
  return deadlineMs - nowMs < cfg.rushWindowMs;
}

export function tilePayCents({ estMinutes, tier }, { rush = false } = {}, cfg = config) {
  return Math.round((estMinutes / 60) * tierRate(tier, cfg) * (1 + cfg.rushPremium * (rush ? 1 : 0)));
}

export function feeCents(payCents, cfg = config) {
  return Math.round(payCents * cfg.feeRate);
}

/** Pay for one peer review of a tile: a short tile at the reviewed tile's tier. */
export function reviewPayCents(tier, { rush = false } = {}, cfg = config) {
  return tilePayCents({ estMinutes: cfg.reviewTileMinutes, tier }, { rush }, cfg);
}

/** Effective hourly rate of a priced tile, in cents per hour. */
export function effectiveHourlyCents(tile) {
  return Math.round(tile.payCents / (tile.estMinutes / 60));
}

/** WORK and INTEGRATION tiles carry a peer review reserve; REVIEW tiles don't. */
export function needsReviewReserve(tile) {
  return tile.kind !== 'REVIEW';
}

/**
 * Prices a whole graph. Tiles need { key, kind, tier, estMinutes }.
 * The review reserve funds one peer review per work tile and is refunded if unused.
 */
export function priceGraph(tiles, { rush = false } = {}, cfg = config) {
  const lines = tiles.map((t) => {
    const pay = tilePayCents(t, { rush }, cfg);
    const fee = feeCents(pay, cfg);
    const reserve = needsReviewReserve(t) ? reviewPayCents(t.tier, { rush }, cfg) : 0;
    const reserveFee = reserve ? feeCents(reserve, cfg) : 0;
    return { key: t.key, title: t.title, kind: t.kind, tier: t.tier, estMinutes: t.estMinutes, pay, fee, reserve, reserveFee };
  });
  const payTotal = lines.reduce((n, l) => n + l.pay, 0);
  const feeTotal = lines.reduce((n, l) => n + l.fee, 0);
  const reserveTotal = lines.reduce((n, l) => n + l.reserve + l.reserveFee, 0);
  return { lines, rush, payTotal, feeTotal, reserveTotal, total: payTotal + feeTotal + reserveTotal };
}
