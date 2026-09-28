// How long work takes. Throughput rates turn a count ("5,000 listings", "40 pages",
// "20 hours of audio") into minutes, and size hints turn one named piece ("show notes",
// "a lesson") into minutes. Figures are typical for a practiced person working carefully;
// the calibration in src/domain/estimates.js corrects them from real submissions.

/** Units handled per hour, by kind of work and unit. */
export const RATES = {
  translate: { word: 350, page: 1.1, question: 7, post: 2.5, slide: 10, section: 1.5, document: 0.6, item: 25, listing: 25, lesson: 0.6, chapter: 0.25, episode: 0.6, minute: 5, 'hour-media': 0.1, record: 60, response: 40, email: 3, recipe: 2, screen: 3 },
  transcribe: { 'hour-media': 0.6, minute: 36, interview: 0.6, episode: 0.6, video: 0.8 },
  code: { response: 45, record: 80, document: 6, interview: 0.8, paper: 12, listing: 150, item: 120, photo: 100, transaction: 150, post: 40, contact: 120 },
  clean: { record: 400, listing: 120, item: 150, photo: 80, transaction: 300, contact: 200, response: 200, document: 20, paper: 100 },
  enrich: { record: 150, listing: 70, item: 60, photo: 60, contact: 40, transaction: 150, paper: 40 },
  catalog: { item: 20, photo: 40, document: 15, record: 60, listing: 30 },
  write: { listing: 12, item: 12, photo: 30, recipe: 1.5, post: 2, question: 5, page: 0.8, word: 450, section: 1, lesson: 0.7, chapter: 0.2, episode: 1.5, 'hour-media': 3, interview: 3, video: 2, paper: 4, document: 1, contact: 6, transaction: 60, screen: 3 },
  edit: { word: 1500, page: 5, post: 6, question: 20, section: 4, chapter: 0.8, listing: 60, lesson: 2, document: 3, episode: 1, 'hour-media': 1 },
  research: { contact: 6, paper: 40, listing: 25, item: 15, document: 5, record: 60, region: 2 },
  outreach: { contact: 10, person: 5, item: 6, document: 4 },
  collect: { record: 1500, listing: 500, document: 12, contact: 30, paper: 30, photo: 30, year: 1.5, month: 12, quarter: 4, region: 2 },
  analyze: { record: 5000, response: 400, year: 3, month: 20, region: 4, transaction: 1000 },
  finance: { transaction: 150, month: 1.5, quarter: 0.5, year: 0.15, invoice: 20, account: 1 },
  design: { slide: 8, photo: 20, post: 3, chart: 1, page: 1, item: 6, listing: 20, screen: 1.2 },
  visualize: { chart: 1, region: 3 },
  media: { episode: 0.5, video: 0.6, minute: 3, 'hour-media': 0.3, photo: 30, interview: 0.7 },
  teach: { lesson: 0.7, question: 12, slide: 8, section: 1 },
  test: { screen: 4, page: 3, record: 500, listing: 150, item: 60, response: 150 },
  migrate: { record: 2000, document: 30, listing: 400 },
  legal: { document: 1, page: 3, contact: 2 },
  schedule: { person: 40, region: 2, item: 20 },
  web: { page: 0.7, screen: 0.7, section: 2 },
  software: { screen: 0.4, section: 0.5 },
};

