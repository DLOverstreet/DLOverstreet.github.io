// Turns a read job into pieces of work: one shared-conventions piece that fixes every
// interface up front, the pieces the job names, the layers it implies (de-identification,
// translation, editing, testing), and a final assembly. Each piece is later sized into one
// or more tiles and wired to the pieces whose output it needs.
import { ARCHETYPES, LANGUAGE_NAMES, FRAME_DEFAULTS, DOCUMENT_SECTIONS } from './lexicon.js';
import { classify, words, sharesWords, PRODUCT_FRAMES } from './analyze.js';

const REPORTISH = /\b(report|memo|summary|synthesis|findings|recommendations?|themes|insights|conclusions?|go\/no-go|briefing|white paper|executive summary)\b/i;
const METHODOLOGY = /\bmethodolog\w*|\bhow we did it\b|\babout the data\b/i;
const INTERNAL = /\b(board|committee|council|staff|internal|funders?|leadership|executive director)\b/i;
const GEO = /\b(map|by (?:census )?tracts?|by (?:zip|zip code|neighbou?rhood|county|district|ward|precinct|region|state|city)|geocod\w*|choropleth)\b/i;
const SETUP = /\b(tracker|template|log|sign-?up (?:link|form)|registration)\b/i;
/** @type {[RegExp, number][]} */
const MEDIA_ORDER = [[/\b(research|outline|script|plan|book guests?|find guests?)\b/, 1], [/\b(interview|record|film|shoot|narrat|voice)\w*/, 2], [/\b(edit|mix|master|cut|color)\w*/, 3], [/\b(show notes|transcri\w*|captions?|thumbnails?|description|notes)\b/, 4], [/\b(publish|upload|release|distribute)\w*/, 5]];

export const FRAME_LABELS = {
  translation: 'translation', coding: 'qualitative coding', literature: 'literature review', event: 'event', bulk: 'bulk data',
  dataproduct: 'data product', software: 'software', web: 'website', media: 'media production', course: 'course',
  campaign: 'campaign', finance: 'finance', research: 'research', document: 'document', generic: 'general',
};

/** The conventions piece for each kind of job: the one file every other tile reads so they can work apart. */
const CONVENTIONS = {
  translation: (a, lang) => ({ title: `Build the ${LANGUAGE_NAMES[lang] || lang} glossary`, fixes: `the ${LANGUAGE_NAMES[lang] || lang} term for every name, program and form label, and the tone`, archetype: 'translate', lang }),
  coding: () => ({ title: 'Draft the codebook', fixes: 'the codes, their definitions and one example each, so every coder applies the same codes', archetype: 'code' }),
  literature: () => ({ title: 'Write the search protocol and run the searches', fixes: 'the databases, search strings, date range and inclusion criteria, plus the list of candidate papers', archetype: 'research' }),
  bulk: (a) => ({ title: `Write the batch spec for the ${a.primary.items?.noun || 'records'}`, fixes: 'the id column, which columns each operation owns, the formatting rules, and the batch ranges', archetype: 'clean' }),
  dataproduct: () => ({ title: 'Write the data dictionary and chart style', fixes: 'column names, units and definitions, plus colors, fonts and chart conventions', archetype: 'visualize' }),
  document: (a) => (a.components.some((c) => c.archetype === 'design' && c.qty)
    ? { title: 'Plan the pages and set the art style', fixes: 'what goes on each page, the characters and the palette, so separate illustrators match', archetype: 'design' }
    : { title: 'Outline the document and set the style sheet', fixes: 'each section’s purpose, length and key points, plus voice, terms and citation style', archetype: 'write' }),
  web: (a) => (a.components.some((c) => /\baudit|\btest|\bfix\b/i.test(c.phrase)) && !a.components.some((c) => ['write', 'design'].includes(c.archetype))
    ? { title: 'Set the audit checklist and severity scale', fixes: 'what gets checked, how problems are rated, and how each fix is recorded', archetype: 'test' }
    : { title: 'Outline the content and set the style tokens', fixes: 'the page structure, section order, tone, colors and fonts', archetype: 'design' }),
  software: () => ({ title: 'Write the API contract and data model', fixes: 'every endpoint, field and screen state, so front end and back end can be built in parallel', archetype: 'software' }),
  media: (a) => ({ title: `Outline the ${a.primary.assets ? `${a.primary.assets.n} ${a.primary.assets.noun.replace(/s?$/, 's')}` : 'series'} and set the format`, fixes: 'each episode’s topic and guests, the running time, audio specs and file names', archetype: 'media' }),
  course: () => ({ title: 'Write the course outline and lesson template', fixes: 'each lesson’s objectives and the template every lesson, slide deck and quiz follows', archetype: 'teach' }),
  event: () => ({ title: 'Write the event brief', fixes: 'the date, headcount, budget ceiling, look and feel, and who approves what', archetype: 'schedule' }),
  campaign: () => ({ title: 'Write the message brief', fixes: 'audiences, key messages, calls to action, voice, brand and tracking links', archetype: 'outreach' }),
  finance: () => ({ title: 'Set the chart of accounts and rules', fixes: 'the account and category list and the rule for each common transaction', archetype: 'finance' }),
  research: () => ({ title: 'Write the research plan', fixes: 'the questions, methods, sources and the output format each part follows', archetype: 'research' }),
  generic: (a) => {
    if (a.vague) return { title: 'Scope the job and name its parts', fixes: 'what “done” means and the separate parts the work splits into', archetype: 'write' };
    const main = a.components.map((c) => c.archetype);
    if (main.includes('transcribe')) return { title: 'Write the transcription style guide', fixes: 'speaker labels, timestamps, verbatim rules and file names', archetype: 'transcribe' };
    if (main.includes('catalog')) return { title: 'Set the catalog fields and rules', fixes: 'the fields, categories, value rules and photo naming', archetype: 'catalog' };
    return { title: 'Set the shared conventions', fixes: 'terms, formats, file names and how the parts fit together', archetype: 'write' };
  },
};

