// Weekly availability windows in a contributor's own time zone.
// A window is { day: 0-6 (Sunday = 0), start: "HH:MM", end: "HH:MM" }.
import { DAY, MINUTE } from '../lib/util.js';

const formatters = new Map();
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(tz);
}

/** Minutes to add to UTC to get local time in `tz` at instant `ms`. */
export function tzOffsetMinutes(ms, tz) {
  try {
    const parts = Object.fromEntries(formatterFor(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
  } catch {
    return 0;
  }
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * The next instant (ms) at which the contributor is inside an availability window,
 * or `now` if they are in one already. Returns null if they have no windows.
 */
export function nextAvailableAt(now, windows, tz) {
  if (!windows || !windows.length) return null;
  const off = tzOffsetMinutes(now, tz || 'UTC') * MINUTE;
  const localNow = now + off;
  const localMidnight = Math.floor(localNow / DAY) * DAY;
  const today = new Date(localMidnight).getUTCDay();
  let best = null;
  for (let d = 0; d <= 7; d++) {
    const dayStart = localMidnight + d * DAY;
    const dow = (today + d) % 7;
    for (const w of windows) {
      if (Number(w.day) !== dow) continue;
      const s = toMinutes(w.start);
      let e = toMinutes(w.end);
      if (e <= s) e += 24 * 60; // crosses midnight
      const startLocal = dayStart + s * MINUTE;
      const endLocal = dayStart + e * MINUTE;
      if (endLocal <= localNow) continue;
      const at = Math.max(startLocal, localNow) - off;
      if (best === null || at < best) best = at;
    }
  }
  return best;
}

export function isAvailableNow(now, windows, tz) {
  return nextAvailableAt(now, windows, tz) === now;
}

export function weeklyWindowHours(windows) {
  let min = 0;
  for (const w of windows || []) {
    let e = toMinutes(w.end);
    const s = toMinutes(w.start);
    if (e <= s) e += 24 * 60;
    min += e - s;
  }
  return Math.round(min / 6) / 10;
}

export const DAY_NAMES = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