/** Minutes for one named piece with no count, by what the phrase says it is. First match wins. */
/** @type {[RegExp, number][]} */
export const SIZE_HINTS = [
  [/\b(?:tweets?|social(?: media)? posts?|captions?|instagram|linkedin posts?)\b/, 20],
  [/\bshow notes\b|\bepisode description\b/, 35],
  [/\bthumbnails?\b|\bgraphics?\b|\bbanner\b|\bsocial graphic/, 30],
  [/\bemails?\b|\bnewsletter\b/, 45],
  [/\bquiz(?:zes)?\b|\bworksheets?\b|\bexit tickets?\b/, 40],
  [/\bslides?\b|\bdeck\b/, 75],
  [/\bcover art|\blogo\b|\bposter\b|\bflyer\b|\binvitations?\b|\bbrochure\b/, 90],
  [/\blessons?\b|\bmodules?\b|\blesson plans?\b/, 105],
  [/\bfacilitator guide|\bteacher'?s? guide|\bhandbook\b|\bguide\b/, 105],
  [/\binterview\b/, 75],
  [/\brecord\b|\bfilm\b|\bshoot\b/, 90],
  [/\bedit\b.*\b(?:episode|audio|video|footage)\b|\bmix\b/, 120],
  [/\bresearch\b.*\bepisode|\bepisode research|\bscript\b|\boutline\b/, 75],
  [/\bletters? of (?:support|commitment)|\bsupport letters?\b/, 30],
  [/\bstatement\b|\bnarrative\b|\bsection\b|\bsummary\b|\babstract\b|\boverview\b/, 90],
  [/\bmemo\b|\bnote\b|\bbrief\b/, 75],
  [/\breport\b|\bsynthesis\b|\bwhite paper\b/, 120],
  [/\bfaq\b/, 60],
  [/\bcopy\b|\bhours\b|\bwhat to bring\b|\bhow to\b|\babout us\b|\bcontact\b/, 30],
  [/\brun[- ]of[- ]show|\bagenda\b|\bitinerary\b|\bschedule\b|\bshifts?\b/, 75],
  [/\bbudget\b|\bprofit and loss|\bp&l\b|\bcash flow|\bprojections?\b/, 90],
  [/\btracker\b|\bdashboard view\b|\blog\b/, 60],
  [/\bmap\b/, 75],
  [/\bchart\b|\bgraph\b|\btrends?\b|\bbreakdown\b/, 60],
  [/\bquotes?\b|\bshortlist\b|\bvenues?\b|\bvendors?\b|\bcatering\b/, 75],
  [/\bregistration\b|\bsign-?up\b|\bdonation page\b|\blanding page\b/, 90],
  [/\badmin\b/, 180],
  [/\bpush\b|\bnotifications?\b|\breminders?\b/, 150],
  [/\bqr\b|\bcheck[- ]in\b|\bscan\b/, 150],
  [/\blogin\b|\buser accounts?\b|\bsign[- ]in\b|\bauth/, 150],
  [/\bsign up for\b|\bbook(?:ing)?\b|\breserv/, 180],
  [/\bquestionnaire\b/, 60],
  [/\btabulat/, 90],
  [/\bsurvey of\b|\bsurvey\b/, 120],
  [/\bcompetitor|\bcompetitive\b|\bprices\b/, 90],
  [/\bcounts?\b|\bfoot traffic\b|\bpublic data\b/, 90],
];

/** Default minutes for one piece of each kind of work when nothing else says how big it is. */
export const DEFAULT_MINUTES = {
  collect: 90, clean: 60, enrich: 75, code: 60, transcribe: 90, catalog: 60, analyze: 90, visualize: 60,
  write: 75, edit: 45, translate: 60, design: 75, web: 105, software: 150, research: 75, outreach: 60,
  schedule: 60, media: 90, teach: 90, finance: 75, legal: 75, test: 45, migrate: 90,
};

/** Tiles aim for this many minutes; 30 to 90 is the sweet spot, 15 to 120 the hard limits. */
export const TARGET_MINUTES = 75;
export const SWEET = { min: 30, max: 90 };
export const LIMITS = { min: 15, max: 120 };
/** Minutes every tile spends reading its inputs and the shared conventions before starting. */
export const TILE_OVERHEAD = 10;

/** Tier floors for skills whose practitioners can't be hired at a lower rate. */
export const SKILL_TIER_FLOOR = {
  python: 3, 'web-scraping': 3, geocoding: 3, statistics: 3, econometrics: 4, 'web-dev': 3, javascript: 3, 'mobile-dev': 3,
  sql: 3, 'legal-research': 3, 'grant-writing': 3, 'literature-review': 3, methodology: 3, 'ux-design': 2,
};

/** Units per hour for a kind of work on a unit, or null when there is no rate. */
export function rateFor(archetype, unit) {
  const r = RATES[archetype];
  if (!r) return null;
  if (r[unit] !== undefined) return r[unit];
  const alias = { invoice: 'transaction', receipt: 'transaction', expense: 'transaction', person: 'contact', response: 'record', question: 'item', chapter: 'section', year: 'month' };
  const a = alias[unit];
  if (a && r[a] !== undefined) return a === 'month' && unit === 'year' ? r[a] / 12 : r[a];
  return null;
}

/** Minutes for one piece with no count. */
export function sizeHint(phrase, archetype) {
  const p = String(phrase).toLowerCase();
  for (const [re, min] of SIZE_HINTS) if (re.test(p)) return min;
  return DEFAULT_MINUTES[archetype] || 75;
}

export const clampMinutes = (m) => Math.max(LIMITS.min, Math.min(LIMITS.max, Math.round(m / 5) * 5));

/**
 * Splits `n` units of work, each taking `minutesPerUnit`, into batches near the target size.
 * Returns [{ index, of, from, to, count, minutes }]; one batch when it all fits in one tile.
 */
export function partition(n, minutesPerUnit, { target = TARGET_MINUTES, overhead = TILE_OVERHEAD, maxBatches = 40 } = {}) {
  const total = n * minutesPerUnit;
  if (total + overhead <= LIMITS.max || n <= 1) {
    return [{ index: 1, of: 1, from: 1, to: n, count: n, minutes: clampMinutes(total + overhead) }];
  }
  let per = Math.max(1, Math.round((target - overhead) / minutesPerUnit));
  while (per > 1 && per * minutesPerUnit + overhead > LIMITS.max) per -= 1;
  let k = Math.ceil(n / per);
  // Past the cap, this plan covers the first part and the rest waits for a second phase.
  let covered = n;
  if (k > maxBatches) { k = maxBatches; covered = Math.min(n, k * per); }
  /** @type {any} */
  const out = [];
  for (let i = 0; i < k; i++) {
    const from = Math.round((i * covered) / k) + 1;
    const to = Math.round(((i + 1) * covered) / k);
    if (to < from) continue;
    const count = to - from + 1;
    out.push({ index: out.length + 1, of: 0, from, to, count, minutes: clampMinutes(count * minutesPerUnit + overhead) });
  }
  out.forEach((b) => { b.of = out.length; });
  if (covered < n) out.deferred = { from: covered + 1, to: n };
  return out;
}