/** Pipeline rank: stage first, then order within media work. */
function rankOf(p) {
  const stage = ARCHETYPES[p.archetype]?.stage ?? 4;
  const ph = p.phrase.toLowerCase();
  let sub = 0;
  if (p.archetype === 'enrich') sub = 2;
  else if (p.archetype === 'code') sub = 4;
  else if (p.archetype === 'finance') sub = /reconcil/.test(ph) ? 2 : /\b(statement|p&l|profit|balance sheet|cash flow|report)\b/.test(ph) ? 4 : 0;
  else if (p.archetype === 'research' && /\bscreen/.test(ph)) sub = 2;
  else if (p.archetype === 'research' && /\bextract/.test(ph)) sub = 4;
  else if (p.archetype === 'research' && /\bsynthes/.test(ph)) sub = 6;
  else if (p.archetype === 'research' && /\bfield|\bresponses/.test(ph)) sub = 3;
  else if (p.archetype === 'design' && p.ux) sub = -2;
  else if (p.archetype === 'design') sub = 2;
  else if (['media', 'research', 'write', 'transcribe'].includes(p.archetype)) {
    for (const [re, o] of MEDIA_ORDER) if (re.test(ph)) { sub = o; break; }
  }
  return stage * 10 + sub;
}

function needsOf(p, frame, all) {
  const phrase = p.phrase.toLowerCase();
  const a = p.archetype;
  if (p.needsOverride) return p.needsOverride;
  if (p.role === 'conventions') return [];
  // Bulk operations each own their columns of the same source rows, so they run side by side.
  if (frame === 'bulk' && ['clean', 'enrich', 'code', 'write', 'migrate', 'catalog'].includes(a)) return [];
  if (SETUP.test(phrase) && !['web', 'software'].includes(a)) return [];
  switch (a) {
    case 'collect': case 'catalog': case 'legal': return [];
    case 'research':
      if (/\bextract/.test(phrase)) return ['screened'];
      if (/\bsynthes/.test(phrase)) return ['extracted'];
      if (/\bfield|\bresponses/.test(phrase)) return ['instrument'];
      return [];
    case 'clean': case 'enrich': case 'migrate': return ['data'];
    case 'code': return ['clean-data', 'data'];
    case 'transcribe': return ['media'];
    case 'analyze': return /\bsurvey|tabulat/.test(phrase) ? ['survey-data'] : ['clean-data', 'data', 'coded', 'geo'];
    case 'visualize': return GEO.test(phrase) ? ['geo', 'findings', 'clean-data', 'data'] : ['findings', 'clean-data', 'data'];
    case 'write':
      if (METHODOLOGY.test(phrase)) return ['clean-data', 'data', 'geo'];
      if (/\btop \d+|\bshortlist|\bselected|\bthe best\b|\bchosen\b/.test(phrase)) return ['research', 'data'];
      if (frame === 'media') return ['media', 'research'];
      if (frame === 'translation') return [];
      return [];
    case 'edit': return frame === 'media' ? ['media'] : ['text'];
    case 'translate': return [];
    case 'design': return all.some((o) => o.archetype === 'write' && o.role === 'work' && sharesWords(o.phrase, p.phrase)) ? ['copy', 'text'] : [];
    case 'web': if (/\b(?:fix|repair|patch|resolve|remediat\w*|address)\b/.test(phrase)) return ['qa'];
      return PRODUCT_FRAMES.has(frame) ? ['text', 'design', 'visuals', 'copy', 'text-translated', 'clean-data'] : [];
    case 'software': if (/\b(?:fix|repair|patch|resolve|remediat\w*|address)\b/.test(phrase)) return ['qa'];
      return p.side === 'ui' ? ['ux'] : [];
    case 'outreach': return ['copy', 'contacts'];
    case 'schedule': return frame === 'event' ? ['research'] : [];
    case 'media': return ['research', 'media'];
    case 'teach': return [];
    case 'finance':
      if (/\breconcil/i.test(phrase)) return ['books'];
      if (/\b(statement|p&l|profit|balance sheet|cash flow|report)\b/i.test(phrase)) return ['books', 'reconciled'];
      return frame === 'event' ? ['research'] : [];
    case 'test': return /\baudit|\breview|\bassess/.test(phrase) ? [] : ['build'];
    default: return [];
  }
}

