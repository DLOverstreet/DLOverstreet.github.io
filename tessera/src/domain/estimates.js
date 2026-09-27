// Estimates self-correct: the median ratio of actual to estimated minutes per skill tag
// is applied to new tiles, so tile types that keep running long get more time and pay.
import { config } from './config.js';
import { median, clamp } from '../lib/util.js';

/** @param {{tags: string[], estMinutes: number, minutesSpent: number}[]} samples */
export function calibrationRatios(samples, cfg = config) {
  const byTag = {};
  for (const s of samples) {
    if (!s.estMinutes || !s.minutesSpent) continue;
    for (const t of s.tags) (byTag[t] ||= []).push(s.minutesSpent / s.estMinutes);
  }
  const out = {};
  for (const [tag, ratios] of Object.entries(byTag)) {
    if (ratios.length < cfg.calibration.minSamples) continue;
    out[tag] = { ratio: Math.round(clamp(median(ratios), cfg.calibration.minRatio, cfg.calibration.maxRatio) * 100) / 100, n: ratios.length };
  }
  return out;
}

/** Applies calibration to one estimate. Rounds to 5 minutes and keeps it within tile limits. */
export function calibrateEstimate(estMinutes, tags, ratios, cfg = config) {
  const used = tags.filter((t) => ratios[t]);
  if (!used.length) return { estMinutes, ratio: 1, tagsUsed: [] };
  const ratio = median(used.map((t) => ratios[t].ratio));
  const adjusted = clamp(Math.round((estMinutes * ratio) / 5) * 5, cfg.tileMinutes.min, cfg.tileMinutes.max);
  return { estMinutes: adjusted, ratio, tagsUsed: used };
}
