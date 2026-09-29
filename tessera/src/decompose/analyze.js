// Reads a job the way a good project lead would before splitting it: what kind of job it
// is, which separate pieces of work it names, how many of each, in which languages, for
// whom, in what formats, whether the inputs are sensitive, and what it takes for granted.
// Pure and deterministic, so the same job always reads the same way.
import {
  NUMBER_WORDS, UNITS, LANGUAGES, LANGUAGE_NAMES, AUDIENCE_NOUNS, FORMAT_CUES,
  QUALITY_CUES, ARCHETYPES, FRAMES, FRAME_DEFAULTS,
} from './lexicon.js';

const NUM_WORDS = Object.keys(NUMBER_WORDS).join('|');
const NUM = `(\\d[\\d,]*(?:\\.\\d+)?|${NUM_WORDS})`;
const PREPS = new Set(['of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'and', 'or', 'per', 'each', 'the', 'a', 'an', 'our', 'my', 'your', 'their', 'into', 'about', 'than', 'is', 'are', 'was', 'were', 'be', 'we', 'it', 'that', 'which', 'call', 'calls']);
const LANG_RE = 'english|spanish|french|chinese|mandarin|cantonese|vietnamese|arabic|portuguese|german|korean|japanese|russian|hindi|tagalog|somali|navajo|italian|haitian creole|swahili|ukrainian';
const FILLER = /^(?:(?:and|also|plus|then|finally|lastly|next|first|second|third)\s*,?\s+)?(?:please\s+)?(?:(?:[\w'-]+\s+){1,3}?(?:need|needs|want|wants|would like|'d like|require|requires|expect|are looking for|is looking for|looking for)(?:\s+(?:you|someone|help|a contributor))?(?:\s+to)?|it should also (?:include|have|cover)|(?:it|this) (?:should|must|needs to) (?:include|have|cover)|help (?:us|me)(?: to)?|can you|could you|the job is to|the goal is to|our goal is to|deliverables?(?: are| include)?:?)\s+/i;
const LEADING = /^(?:(?:and|or|also|plus|then|with|as well as|including)\s+|(?:finally|lastly|next|then|also|after that|afterwards?|first|second|third|to finish)\s*,\s*|(?:finally|lastly|afterwards?)\s+)/i;
/** "no more than 3 recommendations": a cap on a named part, not a rule for the whole job. */
const CAP = /^(?:no more than|not more than|at most|up to|a maximum of|maximum of)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/i;
/** "…, each with a rough cost": what every one of the things before it carries. */
const EACH_WITH = /^(?:each|each one|every one)\s+(?:with|having|including|showing|listing|citing)\b/i;
/** A phrase that names only a data file to hand back: "Produce a coded_all.csv". */
const FILE_ONLY = /^(?:(?:produce|deliver|create|export|save|make|return|provide|send|give us|hand (?:back|in)|output)\s+)?(?:a|an|the|one|our)?\s*([\w-]+\.(?:csv|tsv|xlsx))$/i;
/** A lead that names a table or data file, whose "with" list is its columns. */
const TABLE_LEAD = /\.(?:csv|tsv|xlsx)\b|\b(?:spreadsheet|csv|data ?set|table)\b/i;
const COLUMNISH = /^[a-z][a-z0-9_]*(?:\s[a-z][a-z0-9_]*)?$/i;
/** Parts of work that stand on their own even when listed inside a short document. */
const SEPARABLE = new Set(['finance', 'visualize', 'design', 'media', 'web', 'software', 'collect', 'outreach', 'schedule', 'translate', 'analyze']);
const PURPOSE = /,?\s+(?:so that|so|because|since|in order to|which will|to help|to make sure|to ensure|to let)\s+/i;
/** Verbs that apply to each object in a list: "translate the flyer and the FAQ" is two pieces of work. */
const DISTRIBUTIVE = /^(?:translate|locali[sz]e|transcribe|proofread|copyedit|edit|clean|code|categori[sz]e|tag|fix|summari[sz]e|review|redesign|update|digiti[sz]e|catalog(?:ue)?|geocode|convert|migrate|move|port|transfer)$/;
/** Verbs that describe making a new product; any other verb on a product (audit, fix, migrate) is itself a piece of work. */
const MAKE_VERB = /^(?:build|create|make|design|develop|launch|set up|setup|start|produce|write|plan|run|put together)$/;
const GENERIC_VERB = /^(?:write|build|create|make|design|set up|setup|plan|produce|prepare|develop|put together|get|find|do|handle|draft|deliver|provide|come up with|assemble|run|launch|start)$/;
/** Verbs that add a detail to the piece before them ("transcribe them, add timestamps") rather than a new piece. */
const DETAIL_VERB = /^(?:add|include|insert|mark|note|flag|label|attach|highlight|format|keep|number)$/;
const COMMON_VERB = /^(?:arrange|secure|reserve|rent|buy|purchase|mail|ship|move|scan|caption|animate|repair|replace|upgrade|port|transfer|redirect|audit|improve|optimi[sz]e|redesign|refresh|field|tabulate|screen|extract|recruit|package|merge|apply|double-code|de-identify|scope|spot-check|integrate|write|draft|build|create|make|design|translate|record|edit|find|get|set|recruit|research|interview|clean|code|collect|analy[sz]e|map|chart|test|publish|produce|prepare|develop|shoot|film|mix|reconcile|categori[sz]e|fill|fix|tag|transcribe|book|plan|schedule|train|launch|review|check|compile|summari[sz]e|add|include|host|run|send|call|email|contact|identify|compare|pull|scrape|update|organi[sz]e|coordinate|photograph|catalog|illustrate|proofread|audit|survey|estimate|forecast|model|price|order|source|shortlist|pick|choose|select|upload|post|share|promote|pitch|track|measure|evaluate|assess|outline|storyboard|narrate|voice|hire|onboard|deploy|host|migrate|convert|import|export|digiti[sz]e|geocode|link|merge|combine|split|format|style|brand|lay|print|package)$/;
const CONVENTION_NOUNS = /^(?:(?:a|an|the|new|shared|single|one|clear|consistent)\s+)?(?:[\w-]+\s+){0,2}?(codebook|glossary|style ?(?:guide|sheet)|brand (?:guide|kit)|data dictionary|search protocol|protocol|outline|template|api (?:contract|spec)|data model|schema|taxonomy|wireframes?|site ?map|information architecture|creative brief|message brief|lesson template|course outline|season outline|run sheet template)\b/i;
const CHECK_CUES = /\b(agree|agreement|consisten\w*|reliab\w*|kappa|double[- ]cod\w*|inter-?rater|spot[- ]check|quality[- ]check|qa\b|proofread\w*|fact[- ]check\w*|verif\w*|audit\w*|test\w*|usability)\b/i;
const SUBSET = /\b(missing|that have none|that don'?t have|without (?:a|an|any)|that lack|lacking|with no|where needed|if needed|only the ones|incomplete|blank)\b/i;
const EVERY = /\b(every|each|all|everything|entire|whole|remaining)\b/i;
const SEASON_LEVEL = /\b(cover art|logo|brand\w*|trailer|theme (?:music|song)|intro music|season|series overview|website|landing page|style guide|facilitator guide|teacher'?s? guide|syllabus|course outline|marketing|launch|press kit|social media kit|feed|rss|budget|tracker|list)\b/i;
const SECTION_HEAD = /\b(statement|plan|narrative|summary|overview|background|section|approach|methods?|methodology|timeline|capacity|introduction|conclusions?|recommendations?|abstract|history|goals|objectives|sustainability|appendix|design|analysis|findings|discussion|references|bibliography|acknowledg\w+|budget justification|logic model|theory of change|work plan|management plan|dissemination plan|evaluation|faq|hours|what to bring|how to\b.*|who we are|about us|contact|eligibility|requirements)\b/i;
const PHYSICAL = /\b(scan|photograph|in person|in-person|on site|on-site|onsite|pick up|drop off|deliver (?:the )?(?:food|boxes|packages)|move (?:the |our )?(?:office|furniture|boxes)|set up (?:tables|chairs|the room)|clean (?:the )?(?:office|building|room)|paint|install|attend|host the event|be at the)\b/i;
const PROVIDED = /\bour (?:[\w'-]+ ){0,3}(?:data|records|files|spreadsheets?)\b|\bthe data (?:has|have|includes?|contains?)\b|\b(we have|we've got|we collected|we ran|we gathered|attached|see attached|our (?:export|spreadsheet|file|data|list|database|survey|records|inventory|catalog|taxonomy|transcripts|recordings|store export|books|bank)|(?:from|in) our (?:\w+ )?(?:export|spreadsheet|database|system)|we will (?:provide|share|send)|we'll (?:provide|share|send)|i have|you'll get|provided)\b/i;
const SOURCE = /\bfrom (?:the |our |a |an )?((?:[\w'’.-]+[^\S\n]+){0,5}?(?:calendar|database|portal|api|website|site|records?|spreadsheets?|exports?|files?|surveys?|system|data ?set|archive|feed|reports?|census|filings|registry|minutes|court|agency|bureau|public data))\b/i;
const FRAME_ORDER = ['translation', 'coding', 'literature', 'event', 'bulk', 'dataproduct', 'software', 'web', 'media', 'course', 'campaign', 'finance', 'research', 'document'];
const FRAME_ARCHETYPE = { translation: 'translate', coding: 'code', literature: 'research', event: 'schedule', bulk: 'clean', dataproduct: 'visualize', software: 'software', web: 'write', media: 'media', course: 'teach', campaign: 'outreach', finance: 'finance', research: 'research', document: 'write', generic: 'write' };
/** Frames whose deliverable is one assembled product built from the parts. */
export const PRODUCT_FRAMES = new Set(['dataproduct', 'web', 'software']);
/** Frames where a count of assets (episodes, lessons, chapters) makes each asset its own stream of work. */
const ASSET_FRAMES = new Set(['media', 'course', 'campaign', 'document', 'generic', 'research', 'event']);

export function toNumber(s) {
  const t = String(s).toLowerCase().replace(/,/g, '');
  if (/^\d/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

const clean = (s) => String(s || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[ \t]+/g, ' ').trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const words = (s) => String(s).toLowerCase().match(/[a-z0-9][a-z0-9'&/-]*/g) || [];
const singular = (s) => String(s).toLowerCase().replace(/\b([a-z]{3,}?)(?:ies)\b/g, '$1y').replace(/\b([a-z]{3,}?[^s])s\b/g, '$1');

/** Every "number + unit" in the text, with where it sits. */
export function findQuantities(text) {
  const out = [];
  for (const u of UNITS) {
    const re = new RegExp(`\\b${NUM}(?:\\s*-\\s*|\\s+)((?:[a-z][a-z'-]*\\s+){0,3}?)(${u.noun.source})\\b`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const between = words(m[2]);
      if (between.some((w) => PREPS.has(w))) continue;
      const n = toNumber(m[1]);
      if (!n || n > 1e7) continue;
      // Years ("since 2010") are dates, and 311/911 are service names, not counts.
      if (/^(?:19|20)\d\d$/.test(m[1]) && u.kind !== 'items') continue;
      if ([211, 311, 411, 511, 911].includes(n)) continue;
      out.push({ n, unit: u.key, kind: u.kind, phrase: m[0], index: m.index, noun: m[3].toLowerCase() });
    }
  }
  // The unit nearest the number wins ("40-page employee handbook" is 40 pages, not 40 employees).
  out.sort((a, b) => a.index - b.index || a.phrase.length - b.phrase.length);
  const kept = [];
  for (const q of out) {
    const clash = kept.find((k) => q.index < k.index + k.phrase.length && k.index < q.index + q.phrase.length);
    if (!clash) kept.push(q);
    else if (clash.index === q.index && clash.unit === 'minute' && q.unit === 'hour-media') kept.splice(kept.indexOf(clash), 1, q);
  }
  return kept;
}

function lemmaForms(w) {
  const f = [w];
  if (w.endsWith('ied')) f.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed')) f.push(w.slice(0, -1), w.slice(0, -2), w.slice(0, -3));
  if (w.endsWith('ing')) f.push(w.slice(0, -3), `${w.slice(0, -3)}e`, w.slice(0, -4));
  if (w.endsWith('es')) f.push(w.slice(0, -2));
  if (w.endsWith('s')) f.push(w.slice(0, -1));
  return f;
}

/** The verb a phrase starts with, if any: "set up online registration" → "set up". */
export function leadVerbOf(phrase, re = null) {
  const ws = words(phrase);
  if (!ws.length) return null;
  const three = ws.slice(0, 3).join(' ');
  if (re) {
    const m = new RegExp(re.source, 'i').exec(three);
    if (m && m.index === 0) return m[0].toLowerCase();
    for (const f of lemmaForms(ws[0])) { const mm = new RegExp(`^(?:${re.source})$`, 'i').exec(f); if (mm) return f; }
    return null;
  }
  const two = ws.slice(0, 2).join(' ');
  if (/^(?:set up|fill in|look up|reach out|follow up|clean up|put together|come up|lay out|sign up|write up|check in)$/.test(two)) return two;
  return COMMON_VERB.test(ws[0]) || GENERIC_VERB.test(ws[0]) || DISTRIBUTIVE.test(ws[0]) ? ws[0] : null;
}

/** Scores every kind of work against a phrase and returns the best, with the runner-up. */
export function classify(phrase, frame = 'generic') {
  const p = phrase.toLowerCase().trim();
  const lead = leadVerbOf(p);
  const headChunk = p.split(/\s+(?:of|on|for|with|by|from|about|to|in|that|which|who|where|so|because|into)\s+/)[0];
  const scores = [];
  for (const [key, a] of Object.entries(ARCHETYPES)) {
    let score = 0;
    const v = leadVerbOf(p, a.verbs);
    if (v) score += GENERIC_VERB.test(v) ? 2 : 4;
    if (a.nouns.test(headChunk) || a.nouns.test(singular(headChunk))) score += 3;
    else if (a.nouns.test(p) || a.nouns.test(singular(p))) score += 1.5;
    if (FRAME_ARCHETYPE[frame] === key) score += 1;
    scores.push({ key, score });
  }
  scores.sort((x, y) => y.score - x.score || ARCHETYPES[x.key].stage - ARCHETYPES[y.key].stage);
  let best = scores[0].score > 0 ? scores[0].key : FRAME_ARCHETYPE[frame] || 'write';
  // Bookkeepers categorize transactions; that is finance work, not coding.
  if (frame === 'finance' && best === 'code') best = 'finance';
  // A named section of a document or page is writing, whatever its topic.
  if (!lead && ['document', 'web', 'generic', 'research'].includes(frame) && SECTION_HEAD.test(headChunk) && !['finance', 'visualize', 'collect', 'outreach', 'design'].includes(best)) best = 'write';
  // "A table of theme counts by branch": tallying data the job already has is analysis, not collection.
  if (!lead && best === 'collect' && /\b(?:counts?|totals?|tall(?:y|ies)|frequenc(?:y|ies)|percentages?)\b(?:\s+[\w-]+){0,2}?\s+(?:by|per|across|for each)\s+\w+/i.test(p)) best = 'analyze';
  return { archetype: best, score: scores[0].score, runnerUp: scores[1]?.score > 0 ? scores[1].key : null, leadVerb: lead };
}

export function detectFrame(title, goal, headClause = '') {
  const t = title.toLowerCase();
  const g = goal.toLowerCase();
  const h = headClause.toLowerCase();
  const scores = {};
  for (const f of FRAME_ORDER) {
    const re = FRAMES[f];
    const gl = new RegExp(re.source, 'g');
    scores[f] = (re.test(t) ? 3 : 0) + (re.test(h) ? 2 : 0) + Math.min(3, (g.match(gl) || []).length);
  }
  // A job whose first verb is "translate" is a translation, whatever it translates.
  if (/^(?:please\s+)?(?:translate|locali[sz]e)\b/.test(g) || /^translat/.test(t) || new RegExp(`\\b(?:${LANG_RE}) version\\b`).test(t)) scores.translation += 4;
  if (/\b(?:code|coding)\b[^.]*\bresponses\b|\bcodebook\b/.test(`${t} ${g}`)) scores.coding += 3;
  if (/\bplan (?:our|the|a|an)\b/.test(`${t} ${g}`) && scores.event) scores.event += 2;
  if (scores.bulk) scores.bulk += 2;
  const ranked = FRAME_ORDER.filter((f) => scores[f] > 0).sort((a, b) => scores[b] - scores[a] || FRAME_ORDER.indexOf(a) - FRAME_ORDER.indexOf(b));
  return { frame: ranked[0] || 'generic', scores, secondary: ranked.slice(1, 3) };
}

function detectLanguages(text, language = 'en') {
  const lower = text.toLowerCase();
  const found = [];
  for (const [name, code] of Object.entries(LANGUAGES)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower) && !found.includes(code)) found.push(code);
  }
  let source = language || 'en';
  const from = new RegExp(`\\bfrom (english|${LANG_RE})\\b`).exec(lower);
  if (from) source = from[1] === 'english' ? 'en' : LANGUAGES[from[1]] || source;
  const intoEnglish = /\b(?:into|to) english\b/.test(lower);
  let targets = found.filter((c) => c !== source);
  if (intoEnglish) { if (source === 'en' && found.length) source = found[0]; targets = ['en']; }
  const assumptions = [];
  if (!targets.length && /\bbilingual\b/.test(lower)) { targets = ['es']; assumptions.push('“Bilingual” is read as English and Spanish. Change the language if you meant another.'); }
  if (/\b(?:no translation|english only)\b/.test(lower)) targets = [];
  return { source, targets, all: [source, ...targets], assumptions };
}

function detectSensitivity(text, privacy) {
  const lower = text.toLowerCase();
  const fields = [];
  // Words that are sensitive on their own, and words that are sensitive only about data held on people.
  const strong = /\b(ssn|social security numbers?|dates? of birth|dob|medical records|health records|student records|pii|personally identifiable|hipaa|ferpa|criminal records?|immigration status|donor names)\b/g;
  const ifData = /\b(medical|diagnos[ie]s|patients?|minors?|incomes?|salar(?:y|ies)|confidential|immigration)\b/g;
  const dataNoun = /\b(data|records?|responses|spreadsheets?|database|files|lists?|exports?|transcripts?|case files|results|rosters?|logs?)\b/.test(lower);
  let m;
  while ((m = strong.exec(lower))) if (!fields.includes(m[1])) fields.push(m[1]);
  if (dataNoun) while ((m = ifData.exec(lower))) if (!fields.includes(m[1])) fields.push(m[1]);
  const personalData = dataNoun && /\b(responses|records?|survey|contacts|donors?|clients?|patients?|tenants?|residents?|applicants?|members?|students?|employees?|interviews?|transcripts?|case files|participants?|volunteers?|customers?|people)\b/.test(lower);
  for (const f of ['names', 'addresses', 'phone numbers', 'email addresses', 'birth dates']) {
    const g = f.replace(' ', '\\s');
    const re = new RegExp(`\\b(?:include|includes|including|contain|contains|with|has|have|list(?:s)? of)\\b[^.]{0,40}\\b${g}\\b|\\b${g}\\b[^.]{0,30}\\b(?:of|for) (?:our |the )?(?:clients|tenants|residents|donors|patients|students|members|respondents|people)`, 'i');
    if (personalData && re.test(lower)) fields.push(f);
  }
  const redact = /\b(redact\w*|de-?identif\w*|anonymi[sz]\w*|mask\w*|strip (?:out )?(?:names|personal)|only see redacted)\b/.test(lower);
  const yes = privacy === 'RESTRICTED' || fields.length > 0 || redact || (personalData && /\b(names|addresses|phone numbers|private|sensitive|personal)\b/.test(lower));
  return { yes, fields, redact: redact || (yes && fields.some((f) => ['names', 'addresses', 'phone numbers', 'email addresses'].includes(f))) };
}

function detectAudiences(text) {
  const out = [];
  const lower = text.toLowerCase();
  const forWhom = /\bfor (?:our |the |local |new |low-income |older |young )?((?:[a-z-]+ ){0,2}(?:teens|kids|parents|families|tenants|renters|students|donors|volunteers|members|residents|customers|clients|patients|staff|board|committee|council|funders|reporters|seniors|youth|employees|partners|investors|users))\b/i.exec(lower);
  if (forWhom) out.push(forWhom[1]);
  for (const m of lower.matchAll(new RegExp(AUDIENCE_NOUNS.source, 'g'))) if (!out.some((o) => o.includes(m[1]))) out.push(m[1]);
  return out.slice(0, 5);
}

function detectPlace(text) {
  return /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*\sCounty)\b/.exec(text)?.[1]
    || /\bin ((?:[A-Z][a-z]+)(?:,?\s(?:[A-Z][a-zA-Z]+))?)\b/.exec(text)?.[1]
    || null;
}

/** Splits at top-level commas and semicolons, respecting parentheses and numbers ("2,000"). */
function splitTop(text, seps = ',;') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    const inNumber = ch === ',' && /\d$/.test(cur) && /^\d{3}\b/.test(text.slice(i + 1));
    if (seps.includes(ch) && depth === 0 && !inNumber) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Splits a list into items on commas, semicolons and "and" where "and" starts a new item. */
const FIXED_PAIRS = /\b(profit and loss|terms and conditions|research and development|question and answer|pros and cons|dos and don'?ts|black and white|arts and crafts|food and (?:drink|beverage)|health and safety|diversity and inclusion|monitoring and evaluation|roles and responsibilities|policies and procedures|goals and objectives|findings and recommendations|english and \w+|\w+ and english|ios and android|android and ios|names and addresses|hours and location)\b/i;

export function splitList(text, frame = 'generic') {
  const out = [];
  for (const p of splitTop(text)) {
    const bits = p.split(/\s+(?:and|as well as|plus|&)\s+(?=(?:the|a|an|our|its|their|your|his|her|every|each|all|one|two|three|four|five|six|seven|eight|nine|ten|\d)\b)/i)
      .flatMap((b) => b.split(/\s+(?:and|as well as|plus)\s+(?=[a-z]+\b)/i).reduce((acc, piece, i) => {
        // "X and write Y": split only where the word after "and" is a verb.
        if (i > 0 && leadVerbOf(piece)) acc.push(piece);
        else if (i > 0) acc[acc.length - 1] += ` and ${piece}`;
        else acc.push(piece);
        return acc;
      }, []));
    for (const b of bits.map((x) => x.trim().replace(/^(?:and|or)\s+/i, '')).filter(Boolean)) {
      // "maps and recommendations": two short noun phrases that are different kinds of work.
      const pair = /^((?:[\w'-]+\s+){0,3}?[\w'-]+)\s+and\s+((?:[\w'-]+\s+){0,3}?[\w'-]+)((?:\s+(?:for|on|about|of)\s+.*)?)$/i.exec(b);
      if (EACH_WITH.test(b) && out.length) out[out.length - 1] += `, ${b}`;
      else if (pair && !FIXED_PAIRS.test(b) && !leadVerbOf(pair[1]) && classify(pair[1], frame).archetype !== classify(pair[2], frame).archetype) out.push(pair[1] + pair[3], pair[2] + pair[3]);
      else out.push(b);
    }
  }
  return out;
}

/**
 * A "with" list that describes the thing before it rather than naming new work: "a codebook
 * with a definition and an example quote for each", or the columns of "a coded_all.csv with
 * response_id, branch and theme(s)". Returns those details and whatever list is left over.
 */
function attributesOf(lead, list) {
  if (/\s+(?:for|of|on|in)\s+(?:each|each one|every one|each of them|all of them)$/i.test(list)) return { details: [cap(list)], columns: [], rest: null };
  if (!TABLE_LEAD.test(lead)) return null;
  const columns = [];
  const items = splitTop(list);
  let i = 0;
  for (; i < items.length; i++) {
    // "…, email and phone for 2,000 donors": the tail is about the rows, not another column.
    const bits = items[i].replace(/^(?:and|or)\s+/i, '').replace(/\s+(?:for|of|in|from|per|across)\s+.*$/i, '').split(/\s+(?:and|or|&)\s+/i).map((x) => x.trim());
    // One word is a column name even when it could be a verb ("email"); two words must not start with one.
    if (!bits.every((x) => COLUMNISH.test(x) && !/^(?:a|an|the|one|some|each|every)\b/i.test(x) && (!x.includes(' ') || !leadVerbOf(x)))) break;
    columns.push(...bits.map((x) => x.toLowerCase().replace(/\s+/g, '_')));
  }
  if (!columns.length) return null;
  const rest = items.slice(i).join(', ').replace(/^(?:and|or)\s+/i, '').trim();
  return { details: [`Columns: ${columns.join(', ')}`], columns, rest: rest || null };
}

function stripItem(s) {
  let t = clean(s).replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/[.!?]+$/, '');
  for (let i = 0; i < 3; i++) t = t.replace(FILLER, '').replace(LEADING, '');
  return t.trim();
}

function sentencesOf(goal) {
  const lines = String(goal).split(/\n+/).map((l) => clean(l)).filter(Boolean);
  const out = [];
  let bullets = [];
  const flush = () => { if (bullets.length) { out.push({ text: bullets.join('; '), bullets: true }); bullets = []; } };
  for (const l of lines) {
    if (/^(?:[-*•]|\d+[.)])\s+/.test(l)) { bullets.push(l.replace(/^(?:[-*•]|\d+[.)])\s+/, '')); continue; }
    flush();
    for (const s of l.split(/(?<=[.!?])\s+(?=[A-Z"(])/)) if (s.trim()) out.push({ text: s.trim(), bullets: false });
  }
  flush();
  return out;
}

const isConstraint = (s) => {
  const t = s.toLowerCase().trim();
  if (/^(?:it|this|the (?:\w+ ){0,2}?(?:page|site|final version|final|result|document|report|app|design|copy|text|work|deliverable|dashboard|course|writing|translation|output|data|files?|version|tone|style)|everything|all of it|both(?: versions)?|they|each|terms|names|numbers|charts|colors|content)\s+(?:should|must|needs? to|has to|have to|will need to|ought to|are to|is to)\b/.test(t)) return true;
  if (/^(?:keep|make sure|be |use |avoid|don'?t|do not|no |never|always|write in|stick to|follow|match)\b/.test(t)) return true;
  return false;
};

const isContext = (s) => /^(?:we|i|our|my|the|this|there|they|it|last|currently|right now|responses|records|the data)\b(?:\s+[\w'-]+){0,3}?\s+(?:ran|run|have|has|had|are|were|is|was|did|already|currently|recently|serve|serves|work|works|own|operate|got|collected|gathered|keep|use|used|include|includes|contain|contains|came|come|'re|'ve)\b/i.test(s.trim())
  && !/\b(?:need|needs|want|wants|would like|'d like|looking for|hope|please)\b/i.test(s);

function constraintKind(t) {
  const l = t.toLowerCase();
  if (/phone|mobile|responsive|print|pdf|slides?|video|audio|spreadsheet|csv|html/.test(l)) return 'format';
  if (/accessib|screen reader|wcag|plain|easy to read|reading level|friendly|tone|voice|simple|clear|concise|professional/.test(l)) return 'tone';
  if (/english|spanish|french|language|bilingual|translat|consistent/.test(l)) return 'language';
  if (/redact|private|confidential|names|anonym|sensitive|only see/.test(l)) return 'privacy';
  if (/deadline|\bby\b|before|within|week|days?/.test(l)) return 'timing';
  return 'quality';
}

/** In a product, the list after "app for volunteers to …" is its features. */
function featureSplit(text) {
  const m = /\b(?:app|application|tool|site|website|portal|dashboard|platform|system|bot|page|extension|plugin)\b[^,:]*?\s(?:to|that (?:lets|allows|helps)(?: \w+){0,3}?(?: to)?|so (?:that )?(?:[\w-]+ ){1,3}?can|where (?:[\w-]+ ){1,3}?can)\s+(?=[^,]+,)/i.exec(text);
  if (!m) return null;
  return { lead: text.slice(0, m.index + m[0].length).replace(/\s(?:to|that (?:lets|allows|helps)(?: \w+){0,3}?(?: to)?|so (?:that )?(?:[\w-]+ ){1,3}?can|where (?:[\w-]+ ){1,3}?can)\s+$/i, ''), list: text.slice(m.index + m[0].length) };
}

/** The earliest list cue in a clause: a colon, a dash, "including", "such as", or "with" before a list. */
function listCue(text) {
  const cues = [];
  for (const re of [/\s*:\s+/, /\s+[—–]\s+/, /\s+(?:including|such as|covering|consisting of|that covers?|with sections? (?:on|for))\s+/i]) {
    const m = re.exec(text);
    if (m) cues.push({ index: m.index, len: m[0].length });
  }
  const w = /\s+with\s+(?=[^.]*(?:,|\band\b))/i.exec(text);
  if (w) cues.push({ index: w.index, len: w[0].length, weak: true });
  cues.sort((a, b) => a.index - b.index);
  return cues[0] || null;
}

/** Splits a sentence into clauses where a new clause starts with a verb: "Analyze X, and write a report". */
function clausesOf(text) {
  const parts = text.split(/(?:,\s*(?:and\s+)?then\s+|;\s+|,\s+and\s+(?=[a-z]+\s)|\s+and\s+then\s+|\s+and\s+(?=(?:write|draft|build|create|produce|prepare|publish|present|design|deliver|turn)\s))/i);
  const out = [];
  for (const p of parts) {
    if (out.length && !leadVerbOf(p)) out[out.length - 1] += `, and ${p}`;
    else out.push(p);
  }
  // Only keep the split if every clause after the first starts with a verb and the first isn't a bare list.
  const kept = out.length > 1 && !/,/.test(out[0]) ? out : [text];
  // "Audit our website for accessibility and fix the problems": two jobs joined by "and".
  return kept.flatMap((c) => {
    if (/,/.test(c)) return [c];
    const m = /^(.+?)\s+and\s+(\S+\s.+)$/.exec(c);
    if (!m) return [c];
    const left = leadVerbOf(m[1]);
    const right = leadVerbOf(m[2]);
    return left && right && words(m[1]).length > left.split(' ').length && COMMON_VERB.test(right.split(' ')[0]) ? [m[1], m[2]] : [c];
  });
}

/**
 * Reads a job.
 * @param {{ title?: string, goal?: string, answers?: Record<string,string>|string, files?: {name:string, summary?:string}[], privacy?: string, language?: string }} job
 */
export function analyzeJob(job) {
  const title = clean(job.title);
  const goal = String(job.goal || '').trim();
  const answersText = typeof job.answers === 'string' ? job.answers : Object.values(job.answers || {}).filter(Boolean).join('. ');
  const text = clean(`${title}. ${goal}${answersText ? `. ${answersText}` : ''}`).replace(/\n+/g, ' ');
  const lower = text.toLowerCase();
  const sentences = sentencesOf(goal);
  const firstWork = sentences.find((s) => !isContext(s.text) && !isConstraint(s.text));
  const fr = detectFrame(title, `${goal} ${answersText}`, (firstWork?.text || title).split(/[:—–]/)[0]);
  const frame = fr.frame;
  const quantities = findQuantities(text);
  const languages = detectLanguages(text, job.language);
  const sensitive = detectSensitivity(text, job.privacy);
  const audiences = detectAudiences(`${title}. ${goal} ${answersText}`);
  const formats = FORMAT_CUES.filter(([, re]) => re.test(lower)).map(([k]) => k);
  const assumptions = [...languages.assumptions];
  const constraints = [];
  const purposes = [];
  const components = [];
  /** Data files the job names by file name, with the columns it asks for. */
  const namedFiles = [];
  let head = null;

  const primaryOf = (kind) => quantities.filter((q) => q.kind === kind).sort((a, b) => b.n - a.n)[0] || null;
  const primary = { items: primaryOf('items'), assets: primaryOf('assets'), length: primaryOf('length'), duration: primaryOf('duration'), period: primaryOf('period'), region: primaryOf('region'), scale: primaryOf('scale'), languages: primaryOf('languages') };
  const pronounNoun = () => {
    const q = primary.items || primary.duration || primary.assets || primary.length;
    if (!q) return 'the material';
    return `the ${q.unit === 'hour-media' ? q.noun.replace(/^hours?\s+of\s+/, '') : q.noun}`;
  };

  const addComponent = (raw, ctx) => {
    let phrase = stripItem(raw);
    if (!phrase || phrase.length < 3) return;
    const [work, purpose] = phrase.split(PURPOSE);
    phrase = work.trim();
    if (purpose) purposes.push(purpose.trim());
    phrase = phrase.replace(/\s+(?:that|which) (?:goes|go|comes?|is|are) (?:along )?with (?:it|them|this)\b/i, '');
    // "No more than 3 recommendations" names a part of the work and its cap.
    const capped = CAP.exec(phrase);
    if (capped) phrase = `Up to ${capped[1]} ${capped[2]}`;
    // "bank accounts reconciled" → "reconcile bank accounts".
    const part = /^(.+?)\s+(categori[sz]ed|reconciled|coded|translated|transcribed|cleaned|edited|reviewed|updated|entered|tagged|fixed|proofread|checked|summari[sz]ed|analy[sz]ed|redacted|digiti[sz]ed|organi[sz]ed|filed)$/i.exec(phrase);
    if (part) {
      const w = part[2].toLowerCase();
      const lemma = { categorized: 'categorize', categorised: 'categorise', reconciled: 'reconcile', coded: 'code', translated: 'translate', transcribed: 'transcribe', cleaned: 'clean', edited: 'edit', reviewed: 'review', updated: 'update', entered: 'enter', tagged: 'tag', fixed: 'fix', proofread: 'proofread', checked: 'check', summarized: 'summarize', summarised: 'summarise', analyzed: 'analyze', analysed: 'analyse', redacted: 'redact', digitized: 'digitize', digitised: 'digitise', organized: 'organize', organised: 'organise', filed: 'file' }[w] || w.replace(/ed$/, '');
      phrase = `${lemma} ${part[1].replace(/^(?:every|each|all)\s+/i, (m) => m.toLowerCase())}`;
    }
    phrase = phrase.replace(/^(?:them|it|these|those|this|all of (?:them|it))\b/i, pronounNoun()).replace(/\b(?:them|it)$/i, pronounNoun());
    if (!words(phrase).length) return;
    // "Produce a coded_all.csv": in coding and bulk jobs that file is the merged result of the batches.
    const fileOnly = FILE_ONLY.exec(phrase);
    if (fileOnly && ['coding', 'bulk'].includes(frame)) {
      if (!namedFiles.some((f) => f.name === fileOnly[1].toLowerCase())) namedFiles.push({ name: fileOnly[1].toLowerCase(), columns: ctx.columns || [] });
      return;
    }
    // "Write and illustrate a picture book": two kinds of work on one thing.
    const twoVerbs = /^([a-z]+) and ([a-z]+) (.{3,})$/i.exec(phrase);
    if (twoVerbs && leadVerbOf(twoVerbs[1]) && leadVerbOf(twoVerbs[2]) && !ctx.split) {
      addComponent(`${twoVerbs[1]} ${twoVerbs[3]}`, { ...ctx, split: true });
      addComponent(`${twoVerbs[2]} ${twoVerbs[3]}`, { ...ctx, split: true });
      return;
    }
    const lead = leadVerbOf(phrase);
    const hasNoun = Object.values(ARCHETYPES).some((a) => a.nouns.test(phrase.toLowerCase()) || a.nouns.test(singular(phrase)));
    if (/\bplain[- ](?:language|english)\b/i.test(phrase)) constraints.push('Plain language');
    if (/^(?:(?:its|their|the|with|full|all)\s+)?(?:sources|references|citations|bibliography|footnotes|sources cited)$/i.test(phrase)) { constraints.push('Cite sources'); return; }
    if (isConstraint(phrase) || (QUALITY_CUES.test(phrase.toLowerCase()) && !lead && !hasNoun && words(phrase).length <= 6)) { constraints.push(phrase); return; }
    // "Transcribe them, add timestamps": a detail of the piece before it.
    if (ctx.verb && lead && DETAIL_VERB.test(lead.split(' ')[0]) && components.length) {
      const prev = components[components.length - 1];
      (prev.details ||= []).push(cap(phrase));
      return;
    }
    // "the annual report with two charts": the charts are their own piece of work.
    const figs = /^(.*?)\s+(?:with|including|plus)\s+((?:\d+|one|two|three|four|five|six|a|an)\s+(?:key\s+|simple\s+)?(?:charts?|maps?|graphs?|tables?|figures?|infographics?|photos?|illustrations?|diagrams?))\b(.*)$/i.exec(phrase);
    if (figs && !ctx.parent) {
      addComponent(`${figs[1]}${figs[3]}`, ctx);
      const parent = components[components.length - 1];
      addComponent(figs[2], { ...ctx, verb: null, parent });
      return;
    }
    // "8 lessons with slides and quizzes": the part after "with" belongs to each lesson.
    const withSplit = /^(.*?\b(?:lessons?|episodes?|chapters?|modules?|videos?|sessions?|posts?|pages?|sections?|units?|workshops?|emails?|newsletters?|articles?))\s+(?:with|each with|including|plus)\s+(.+)$/i.exec(phrase);
    if (withSplit && !ctx.parent) {
      addComponent(withSplit[1], ctx);
      const parent = components[components.length - 1];
      for (const sub of splitList(withSplit[2], frame)) addComponent(sub, { ...ctx, parent });
      return;
    }
    // A bare verb ("edit", "record") works on the job's main thing.
    if (lead && words(phrase).length <= lead.split(' ').length && head) {
      const obj = primary.assets && ASSET_FRAMES.has(frame) ? `each ${primary.assets.noun.replace(/s$/, '')}` : head.object || 'it';
      phrase = `${phrase} ${obj}`;
    }
    const verbFirst = ctx.verb && !lead ? `${ctx.verb} ${phrase}` : phrase;
    const cls = classify(verbFirst, frame);
    // A feature of an app or site is built by whoever builds the product, and so is a fix to it.
    if (ctx.feature && (frame === 'software' || frame === 'web')) cls.archetype = frame;
    if ((frame === 'software' || frame === 'web') && /^(?:fix|repair|patch|resolve|remediate|address)\b/i.test(verbFirst)) cls.archetype = frame;
    // "…, each with a rough cost" describes each of the things named; it isn't a count of the job's items.
    const core = phrase.replace(/,?\s+(?:each|each one|every one)\s+(?:with|having|including|showing|listing|citing)\b.*$/i, '');
    const qs = findQuantities(core);
    /** @type {{ n: number, unit: string, kind: string, noun: string } | null} */
    let qty = qs.find((q) => q.kind !== 'scale' || ['outreach', 'schedule', 'research'].includes(cls.archetype)) || null;
    const every = EVERY.test(core);
    const subset = SUBSET.test(core);
    // "a letter for the top 10": ten of the things counted elsewhere in the job.
    const top = /\btop (\d+|five|ten|twenty|three)\b/i.exec(core);
    if (!qty && top && primary.items) qty = { n: toNumber(top[1]), unit: primary.items.unit, kind: 'items', noun: primary.items.noun };
    // "Digitize 3,000 photos: scan them, tag each, write captions": each step works on all of them.
    if (!qty && ctx.headQty && ['clean', 'enrich', 'code', 'write', 'catalog', 'translate', 'edit', 'transcribe', 'migrate', 'design', 'research', 'outreach'].includes(cls.archetype)) qty = ctx.headQty;
    if (!qty) {
      // "every response coded", "categorize everything": the job's main count.
      const unitHit = quantities.find((q) => ['items', 'duration', 'length', 'period', 'assets'].includes(q.kind)
        && words(q.noun).filter((w) => w.length > 3 && !/^(?:hours?|minutes?|open-ended|survey|product|each)$/.test(w)).some((w) => new RegExp(`\\b${w.replace(/s$/, '')}s?\\b`, 'i').test(core)));
      if (unitHit) qty = unitHit;
      else if ((every || subset || frame === 'bulk' || (ctx.verb && DISTRIBUTIVE.test(ctx.verb))) && (primary.items || primary.duration || primary.length)
        && !(ctx.verb && DISTRIBUTIVE.test(ctx.verb) && !ctx.single && !every && !subset && frame !== 'bulk')
        && ['clean', 'enrich', 'code', 'write', 'catalog', 'translate', 'edit', 'transcribe', 'finance', 'design', 'research', 'migrate', 'collect'].includes(cls.archetype)) qty = primary.items || primary.duration || primary.length;
    }
    let role = 'work';
    if (CONVENTION_NOUNS.test(phrase) && !/\b(?:our|your|their|existing|current)\s+(?:[\w-]+\s+)?(?:taxonomy|template|schema|outline|glossary|style guide|brand guide|codebook|protocol)\b/i.test(phrase) && !/\binto\b/i.test(phrase)) role = 'conventions';
    // A check of this job's own work; auditing something the requester already has is work in itself.
    else if (CHECK_CUES.test(phrase) && ['test', 'edit', 'code', 'analyze', 'legal'].includes(cls.archetype) && !/\b(?:audit|test|review|assess|evaluate)\w*\s+(?:our|the existing|the current|their|your)\b/i.test(phrase)) role = 'check';
    // In a coding job, a check on the coding is the agreement check.
    if (role === 'check' && frame === 'coding' && /\bcod(?:e|es|ed|ing|ers?)\b|\bthemes?\b/i.test(phrase)) cls.archetype = 'code';
    const rawItem = stripItem(raw);
    const isSingular = /^(?:a|an|one|the|single)\s/i.test(rawItem) && !/(?:[^s]s|ies)$/i.test(words(phrase).slice(-1)[0] || '');
    components.push({
      phrase: cap(phrase), verb: cls.leadVerb || ctx.verb || null, archetype: cls.archetype, runnerUp: cls.runnerUp, confidence: cls.score,
      qty: qty ? { n: qty.n, unit: qty.unit, kind: qty.kind, noun: qty.noun } : null,
      subset, every, role, source: ctx.source, parentRef: ctx.parent || null, perParent: !!ctx.parent, singular: isSingular, feature: !!ctx.feature,
      physical: PHYSICAL.test(phrase), details: [...(ctx.details || [])],
    });
  };

  const processSentence = (s, source) => {
    const t = s.text.replace(/(\w)\(s\)/g, '$1s').replace(/\s*\([^)]*\)/g, (m) => (/\d/.test(m) ? m : '')).replace(/[.!?]+$/, '');
    if (s.bullets) { for (const b of t.split('; ')) addComponent(b, { source }); return; }
    if (isConstraint(t)) {
      const [c, purpose] = t.split(PURPOSE);
      constraints.push(c.trim());
      if (purpose) purposes.push(purpose);
      return;
    }
    if (isContext(t)) return;
    const parts = t.split(PURPOSE);
    let main = parts[0];
    const purpose = parts[1];
    const hadNeed = FILLER.test(main);
    main = stripItem(main);
    // A product's feature list often arrives as a purpose: "so volunteers can sign up, get reminders, check in".
    if (purpose && PRODUCT_FRAMES.has(frame) && /,/.test(purpose)) main = `${main} to ${purpose.replace(/^(?:[\w-]+ ){1,3}?can\s+/i, '')}`;
    else if (purpose) purposes.push(purpose);
    const clauses = clausesOf(main);
    clauses.forEach((clause, ci) => {
      const isHead = !head && source === 'goal' && ci === 0;
      const feat = PRODUCT_FRAMES.has(frame) ? featureSplit(clause) : null;
      const cue = listCue(clause);
      let lead = clause;
      let list = null;
      let features = false;
      let weak = false;
      if (feat && (!cue || feat.lead.length < cue.index) && leadVerbOf(feat.list)) { lead = feat.lead; list = feat.list; features = true; } else if (cue) { lead = clause.slice(0, cue.index); list = clause.slice(cue.index + cue.len); weak = !!cue.weak; }
      lead = stripItem(lead);
      const verb = leadVerbOf(lead);
      if (isHead && lead) {
        const object = (verb ? lead.slice(verb.length) : lead).trim();
        head = { phrase: cap(lead), verb, object: object.replace(/^(?:a|an|the|our)\s+/i, 'the ') || null, archetype: classify(lead, frame).archetype };
      }
      // "A codebook with a definition and an example quote for each", "a coded_all.csv with response_id,
      // branch and theme(s), a table of counts…": details of the thing named, then any new pieces.
      const skipHead = isHead && ((PRODUCT_FRAMES.has(frame) && (!verb || MAKE_VERB.test(verb))) || ['event', 'media', 'course', 'campaign'].includes(frame));
      const attrs = list && !skipHead ? attributesOf(lead, list) : null;
      if (attrs) {
        addComponent(lead, { source, details: attrs.details, columns: attrs.columns });
        if (attrs.rest) for (const it of splitList(attrs.rest, frame)) addComponent(it, { source });
        return;
      }
      if (list && weak && verb && DISTRIBUTIVE.test(verb)) {
        // "Translate the form and its instructions into French, with a glossary": the objects are the work, the with-list adds to it.
        const body = lead.slice(verb.length).replace(new RegExp(`\\s+(?:into|to|in)\\s+(?:${LANG_RE})\\b.*$`, 'i'), '');
        const objs = splitList(body, frame);
        for (const o of objs) addComponent(o, { source, verb, single: objs.length === 1 });
        for (const it of splitList(list, frame)) addComponent(it, { source });
        return;
      }
      if (list) {
        const shared = verb && DISTRIBUTIVE.test(verb) ? verb : null;
        const leadIsWork = !isHead && verb && !shared && words(lead).length > verb.split(' ').length;
        if (leadIsWork) addComponent(lead, { source });
        const parent = leadIsWork ? components[components.length - 1] : null;
        const headQty = findQuantities(lead).find((x) => x.kind === 'items' && x.n >= 20) || null;
        for (const it of splitList(list, frame)) addComponent(it, { source, verb: shared, feature: features, parent, headQty });
        return;
      }
      if (hadNeed && /,/.test(clause)) { for (const it of splitList(clause, frame)) addComponent(it, { source }); return; }
      if (verb && DISTRIBUTIVE.test(verb)) {
        const body = lead.slice(verb.length).replace(new RegExp(`\\s+(?:into|to|in)\\s+(?:${LANG_RE})(?:\\s*(?:,|and)\\s*(?:${LANG_RE}))*\\b.*$`, 'i'), '');
        const objs = splitList(body, frame);
        for (const o of objs) addComponent(o, { source, verb, single: objs.length === 1 });
        return;
      }
      if (isHead && ((PRODUCT_FRAMES.has(frame) && (!verb || MAKE_VERB.test(verb))) || !verb || ['event', 'media', 'course', 'campaign'].includes(frame))) return;
      if (verb || hadNeed || !isHead) addComponent(lead, { source });
    });
  };
  sentences.forEach((s) => processSentence(s, 'goal'));
  if (answersText) {
    for (const s of sentencesOf(answersText)) {
      if (isConstraint(s.text)) constraints.push(s.text.replace(/[.!?]+$/, ''));
      else if (/\b(?:also|add|include|need|want|plus)\b/i.test(s.text)) processSentence(s, 'answer');
    }
  }
  if (!components.length && title) {
    // Nothing listed in the goal: an action in the title is the one named piece of work.
    const verb = leadVerbOf(title);
    if (verb && DISTRIBUTIVE.test(verb)) for (const o of splitList(title.slice(verb.length))) addComponent(o, { source: 'title', verb });
  }
  if (!head) head = { phrase: title || cap(stripItem(sentences[0]?.text || '')), verb: leadVerbOf(title), object: null, archetype: classify(title || goal, frame).archetype };

  // Drop repeats: two phrases for the same kind of work on the same thing.
  const seen = new Set();
  const unique = [];
  for (const c of components) {
    const key = `${c.archetype}|${c.verb}|${c.perParent}|${words(c.phrase).filter((w) => w.length > 3).map((w) => w.replace(/s$/, '')).slice(-2).join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  // The parts listed for a short document ("a 2-page report: the main findings, differences between
  // branches…") are what its writer covers, not separate pieces; costs, charts and the like stay apart.
  const shortDoc = (p) => !!p && p.archetype === 'write' && p.qty?.kind === 'length' && ((p.qty.unit === 'page' && p.qty.n <= 3) || (p.qty.unit === 'word' && p.qty.n <= 1500));
  for (const c of [...unique]) {
    if (!shortDoc(c.parentRef) || !unique.includes(c.parentRef) || SEPARABLE.has(c.archetype) || c.role !== 'work') continue;
    c.parentRef.details.push(cap(c.phrase));
    unique.splice(unique.indexOf(c), 1);
  }
  // With a count of assets (6 episodes, 8 lessons), work that isn't about one named thing happens once per asset.
  const assets = primary.assets && ASSET_FRAMES.has(frame) && primary.assets.n > 1 && primary.assets.n <= 40 ? primary.assets : null;
  for (const c of unique) {
    const aboutAsset = !!(assets && c.qty && c.qty.unit === assets.unit);
    c.assetUnit = aboutAsset;
    c.perAsset = !!assets && !aboutAsset && (c.perParent || !c.singular) && !SEASON_LEVEL.test(c.phrase) && c.role === 'work'
      && ['research', 'write', 'media', 'design', 'teach', 'transcribe', 'edit', 'translate', 'outreach', 'visualize', 'code'].includes(c.archetype)
      && !(c.qty && ['items', 'languages'].includes(c.qty.kind));
  }
  unique.forEach((c, i) => { c.id = `p${i + 1}`; });
  for (const c of unique) { c.parent = c.parentRef?.id || null; delete c.parentRef; }

  const src = SOURCE.exec(goal);
  const sources = src ? [src[1].trim()] : [];
  const provided = PROVIDED.test(`${goal} ${answersText}`) || (job.files || []).length > 0;
  if (!provided && ['coding', 'bulk', 'translation'].includes(frame)) assumptions.push('You will attach the source material (the text, file or export to work from). The first tile checks it before anyone starts.');

  const suggestions = (FRAME_DEFAULTS[frame] || []).filter((d) => !unique.some((c) => sharesWords(c.phrase, d)));
  const vague = unique.filter((c) => c.role !== 'conventions').length === 0;

  // What the requester asked for, one line each, so coverage can be checked tile by tile.
  const requirements = [];
  const req = (t, kind, ref) => requirements.push({ id: `r${requirements.length + 1}`, text: cap(t), kind, ref });
  for (const c of unique) req(c.phrase, c.role === 'conventions' ? 'conventions' : 'component', c.id);
  for (const t of languages.targets) req(`${LANGUAGE_NAMES[t] || t} version`, 'language', t);
  for (const c of uniqueStrings(constraints)) req(c, constraintKind(c), null);
  for (const f of namedFiles) req(`Deliver ${f.name}${f.columns.length ? ` with ${f.columns.join(', ')}` : ''}`, 'format', f.name);
  if (sensitive.yes) req(sensitive.redact ? 'Contributors only see de-identified data' : 'Sensitive data stays need-to-know', 'privacy', null);
  const named = { phone: 'Works on a phone', print: 'Ready to print', pdf: 'Delivered as PDF', accessible: 'Meets accessibility basics' };
  for (const f of formats.filter((x) => named[x])) {
    const re = { phone: /phone|mobile/i, print: /print/i, pdf: /pdf/i, accessible: /accessib|plain/i }[f];
    if (!requirements.some((r) => re.test(r.text))) req(named[f], 'format', f);
  }

  if (vague) assumptions.push('The job doesn’t list its parts, so the plan starts with a short scoping tile that names them. Listing the pieces you need (“we need X, Y and Z”) gives a sharper split.');
  for (const c of unique.filter((x) => x.physical)) assumptions.push(`“${c.phrase}” needs someone with the physical items or on site, so those tiles say so and suit people near you.`);

  return {
    title: title || head.phrase, goal, text, frame, frameScores: fr.scores, secondaryFrames: fr.secondary,
    subject: subjectOf(title, head, frame), place: detectPlace(`${title}. ${goal}`), head,
    components: unique, constraints: uniqueStrings(constraints), purposes: uniqueStrings(purposes),
    quantities, primary, languages, audiences, formats, sensitive, sources, provided,
    requirements, assumptions, suggestions, vague, namedFiles,
  };
}

function subjectOf(title, head, frame) {
  let s = title || head?.phrase || 'the job';
  s = s.replace(/^(?:translate|build|create|write|design|produce|plan|code|clean up|clean|develop|make|run|do|a|an|the)\s+/i, '');
  s = s.replace(/^(?:a|an|the|our)\s+/i, '');
  if (frame === 'translation') s = s.replace(new RegExp(`\\s+(?:into|to|in)\\s+(?:${LANG_RE}).*$`, 'i'), '').replace(/^\w+ version of (?:our |the )?/i, '');
  return s.length > 70 ? `${s.slice(0, 67)}…` : s;
}

function uniqueStrings(list) {
  const seen = new Set();
  return list.filter((s) => { const k = s.toLowerCase().trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

export function sharesWords(a, b) {
  const wa = new Set(words(a).filter((w) => w.length > 3).map((w) => w.replace(/s$/, '')));
  return words(b).filter((w) => w.length > 3).some((w) => wa.has(w.replace(/s$/, '')));
}