function providesOf(p) {
  const phrase = p.phrase.toLowerCase();
  if (p.archetype === 'enrich' && GEO.test(phrase)) return ['geo'];
  if (p.ux) return ['ux', 'design'];
  const base = [...(ARCHETYPES[p.archetype]?.provides || [])];
  if (p.archetype === 'research' && /\bscreen/.test(phrase)) base.push('screened');
  if (p.archetype === 'research' && /\bextract/.test(phrase)) base.push('extracted');
  if (p.archetype === 'research' && /\bquestionnaire|instrument/.test(phrase)) base.push('instrument');
  if (/\bfield the survey|survey responses/.test(phrase)) base.push('survey-data');
  if (p.archetype === 'collect' && /\b(list|contacts?|donors?|segments?|prospects?|leads?)\b/.test(phrase)) base.push('contacts');
  if (p.archetype === 'write' && /\b(copy|emails?|letters?|posts?|messages?|scripts?|invitation|wording|text)\b/.test(phrase)) base.push('copy');
  if (p.archetype === 'finance') {
    if (/\bcategori|\bbook|\btransactions?\b/.test(phrase)) base.push('books');
    if (/\breconcil/.test(phrase)) base.push('reconciled');
  }
  if (p.archetype === 'web' || p.archetype === 'software') base.push('build');
  if (p.archetype === 'media' && /\bedit|\bmix/.test(phrase)) base.push('media-final');
  return base;
}

let seq = 0;
function piece(fields) {
  seq += 1;
  return {
    id: fields.id || `x${seq}`, role: 'work', priority: 1, covers: [], details: [], qty: null, perAsset: false, assetUnit: false,
    parent: null, subset: false, lang: null, internal: false, fold: false, ...fields,
  };
}

/**
 * Plans the pieces for a read job.
 * @param {ReturnType<import('./analyze.js').analyzeJob>} a
 */
export function planPieces(a) {
  seq = 0;
  const frame = a.frame;
  const reqFor = (ref) => a.requirements.filter((r) => r.ref === ref).map((r) => r.id);
  const reqKind = (kinds) => a.requirements.filter((r) => kinds.includes(r.kind)).map((r) => r.id);
  const pieces = [];

  // 1. The pieces the job names.
  let comps = a.components;
  // A job that names no parts gets the usual parts of its kind, marked as assumed.
  if (comps.filter((c) => c.role !== 'conventions').length < 2 && (FRAME_DEFAULTS[frame] || []).length && !['translation', 'bulk'].includes(frame)) {
    const extra = FRAME_DEFAULTS[frame].filter((d) => !comps.some((c) => sharesWords(c.phrase, d))).map((d, i) => {
      const cls = classify(d, frame);
      return { id: `d${i + 1}`, phrase: d[0].toUpperCase() + d.slice(1), archetype: cls.archetype, role: 'work', qty: null, subset: false, every: false, perAsset: false, assetUnit: false, parent: null, details: [], assumed: true };
    });
    comps = [...comps, ...extra];
  }
  const conventionsFromJob = comps.find((c) => c.role === 'conventions');
  for (const c of comps) {
    if (c === conventionsFromJob) continue;
    // "Fix the problems" keeps its verb, which decides what it waits for.
    const phrase = c.verb && /^(?:fix|repair|patch|resolve|remediate|address)$/.test(c.verb) && !c.phrase.toLowerCase().startsWith(c.verb) ? `${c.verb[0].toUpperCase()}${c.verb.slice(1)} ${c.phrase.replace(/^[A-Z]/, (x) => x.toLowerCase())}` : c.phrase;
    pieces.push(piece({
      id: c.id, archetype: c.archetype, phrase, role: c.role === 'check' ? 'check' : 'work', qty: c.qty, subset: c.subset,
      perAsset: c.perAsset, assetUnit: c.assetUnit, parent: c.parent, details: c.details || [], covers: reqFor(c.id), assumed: !!c.assumed,
      internal: INTERNAL.test(c.phrase), feature: !!c.feature, verb: c.verb, physical: !!c.physical,
      ...((['web', 'software'].includes(c.archetype) && /^(?:fix|repair|patch|resolve|remediate|address)\b/i.test(phrase)) ? { rankOverride: 65 } : {}),
    }));
  }

  // A document that names no sections gets the usual sections of its kind, each for a different writer.
  if (frame === 'document') {
    const docNoun = /\b(report|proposal|brief|white paper|plan|handbook|manual|guide|book|application|memo|toolkit|playbook|case study|fact sheet)\b/i;
    const sectionWrites = pieces.filter((p) => p.archetype === 'write' && p.role === 'work' && !(REPORTISH.test(p.phrase) && docNoun.test(p.phrase)) && !/\bletters?\b/i.test(p.phrase));
    const docPiece = pieces.find((p) => p.archetype === 'write' && docNoun.test(p.phrase));
    const key = `${a.title} ${a.head?.phrase || ''} ${docPiece?.phrase || ''}`.toLowerCase();
    const spec = DOCUMENT_SECTIONS.find((d) => d.match.test(key)) || DOCUMENT_SECTIONS[DOCUMENT_SECTIONS.length - 1];
    if (sectionWrites.length < 2 && spec.sections.length) {
      const pages = a.primary.length?.unit === 'page' ? a.primary.length.n : null;
      const dataPieces = pieces.filter((p) => p.role === 'work' && ['collect', 'clean', 'enrich', 'code', 'analyze', 'visualize', 'research', 'finance'].includes(p.archetype) && p !== docPiece);
      const numeric = /numbers|outcomes|participation|findings|results|data|market|financial|budget|evidence|impact|trends/i;
      const words = pages ? Math.round((pages * 450) / (spec.sections.length + 0.5)) : null;
      const secs = [];
      for (const [i, name] of spec.sections.entries()) {
        // A section the job already names ("recommendations") stays the job's own piece.
        const named = sectionWrites.find((p) => sharesWords(p.phrase, name));
        const after = numeric.test(name) || (named && REPORTISH.test(named.phrase)) ? dataPieces.map((d) => d.id) : [];
        if (named) { Object.assign(named, { sectionName: name, after, skills: spec.skills, words }); pieces.splice(pieces.indexOf(named), 1); secs.push(named); continue; }
        secs.push(piece({ id: `section-${i + 1}`, archetype: 'write', phrase: `Write the ${name.toLowerCase().replace(/^the /, '')} section`, after, sectionName: name, assumed: true, skills: spec.skills, words }));
      }
      const at = docPiece ? pieces.indexOf(docPiece) : pieces.length;
      if (docPiece) {
        pieces.splice(at, 1);
        for (const k of pieces.filter((x) => x.parent === docPiece.id)) k.parent = null;
      }
      pieces.splice(at, 0, ...secs);
      if (spec.summary) pieces.splice(at + secs.length, 0, piece({ id: 'summary', archetype: 'write', phrase: `Write the ${spec.summary.toLowerCase()}`, after: secs.map((x) => x.id), covers: docPiece ? [...docPiece.covers] : [], skills: spec.skills, words: 350 }));
      else if (docPiece) secs[0].covers.push(...docPiece.covers);
      a.assumptions.push(`The ${docPiece ? docPiece.phrase.replace(/^write (?:the |a |an )?/i, '').toLowerCase() : 'document'} is split into the usual sections (${spec.sections.join(', ')}), each for a different writer. Name your own sections to change them.`);
    }
  }

  // "8 lessons with slides, quizzes and a guide": per-lesson work belongs to the lesson even when listed apart.
  const owners = pieces.filter((p) => p.assetUnit && ['teach', 'write'].includes(p.archetype));
  if (owners.length === 1) for (const p of pieces) if (p.perAsset && !p.parent && p !== owners[0]) p.parent = owners[0].id;

  // 2. What a product needs that the job takes for granted.
  const has = (arch, re) => pieces.some((p) => p.archetype === arch && (!re || re.test(p.phrase)));
  const dataFrames = ['dataproduct', 'document', 'research', 'generic'];
  const dataWork = pieces.some((p) => ['visualize', 'analyze'].includes(p.archetype));
  if (dataFrames.includes(frame) && dataWork && !has('collect') && !a.provided) {
    pieces.unshift(piece({ id: 'collect', archetype: 'collect', phrase: a.sources[0] ? `Collect the data from ${a.sources[0]}` : `Collect the data`, assumed: !a.sources[0], covers: [], qty: a.primary.period || a.primary.region || null }));
  }
  if (dataFrames.includes(frame) && dataWork && !has('clean') && (frame === 'dataproduct' || a.primary.items || a.primary.period || has('analyze') || a.provided)) {
    pieces.splice(pieces.findIndex((p) => p.archetype === 'collect') + 1, 0, piece({ id: 'clean', archetype: 'clean', phrase: 'Clean and standardize the data', qty: a.primary.items || null }));
  }
  if (pieces.some((p) => p.archetype === 'visualize' && GEO.test(p.phrase)) && !has('enrich', GEO)) {
    const ph = pieces.find((p) => p.archetype === 'visualize' && GEO.test(p.phrase)).phrase.toLowerCase();
    const level = /tract/.test(ph) ? 'census tracts' : /zip/.test(ph) ? 'ZIP codes' : /neighbou?rhood/.test(ph) ? 'neighborhoods' : /county|counties/.test(ph) ? 'counties' : /district|ward|precinct/.test(ph) ? 'districts' : 'map areas';
    pieces.splice(pieces.findIndex((p) => p.archetype === 'clean') + 1, 0, piece({ id: 'geocode', archetype: 'enrich', phrase: `Geocode the records to ${level}` }));
  }
  if ((frame === 'dataproduct' && !has('web', /\b(build|page|site|dashboard)\b/i)) || (frame === 'web' && !pieces.some((p) => ['web', 'software'].includes(p.archetype) && p.role === 'work'))) {
    const pages = a.primary.assets?.unit === 'screen' ? a.primary.assets.n : 1;
    const what = frame === 'dataproduct' ? `Build the ${/dashboard/i.test(a.title) ? 'dashboard' : 'data'} page` : `Build the ${pages > 1 ? 'pages' : 'page'}`;
    pieces.push(piece({ id: 'build', archetype: 'web', phrase: what, qty: pages > 1 ? { n: pages, unit: 'page', kind: 'assets', noun: 'pages' } : null, covers: reqFor(null).filter(() => false) }));
  }
  // A small web piece ("a volunteer sign-up link") is part of the build, not its own tile.
  const build = pieces.find((p) => p.id === 'build');
  if (build) {
    for (const p of pieces.filter((x) => x !== build && x.archetype === 'web' && x.role === 'work' && !x.qty)) {
      build.details.push(p.phrase);
      build.covers.push(...p.covers);
      pieces.splice(pieces.indexOf(p), 1);
    }
  }
  // Software features: the API and the screen are built apart against the contract.
  if (frame === 'software') {
    for (const p of [...pieces.filter((x) => x.archetype === 'software' && x.role === 'work')]) {
      const big = (/\badmin\b|\bdashboard\b/i.test(p.phrase) ? 180 : 150);
      if (big <= 120) continue;
      const i = pieces.indexOf(p);
      const api = piece({ ...p, id: `${p.id}-api`, phrase: `${p.phrase}: API`, side: 'api', covers: [...p.covers], minutes: Math.round(big / 2) + 15 });
      const ui = piece({ ...p, id: `${p.id}-ui`, phrase: `${p.phrase}: screens`, side: 'ui', covers: [...p.covers], minutes: Math.round(big / 2) + 15 });
      pieces.splice(i, 1, api, ui);
    }
  }

  // Literature reviews: screening and extraction are batch work over papers.
  if (frame === 'literature') {
    for (const p of pieces) {
      if (p.archetype !== 'research' || p.qty) continue;
      if (/\bscreen/i.test(p.phrase)) { p.qty = { n: 150, unit: 'paper', kind: 'items', noun: 'candidate papers' }; p.rateOverride = 40; p.assumedQty = true; }
      if (/\bextract/i.test(p.phrase)) { p.qty = { n: 24, unit: 'paper', kind: 'items', noun: 'included papers' }; p.rateOverride = 3; p.assumedQty = true; }
    }
    if (pieces.some((p) => p.assumedQty)) a.assumptions.push('Assumed about 150 candidate papers and 24 included. The protocol tile reports the real counts, and batches can be added or cut before they open.');
  }
  // "A survey of 50 office workers" is three jobs: the questionnaire, the fieldwork and the tabulation.
  for (const p of [...pieces]) {
    if (!/\b(?:survey|poll|questionnaire)\b/i.test(p.phrase) || frame === 'coding' || !['research', 'outreach', 'analyze', 'collect'].includes(p.archetype)) continue;
    if (!p.qty && !/\b(?:conduct|run|field|administer|send out|survey of)\b/i.test(p.phrase)) { p.phrase = `Write the ${p.phrase.replace(/^(?:a|an|the)\s+/i, '')} questions`; p.archetype = 'research'; continue; }
    const n = p.qty?.n || 30;
    const who = p.qty?.noun || 'respondents';
    const i = pieces.indexOf(p);
    const q = piece({ ...p, id: `${p.id}-questionnaire`, archetype: 'research', phrase: `Write the survey questionnaire for ${who}`, qty: null });
    const f = piece({ ...p, id: `${p.id}-field`, archetype: 'outreach', phrase: `Field the survey and collect responses from ${who}`, qty: { n, unit: 'person', kind: 'scale', noun: who }, covers: [], needsOverride: ['instrument'] });
    const t = piece({ ...p, id: `${p.id}-tabulate`, archetype: 'analyze', phrase: `Tabulate the survey results`, qty: null, covers: [], needsOverride: ['survey-data'], rankOverride: 55 });
    pieces.splice(i, 1, q, f, t);
  }
  if (frame === 'software' && !pieces.some((p) => p.archetype === 'design')) {
    pieces.push(piece({ id: 'ux', archetype: 'design', phrase: 'Design the screen mockups', ux: true }));
  }

  // 3. De-identification comes before anyone sees the data.
  if (a.sensitive.redact) {
    const noun = a.primary.items?.noun || a.primary.duration?.noun || 'source data';
    pieces.unshift(piece({ id: 'deidentify', archetype: 'clean', role: 'prep', phrase: `De-identify the ${noun.replace(/^hours?\s+of\s+/, '')}`, qty: a.primary.items || null, covers: reqKind(['privacy']), sensitive: true }));
  }

  // 4. The conventions piece: contract first, so every other piece can be done by someone else at the same time.
  const conv = [];
  const workCount = pieces.filter((p) => p.role === 'work').length;
  const needsConventions = workCount >= 2 || ['translation', 'coding', 'literature', 'bulk', 'software'].includes(frame) || a.vague || pieces.some((p) => p.qty && p.qty.n > 1);
  if (needsConventions) {
    if (frame === 'translation') {
      for (const t of a.languages.targets.length ? a.languages.targets : ['es']) {
        const c = CONVENTIONS.translation(a, t);
        conv.push(piece({ id: `conventions-${t}`, role: 'conventions', archetype: c.archetype, phrase: c.title, fixes: c.fixes, lang: t, covers: reqKind(['tone']).concat(conventionsFromJob ? reqFor(conventionsFromJob.id) : []) }));
      }
    } else {
      const c = (CONVENTIONS[frame] || CONVENTIONS.generic)(a);
      conv.push(piece({ id: 'conventions', role: 'conventions', archetype: c.archetype, phrase: conventionsFromJob ? conventionsFromJob.phrase : c.title, title: c.title, fixes: c.fixes, covers: conventionsFromJob ? reqFor(conventionsFromJob.id) : [] }));
    }
  }
  pieces.splice(pieces.findIndex((p) => p.role !== 'prep') === -1 ? pieces.length : pieces.findIndex((p) => p.role !== 'prep'), 0, ...conv);

  // A vague job: the scoping tile names the parts, then two to three people do them.
  if (a.vague) {
    for (const [i, label] of ['Part A', 'Part B', 'Part C'].entries()) {
      pieces.push(piece({ id: `part-${i + 1}`, archetype: 'write', phrase: `${label} of the scope`, title: `Do ${label} from the scope`, assumed: true, priority: i === 2 ? 2 : 1 }));
    }
  }

  // 5. Layers the job implies.
  const text = pieces.filter((p) => p.role === 'work' && ['write', 'teach'].includes(p.archetype) && !p.internal);
  const writes = pieces.filter((p) => p.role === 'work' && p.archetype === 'write');
  // Several writers: one editor makes it read as one voice.
  if (['document', 'research', 'generic'].includes(frame) && !a.vague && writes.length >= 3 && !has('edit')) {
    pieces.push(piece({ id: 'edit-voice', archetype: 'edit', role: 'check', phrase: 'Edit the sections for one voice', priority: 2, covers: reqKind(['tone']) }));
  }
  // Every target language gets its own translator, after the source text is final.
  if (frame !== 'translation' && a.languages.targets.length) {
    const texty = pieces.filter((p) => p.role === 'work' && p.archetype === 'design' && /\b(flyer|poster|brochure|invitations?|signs?|signage|banner|slides?|infographic|leaflet|postcard|handout|menu)\b/i.test(p.phrase));
    const sources = PRODUCT_FRAMES.has(frame) ? pieces.filter((p) => p.role === 'work' && ['write', 'visualize'].includes(p.archetype) && !p.internal) : [...text, ...texty];
    if (sources.length) {
      for (const t of a.languages.targets) {
        const lang = LANGUAGE_NAMES[t] || t;
        pieces.push(piece({ id: `translate-${t}`, archetype: 'translate', role: 'layer', phrase: `Translate the ${PRODUCT_FRAMES.has(frame) ? 'page text' : 'final text'} into ${lang}`, lang: t, sourcesOf: sources.map((s) => s.id), covers: a.requirements.filter((r) => r.kind === 'language' && r.ref === t).map((r) => r.id) }));
        // A designed piece with words on it needs its translated text laid out in the same design.
        for (const d of texty) {
          const noun = (d.phrase.match(/\b(flyer|poster|brochure|invitations?|signs?|signage|banner|slides?|infographic|leaflet|postcard|handout|menu)\b/i) || ['piece'])[0].toLowerCase();
          pieces.push(piece({ id: `layout-${d.id}-${t}`, archetype: 'design', phrase: `Lay out the ${lang} ${noun}`, title: `Lay out the ${lang} version of the ${noun}`, lang: t, after: [d.id, `translate-${t}`], covers: [...d.covers], minutes: 45 }));
        }
      }
    }
  }
  if (frame === 'translation') {
    // Each source document × each target language is its own piece.
    const docs = pieces.filter((p) => p.role === 'work' && p.archetype === 'translate');
    const targets = a.languages.targets.length ? a.languages.targets : ['es'];
    for (const d of docs) {
      const i = pieces.indexOf(d);
      const perLang = targets.map((t) => piece({ ...d, id: `${d.id}-${t}`, lang: t, covers: [...d.covers, ...a.requirements.filter((r) => r.kind === 'language' && r.ref === t).map((r) => r.id)] }));
      pieces.splice(i, 1, ...perLang);
    }
    for (const t of targets) {
      pieces.push(piece({ id: `proofread-${t}`, archetype: 'edit', role: 'check', phrase: `Proofread the ${LANGUAGE_NAMES[t] || t} translation`, lang: t, priority: docs.length > 1 || targets.length > 1 ? 1 : 2, covers: reqKind(['language']).filter((id) => /consistent/i.test(a.requirements.find((r) => r.id === id)?.text || '')) }));
    }
  }
  if (frame === 'coding' && !pieces.some((p) => p.role === 'check')) {
    pieces.push(piece({ id: 'agreement', archetype: 'code', role: 'check', phrase: 'Double-code a sample and measure agreement', priority: 2 }));
  }
  if (frame === 'bulk' && pieces.filter((p) => p.role === 'work' && p.qty).length) {
    pieces.push(piece({ id: 'spot-check', archetype: 'test', role: 'check', phrase: `Spot-check a sample of the ${a.primary.items?.noun || 'rows'} across batches`, priority: 2, kind: 'REVIEW' }));
  }
  if (frame === 'literature' && !pieces.some((p) => p.role === 'check')) {
    pieces.push(piece({ id: 'citation-check', archetype: 'edit', role: 'check', phrase: 'Check every citation against the included papers', priority: 2, kind: 'REVIEW' }));
  }
  // A product gets tested where its audience will use it.
  if (PRODUCT_FRAMES.has(frame)) {
    const wantsPhone = a.formats.includes('phone') || frame === 'software';
    const wantsA11y = a.formats.includes('accessible');
    const where = [wantsPhone ? 'on phones' : null, wantsA11y ? 'with a screen reader' : null].filter(Boolean).join(' and ');
    const retest = pieces.some((p) => /\b(?:fix|repair|remediat)/i.test(p.phrase) && p.role === 'work');
    const label = frame === 'software' ? 'Test the app on phones' : `${retest ? 'Re-test' : 'Test'} the ${frame === 'dataproduct' ? 'dashboard' : 'site'}${where ? ` ${where}` : ''}${retest ? ' after the fixes' : ''}`;
    pieces.push(piece({ id: 'qa', archetype: 'test', role: 'check', phrase: label, priority: wantsPhone || wantsA11y ? 1 : 2, covers: reqKind(['format']).filter((id) => /phone|mobile|accessib|screen/i.test(a.requirements.find((r) => r.id === id)?.text || '')) }));
  }

  // 6. The final assembly, which answers for the job as a whole.
  pieces.push(piece({ id: 'integrate', archetype: frame === 'software' ? 'software' : PRODUCT_FRAMES.has(frame) ? 'web' : 'edit', role: 'integrate', phrase: integrationPhrase(a), covers: reqKind(['format', 'quality', 'tone', 'timing', 'privacy']).filter((id) => !pieces.some((p) => p.covers.includes(id))) }));

  for (const p of pieces) {
    p.ctxFrame = frame;
    p.rank = p.rankOverride ?? (p.role === 'prep' ? 0 : p.role === 'conventions' ? 1 : p.role === 'integrate' ? 999
      : p.archetype === 'write' && p.role === 'work' && REPORTISH.test(p.phrase) && !METHODOLOGY.test(p.phrase) && a.frame !== 'media' ? 58
        : rankOf(p) + (p.role === 'layer' ? 5 : 0) + (p.role === 'check' ? 3 : 0));
    p.needs = needsOf(p, frame, pieces);
    p.provides = providesOf(p);
  }
  return pieces;
}

function integrationPhrase(a) {
  switch (a.frame) {
    case 'translation': return `Assemble the final ${a.languages.targets.map((t) => LANGUAGE_NAMES[t] || t).join(' and ') || 'translated'} version${a.languages.targets.length > 1 ? 's' : ''}`;
    case 'coding': return 'Assemble the coding report';
    case 'literature': return 'Assemble the review';
    case 'bulk': return `Merge the batches into the final ${a.primary.items?.noun || 'file'}`;
    case 'dataproduct': return 'Apply the test fixes and publish the dashboard';
    case 'web': return 'Apply the test fixes and publish the page';
    case 'software': return 'Integrate the features and ship a test build';
    case 'media': return /\b(podcast|season|episode)/i.test(a.text) ? 'Package the season for release' : `Package the ${a.primary.assets?.noun ? a.primary.assets.noun.replace(/s?$/, 's') : 'media'} for release`;
    case 'course': return 'Package the course';
    case 'event': return 'Assemble the event binder';
    case 'campaign': return 'Assemble the campaign kit and send calendar';
    case 'finance': return 'Assemble the financial package';
    case 'document': return `Assemble the final ${/\bbook\b/i.test(a.title) ? 'book' : /\breport\b/i.test(a.title) ? 'report' : /\b(proposal|grant)\b/i.test(a.title) ? 'proposal' : /\bbrief\b/i.test(a.title) ? 'brief' : /\bhandbook|manual|guide\b/i.test(a.title) ? 'handbook' : 'document'}`;
    default: return 'Bring the parts together';
  }
}

/**
 * Piece-level dependencies: each piece needs the closest upstream pieces that produce what it consumes.
 * @returns {Map<string, string[]>}
 */
export function wirePieces(pieces, a) {
  const deps = new Map(pieces.map((p) => [p.id, new Set()]));
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const prep = pieces.filter((p) => p.role === 'prep');
  const conv = pieces.filter((p) => p.role === 'conventions');
  const work = pieces.filter((p) => ['work', 'check', 'layer'].includes(p.role)).sort((x, y) => x.rank - y.rank);
  for (const c of conv) for (const p of prep) deps.get(c.id).add(p.id);
  for (const p of work) {
    // Everyone reads the conventions (translators read the glossary for their language).
    for (const c of conv) if (!c.lang || !p.lang || c.lang === p.lang) deps.get(p.id).add(c.id);
    // Whoever works on the source data reads the de-identified copy.
    if (!conv.length || ['clean', 'enrich', 'code', 'translate', 'transcribe', 'catalog', 'migrate', 'analyze', 'finance'].includes(p.archetype)) for (const pr of prep) deps.get(p.id).add(pr.id);
    if (p.after) { for (const x of p.after) deps.get(p.id).add(x); continue; }
    if (p.role === 'layer' && p.sourcesOf) {
      // A translation waits for the final text: the editor's pass if there is one, else the writers.
      const editor = pieces.find((x) => x.id === 'edit-voice');
      for (const s of editor ? [editor.id] : p.sourcesOf) deps.get(p.id).add(s);
      continue;
    }
    if (p.role === 'check') {
      const targets = checkTargets(p, pieces);
      for (const t of targets) deps.get(p.id).add(t.id);
      continue;
    }
    // Parts of one asset follow their parent ("slides for each lesson" after the lesson).
    if (p.parent && byId.get(p.parent)?.assetUnit) { deps.get(p.id).add(p.parent); continue; }
    // A report that gathers everything waits for everything upstream of it.
    if (p.archetype === 'write' && REPORTISH.test(p.phrase) && !METHODOLOGY.test(p.phrase)) {
      const kids = pieces.filter((x) => x.parent === p.id);
      const ups = [...kids, ...work.filter((x) => x !== p && x.role !== 'layer' && x.role !== 'check' && x.rank < p.rank && !(x.archetype === 'write' && REPORTISH.test(x.phrase)) && !x.parent && !kids.includes(x))];
      for (const u of ups) deps.get(p.id).add(u.id);
      for (const ch of pieces.filter((x) => x.role === 'check' && x.id !== p.id && checkTargets(x, pieces).some((t) => ups.includes(t)))) deps.get(p.id).add(ch.id);
      continue;
    }
    if (p.archetype === 'teach' && /\bguide\b/i.test(p.phrase) || (p.archetype === 'write' && /\b(facilitator|teacher'?s?) guide\b/i.test(p.phrase))) {
      for (const u of work.filter((x) => x.assetUnit && x.id !== p.id)) deps.get(p.id).add(u.id);
      continue;
    }
    const need = new Set(p.needs);
    if (!need.size) continue;
    const candidates = work.filter((x) => x !== p && (x.role === 'work' || x.role === 'layer') && x.rank < p.rank && x.provides.some((k) => need.has(k))
      && (!p.perAsset && !p.assetUnit ? true : (x.perAsset || x.assetUnit || !['media', 'research'].includes(x.archetype))));
    // For each kind of input, the closest producer wins: a chart needs the clean data, not the raw data too.
    for (const kind of need) {
      const makers = candidates.filter((x) => x.provides.includes(kind));
      if (!makers.length) continue;
      const top = Math.max(...makers.map((x) => x.rank));
      for (const m of makers.filter((x) => x.rank === top)) deps.get(p.id).add(m.id);
    }
    // Keep only the closest: drop an input that another chosen input already builds on.
    const chosen = [...deps.get(p.id)].filter((id) => byId.get(id).role === 'work');
    for (const id of chosen) {
      if (chosen.some((o) => o !== id && reaches(deps, o, id))) deps.get(p.id).delete(id);
    }
  }
  // The final assembly takes every piece nobody else consumes.
  const integ = pieces.find((p) => p.role === 'integrate');
  if (integ) {
    const consumed = new Set();
    for (const [id, ds] of deps) if (id !== integ.id) for (const d of ds) consumed.add(d);
    for (const p of pieces) if (p !== integ && !consumed.has(p.id) && p.role !== 'prep') deps.get(integ.id).add(p.id);
  }
  return new Map([...deps].map(([k, v]) => [k, [...v]]));
}

function checkTargets(p, pieces) {
  const byLang = (x) => !p.lang || x.lang === p.lang;
  const work = pieces.filter((x) => x.role === 'work' && x !== p);
  if (p.id === 'qa') return pieces.filter((x) => ['web', 'software'].includes(x.archetype) && x.role === 'work');
  if (p.id === 'edit-voice') return work.filter((x) => x.archetype === 'write');
  if (p.id === 'spot-check') return work.filter((x) => x.qty);
  if (p.id === 'citation-check') return work.filter((x) => x.archetype === 'write' || /synthes/i.test(x.phrase));
  if (/^proofread-/.test(p.id)) return work.filter((x) => x.archetype === 'translate' && byLang(x));
  if (p.archetype === 'code' || /agree|kappa|reliab|double[- ]cod/i.test(p.phrase)) return work.filter((x) => x.archetype === 'code');
  if (p.archetype === 'test') return work.filter((x) => ['web', 'software', 'analyze'].includes(x.archetype)).slice(-3);
  if (p.archetype === 'edit') return work.filter((x) => ['write', 'translate', 'teach'].includes(x.archetype) && byLang(x));
  return work.filter((x) => x.rank < p.rank).slice(-2);
}

function reaches(deps, from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const d of deps.get(from) || []) if (reaches(deps, d, to, seen)) return true;
  return false;
}

export { REPORTISH, METHODOLOGY, GEO, words };
