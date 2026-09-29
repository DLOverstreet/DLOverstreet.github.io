// Sizes pieces into tiles and writes each tile: a spec that names exactly what the person
// receives and delivers, acceptance criteria a machine or reviewer can check, skills, tier
// and minutes. Tiles in one batch group split a count of things by range; tiles for one
// asset (an episode, a lesson) follow that asset through its own pipeline.
import { LANGUAGE_NAMES, ARCHETYPES } from './lexicon.js';
import { rateFor, sizeHint, partition, clampMinutes, SKILL_TIER_FLOOR, TILE_OVERHEAD, LIMITS } from './rates.js';
import { planPieces, wirePieces, REPORTISH, METHODOLOGY, GEO, FRAME_LABELS } from './pieces.js';
import { words, leadVerbOf, PRODUCT_FRAMES } from './analyze.js';

const nice = (n) => Number(n).toLocaleString('en-US');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const STOP = new Set('a an the and or of for to in on at by with from our my your their its this that these those we us you it is are be as into about each every all any some one per new write draft build create make design produce prepare develop set up get find do fix fill clean code categorize categorise translate transcribe edit record research interview plan run launch missing ones have none everything'.split(' '));
const lang = (t) => LANGUAGE_NAMES[t] || t;
const singularWord = (w) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');

/** Short slug of a phrase's content words: "Write descriptions for the ones that have none" → "descriptions". */
export function slugOf(phrase, max = 3) {
  const ws = words(phrase).filter((w) => !STOP.has(w) && !/^\d/.test(w) && w.length > 1);
  return (ws.slice(0, max).join('-') || 'work').replace(/[^a-z0-9-]/g, '').slice(0, 32).replace(/-+$/, '');
}
const fileBase = (phrase, max = 2) => slugOf(phrase, max).replace(/-/g, '_');

/** The code column and the columns carried through, from the merged file the requester named. */
function codedColumns(a, idCol) {
  const cols = (a.namedFiles || []).flatMap((f) => f.columns).filter((c) => c !== idCol);
  const code = cols.find((c) => /^(?:themes?|codes?|categor(?:y|ies)|labels?|tags?)$/.test(c)) || null;
  return { code, carry: cols.filter((c) => c !== code) };
}

/** The id column for rows of this noun: "product listings" → listing_id. */
function idColumn(noun) {
  const last = words(noun || 'record').filter((w) => !/^(?:hours?|of)$/.test(w)).pop() || 'record';
  return `${singularWord(last)}_id`.replace(/[^a-z_]/g, '');
}

/* ---------------------------------------------------------------- sizing */

const SUBSET_SHARE = 0.35;
const LAYER_WORDS_PER_HOUR = 500;

function wordsProduced(p) {
  const m = p.totalMinutes || 60;
  if (p.archetype === 'write' || p.archetype === 'teach') return Math.round(m * 7);
  if (p.archetype === 'visualize') return 80;
  if (p.archetype === 'design') return /\b(flyer|poster|brochure|invitations?|leaflet|handout|menu|slides?)\b/i.test(p.phrase) ? 220 : 60;
  return 100;
}

function sizePiece(p, a, byId, pieces) {
  const frame = a.frame;
  const batch = (n, perUnit, axis, noun, opts = {}) => {
    p.batches = partition(n, perUnit, opts);
    p.axis = axis;
    p.unitNoun = noun;
  };
  const single = (m) => { p.batches = [{ index: 1, of: 1, from: 1, to: 1, count: 1, minutes: clampMinutes(m) }]; p.axis = null; };
  if (p.role === 'conventions') {
    const base = { translation: 30, coding: 60, literature: 90, bulk: 45, software: 90, dataproduct: 60, media: 60, course: 75, event: 45, campaign: 45, finance: 60, document: 60, web: 60, research: 60 }[frame] || 60;
    const bigSource = (a.primary.length?.n || 0) > 10 || (a.primary.items?.n || 0) > 500;
    return single(base + (bigSource && frame === 'translation' ? 30 : 0));
  }
  if (p.role === 'prep') {
    const n = p.qty?.n || 0;
    const perHour = { response: 80, record: 300, document: 6, interview: 1, transaction: 300, contact: 200 }[p.qty?.unit] || 150;
    const m = n ? (n / perHour) * 60 : 60;
    if (m + TILE_OVERHEAD > LIMITS.max) { p.scripted = true; return single(90); }
    return single(m + TILE_OVERHEAD);
  }
  if (p.role === 'integrate') {
    const base = frame === 'bulk' ? 60 : PRODUCT_FRAMES.has(frame) ? 60 : frame === 'document' ? 75 : 45;
    return single(base);
  }
  if (p.role === 'layer' && p.archetype === 'translate') {
    const srcWords = (p.sourcesOf || []).map((id) => byId.get(id)).filter(Boolean).reduce((n, s) => n + wordsProduced(s), 0) || 500;
    p.sourceWords = srcWords;
    return batch(srcWords, 60 / LAYER_WORDS_PER_HOUR, `words-${p.id}`, 'words', { target: 90 });
  }
  if (p.role === 'check') {
    const targets = pieces.filter((x) => x.role === 'work');
    if (/^proofread-/.test(p.id)) {
      const trs = targets.filter((x) => x.archetype === 'translate' && x.lang === p.lang);
      // A long translation is proofread in step with it, section by section.
      if (trs.length === 1 && trs[0].batches.length > 1 && trs[0].qty) {
        const rate = rateFor('edit', trs[0].qty.unit) || 5;
        p.qty = trs[0].qty;
        batch(trs[0].qty.n, 60 / rate, trs[0].axis, trs[0].unitNoun);
        return;
      }
      const tr = trs.reduce((n, x) => n + (x.totalMinutes || 60), 0);
      return single(Math.max(30, tr / 4 + TILE_OVERHEAD));
    }
    if (p.id === 'edit-voice') {
      const w = targets.filter((x) => x.archetype === 'write').reduce((n, x) => n + wordsProduced(x), 0);
      return single(Math.max(30, (w / 1500) * 60 + TILE_OVERHEAD));
    }
    if (p.id === 'qa') return single(frame === 'software' ? 90 : 60);
    if (p.archetype === 'code' || /agree|kappa/i.test(p.phrase)) return single(45);
    return single(45);
  }
  // Work pieces.
  if (p.minutes) return single(p.minutes);
  // A story or book is one writer's voice: its text is not split by page.
  if (p.archetype === 'write' && p.qty?.kind === 'length' && /\b(book|story|stories|manuscript|novel|memoir|script|poem|screenplay)\b/i.test(`${p.phrase}`)) {
    const short = /\b(picture|children'?s|board) book\b/i.test(a.text);
    const m = p.qty.n * (short ? 5 : 45) + TILE_OVERHEAD;
    if (m <= LIMITS.max || short) return single(Math.min(LIMITS.max, m));
  }
  const assetsN = (() => {
    if (p.assetUnit && p.qty) return p.qty.n;
    // A part of each asset (slides for each lesson) follows the assets; a part of a 2-page report doesn't follow its pages.
    if (p.parent && byId.get(p.parent)?.qty && byId.get(p.parent).qty.kind !== 'length') return byId.get(p.parent).qty.n;
    if (p.perAsset && a.primary.assets) return a.primary.assets.n;
    return 0;
  })();
  if (assetsN > 1 || p.assetUnit) {
    const perUnit = sizeHint(p.phrase, p.archetype);
    const parentQty = p.parent && byId.get(p.parent)?.qty?.kind !== 'length' ? byId.get(p.parent)?.qty : null;
    const unit = p.assetUnit ? p.qty : parentQty || a.primary.assets;
    const noun = unit?.noun || 'items';
    batch(assetsN || 1, perUnit, `asset-${unit?.unit || 'x'}-${assetsN}`, noun, { target: 75 });
    p.perAssetMinutes = perUnit;
    return;
  }
  const splitAxis = p.qty && (['items', 'length', 'duration', 'languages'].includes(p.qty.kind)
    || (['period', 'region'].includes(p.qty.kind) && ['collect', 'clean', 'code', 'finance', 'enrich', 'research'].includes(p.archetype))
    || (p.qty.kind === 'scale' && ['outreach', 'research', 'schedule'].includes(p.archetype)));
  if (splitAxis) {
    const q = p.qty;
    const rate = p.rateOverride ?? rateFor(p.archetype, q.unit) ?? (p.archetype === 'outreach' && q.unit === 'person' ? 5 : null);
    if (rate) {
      // A piece that touches only some rows ("fill in missing sizes") still walks every row, doing work on about a third.
      const share = p.subset ? SUBSET_SHARE : 1;
      if (p.subset) p.subsetAssumed = true;
      if (p.archetype === 'outreach' && q.unit === 'person') { p.target = q.n; }
      const perUnit = (/\bletters?\b/i.test(p.phrase) && q.unit === 'contact' ? 30 : 60 / rate) * share;
      batch(q.n, perUnit, `${q.unit}-${q.n}`, q.noun, { maxBatches: 60, target: p.archetype === 'translate' ? 105 : 75 });
      if (p.batches.deferred) p.deferred = { ...p.batches.deferred, noun: q.noun };
      p.rangeOverAll = !p.subset;
      return;
    }
  }
  const m = sizeHint(p.phrase, p.archetype) + TILE_OVERHEAD;
  if (m < 180) return single(Math.min(LIMITS.max, m));
  const k = Math.ceil(m / 90);
  p.batches = Array.from({ length: k }, (_, i) => ({ index: i + 1, of: k, from: i + 1, to: i + 1, count: 1, minutes: clampMinutes(m / k + 5) }));
  p.axis = `part-${p.id}`;
  p.byPart = true;
}

function sizeAll(pieces, a) {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const order = [...pieces].sort((x, y) => (x.role === 'work' ? 0 : 1) - (y.role === 'work' ? 0 : 1));
  for (const p of order) {
    sizePiece(p, a, byId, pieces);
    p.totalMinutes = p.batches.reduce((n, b) => n + b.minutes, 0);
  }
}

/** Merges small sibling pieces of the same kind ("hours", "what to bring") into one tile. */
function foldSmall(pieces) {
  const groups = new Map();
  for (const p of pieces) {
    if (p.role !== 'work' || p.batches.length !== 1 || p.qty || p.perAsset || p.assetUnit || p.parent || p.totalMinutes > 45) continue;
    if (!['write', 'research', 'design', 'edit'].includes(p.archetype)) continue;
    if (pieces.some((x) => x.parent === p.id)) continue;
    const k = `${p.archetype}|${p.internal}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(p);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let bucket = [];
    const flush = () => {
      if (bucket.length < 2) { bucket = []; return; }
      const [first, ...rest] = bucket;
      const minutes = clampMinutes(bucket.reduce((n, x) => n + x.totalMinutes - TILE_OVERHEAD, 0) + TILE_OVERHEAD);
      first.folded = bucket.map((x) => x.phrase);
      first.phrase = first.archetype === 'write' ? `Write the copy: ${bucket.map((x) => x.phrase.toLowerCase()).join('; ')}` : bucket.map((x) => x.phrase).join('; ');
      first.covers = bucket.flatMap((x) => x.covers);
      first.batches = [{ index: 1, of: 1, from: 1, to: 1, count: 1, minutes }];
      first.totalMinutes = minutes;
      for (const r of rest) pieces.splice(pieces.indexOf(r), 1);
      bucket = [];
    };
    for (const p of list) {
      if (bucket.reduce((n, x) => n + x.totalMinutes - TILE_OVERHEAD, 0) + p.totalMinutes > 105) flush();
      bucket.push(p);
    }
    flush();
  }
}

/* ---------------------------------------------------------------- content */

const A = (text, rule) => ({ check: 'AUTO', text, rule });
const L = (text) => ({ check: 'LLM', text });
const P = (text) => ({ check: 'PEER', text });

function rangeText(p, b) {
  if (b.of <= 1) return '';
  if (p.byPart) return `part ${b.index} of ${b.of}`;
  const noun = p.unitNoun || 'items';
  if (/^asset-/.test(p.axis || '')) {
    const one = singularWord(words(noun).pop() || 'item');
    return b.from === b.to ? `${one} ${b.from}` : `${noun.split(' ').pop()} ${b.from}–${b.to}`;
  }
  if (/^words-/.test(p.axis || '')) return b.of > 1 ? `part ${b.index} of ${b.of}` : '';
  if (/^hour-media/.test(p.axis || '')) return b.from === b.to ? `hour ${b.from} of the recordings` : `hours ${b.from}–${b.to} of the recordings`;
  if (/^(month|year|quarter)-/.test(p.axis || '')) { const u = p.axis.split('-')[0]; return b.from === b.to ? `${u} ${b.from}` : `${u}s ${b.from}–${b.to}`; }
  if (/^person-/.test(p.axis || '')) { const last = words(noun).pop() || 'people'; return `${last} ${nice(b.from)}–${nice(b.to)}`; }
  const last = words(noun).pop() || 'rows';
  return b.from === b.to ? `${singularWord(last)} ${nice(b.from)}` : `${last.endsWith('s') ? last : `${last}s`} ${nice(b.from)}–${nice(b.to)}`;
}

function batchSuffix(b) { return b.of > 1 ? `_${String(b.index).padStart(2, '0')}` : ''; }

/** Tile content for one batch of one piece. */
function contentFor(p, b, ctx) {
  const { a } = ctx;
  const frame = a.frame;
  const range = rangeText(p, b);
  const suffix = batchSuffix(b);
  const aud = audienceFor(a);
  const tone = a.constraints.filter((c) => /plain|friendly|simple|clear|professional|reading level/i.test(c));
  const toneLine = tone.length ? L(`The writing is ${tone.map((t) => t.replace(/^keep it\s+/i, '').replace(/\.$/, '')).join(' and ').toLowerCase()}, as the requester asked`) : null;
  const noun = p.unitNoun || a.primary.items?.noun || 'records';
  const idCol = ctx.idCol;
  const one = singularWord(words(noun).pop() || 'item');
  const withTone = (list) => (toneLine ? [...list, toneLine] : list);
  const out = { title: '', what: '', outputs: [], deliverableFormat: '', criteria: [], skills: [...(ARCHETYPES[p.archetype]?.skills || ['research'])], tier: ARCHETYPES[p.archetype]?.tier || 2, languages: [], sensitive: [] };
  const lead = cap(p.phrase.replace(/[.:]+$/, ''));
  const titled = (t) => (range ? `${t}: ${range}` : t);

  if (p.role === 'conventions') {
    const c = conventionsContent(p, ctx, out);
    if (p.details?.length) c.what += ` The requester asked for: ${p.details.map((d) => d.toLowerCase()).join('; ')}.`;
    return c;
  }
  if (p.role === 'prep') {
    const file = `redacted_${(words(noun).pop() || 'data').replace(/[^a-z]/g, '')}.csv`;
    out.title = cap(p.phrase);
    out.what = p.scripted
      ? `Write a script that removes or masks ${a.sensitive.fields.join(', ') || 'personal details'} from the attached ${noun}, run it, and hand-check a sample of 50 rows. Replace each person with a stable placeholder ([PERSON_1], [ADDRESS_1]) so later tiles can still count them.`
      : `Remove or mask ${a.sensitive.fields.join(', ') || 'personal details'} in the attached ${noun}. Replace each person with a stable placeholder ([PERSON_1], [ADDRESS_1]) so later tiles can still count them, and keep every row.`;
    out.outputs = [file, 'redaction_log.md'];
    out.deliverableFormat = `${file} plus redaction_log.md`;
    out.criteria = [A(`${file} keeps an id column and the text column`, `csv_columns(${idCol}, text)`), A('Every row has an id', `csv_no_blank(${idCol})`), L('No name, street address, phone number or email address is left in the text'), L('The log counts each kind of redaction')];
    if (a.primary.items?.n) out.criteria.splice(1, 0, A(`All ${nice(a.primary.items.n)} rows are kept`, `csv_min_rows(${Math.floor(a.primary.items.n * 0.95)})`));
    out.skills = p.scripted ? ['python', 'data-cleaning'] : ['data-cleaning', 'data-entry'];
    out.tier = p.scripted ? 3 : 2;
    out.sensitive = a.sensitive.fields.length ? a.sensitive.fields : ['personal data'];
    return out;
  }
  if (p.role === 'integrate') return integrationContent(p, ctx, out);

  switch (p.archetype) {
    case 'translate': {
      const t = p.lang || a.languages.targets[0] || 'es';
      const src = p.role === 'layer' ? 'the final text from the tiles listed under “You receive”' : `${lead.replace(/^(?:our|the)\s+/i, 'the ')}`;
      const base = p.role === 'layer' ? `text_${t}` : fileBase(p.phrase, 2);
      const file = `${base}${suffix}.${t}.md`;
      const srcWords = p.role === 'layer' ? Math.round(b.count) : estimateWords(p, b);
      out.title = p.role === 'layer' ? titled(`Translate the ${PRODUCT_FRAMES.has(frame) ? 'page text' : 'text'} into ${lang(t)}`) : titled(`Translate ${lead.replace(/^(?:our|the)\s+/i, 'the ').replace(/^the /, '')} into ${lang(t)}`.replace(/^Translate ([a-z])/, (m, c) => `Translate the ${c}`));
      out.what = `Translate ${range ? `${range} of ` : ''}${src} into ${lang(t)}${a.audiences[0] ? ` for ${a.audiences[0]}` : ''}. Use the glossary for every listed term, keep headings, numbers, links and structure as they are, and mark anything you could not translate with [CHECK].`;
      out.outputs = [file];
      out.deliverableFormat = file;
      out.criteria = [A('The translation is delivered as Markdown', 'file_ext(md)'), A(`The translation is about the length of the source (${nice(Math.round(srcWords * 0.6))}–${nice(Math.round(srcWords * 1.6))} words)`, `word_count(${Math.round(srcWords * 0.6)}, ${Math.round(srcWords * 1.6)})`), L(`The translation is faithful and reads as natural ${lang(t)}`), L('Every glossary term is used consistently')];
      out.criteria = withTone(out.criteria);
      out.skills = [`translation-${t}`];
      out.languages = [a.languages.source || 'en', t];
      out.tier = /\b(legal|contract|medical|clinical|court|immigration)\b/i.test(`${p.phrase} ${a.title}`) ? 3 : 2;
      return out;
    }
    case 'code': {
      if (p.role === 'check') {
        out.title = 'Double-code a sample and measure agreement';
        out.what = `Code a random sample of ${Math.min(30, Math.max(10, Math.round((a.primary.items?.n || 100) * 0.15)))} ${noun} drawn from every batch without looking at the first codes, then compute Cohen’s kappa per code and overall. Recommend codebook fixes for any code below 0.6.`;
        out.outputs = ['agreement.md'];
        out.deliverableFormat = 'agreement.md';
        out.criteria = [A('The report states kappa', 'contains("kappa")'), A('The report has a Recommendations section', 'has_heading("Recommendations")'), L('Agreement is reported per code, with a fix proposed wherever it is low')];
        out.skills = ['statistics', 'survey-coding'];
        out.tier = 3;
        return out;
      }
      const file = `coded${suffix || ''}.csv`.replace('coded.csv', `coded_${fileBase(noun, 1)}.csv`);
      // The columns the requester named for the merged file ("response_id, branch and theme(s)") are every batch's columns.
      const named = codedColumns(a, idCol);
      const codeCol = named.code || (frame === 'coding' ? 'code' : 'category');
      const cols = [idCol, ...named.carry, codeCol];
      const several = /\bone or more\b|\bmultiple\b|\ball that apply\b|\(s\)|\bthemes\b/i.test(`${p.phrase} ${codeCol}`);
      out.title = titled(frame === 'coding' ? `Code ${noun.split(' ').pop()}` : lead);
      out.what = frame === 'coding'
        ? `Apply the codebook to ${range || `all ${noun}`}${a.sensitive.redact ? ' of the redacted file' : ''}. Give each ${one} ${several ? `every code that applies in ${codeCol} (separate several with a semicolon)` : 'one code'} and use OTHER when nothing fits, saying why in a notes column.${named.carry.length ? ` Copy ${named.carry.join(', ')} through from the source file.` : ''} Do not change the codebook; list proposed changes at the end of your notes instead.`
        : `${lead} for ${range || `every ${one}`}. Use only the categories in the conventions file; flag any ${one} that fits none as UNSURE in the notes column.`;
      out.outputs = [file];
      out.deliverableFormat = named.carry.length ? `${file} with ${cols.join(', ')}` : file;
      out.criteria = [A(`The file has ${cols.join(', ')}`, `csv_columns(${cols.join(', ')})`), A(`Every ${one} has ${/s$/.test(codeCol) ? `at least one ${singularWord(codeCol)}` : `a ${codeCol}`}`, `csv_no_blank(${codeCol})`), A(`Each ${one} appears once`, `csv_unique(${idCol})`)];
      if (b.count > 1 && !p.subset) out.criteria.push(A(`All ${nice(b.count)} ${noun.split(' ').pop()} in the range are coded`, `csv_min_rows(${b.count})`));
      out.criteria.push(L(frame === 'coding' ? 'Codes follow the codebook definitions' : 'Categories follow the list in the conventions file'));
      out.skills = frame === 'coding' ? ['survey-coding'] : ['data-entry', 'excel'];
      out.tier = frame === 'coding' ? 2 : 1;
      out.sensitive = a.sensitive.yes && !a.sensitive.redact ? a.sensitive.fields : [];
      return out;
    }
    case 'clean': case 'enrich': case 'migrate': {
      const isGeo = GEO.test(p.phrase);
      if (isGeo) {
        const file = 'geocoded.csv';
        out.title = cap(p.phrase);
        out.what = 'Geocode each address in clean_data.csv to latitude, longitude and area id with a free batch geocoder (for example the Census Geocoder). Report the match rate and how unmatched rows were handled. Keep street addresses out of every output file.';
        out.outputs = [file, 'geocoding_note.md'];
        out.deliverableFormat = `${file} plus geocoding_note.md`;
        out.criteria = [A(`${file} has ${idCol}, lat, lon and tract`, `csv_columns(${idCol}, lat, lon, tract)`), A('Every row has an area id', 'csv_no_blank(tract)'), L('The note reports the match rate and how unmatched rows were handled')];
        out.skills = ['geocoding', 'gis'];
        out.tier = 3;
        out.sensitive = ['address'];
        return out;
      }
      if (frame === 'bulk' || p.qty) {
        const col = columnFor(p);
        const file = `${fileBase(p.phrase, 1)}${suffix}.csv`;
        out.title = titled(lead);
        out.what = `${lead} for ${range || `the ${noun}`}${p.subset ? ` (only the ${noun.split(' ').pop()} that need it; leave the rest out of your file)` : ''}. Deliver only the ${idCol} and the column${col.length > 1 ? 's' : ''} you own (${col.join(', ')}); other tiles own the other columns. Follow the rules in the batch spec.`;
        out.outputs = [file];
        out.deliverableFormat = `${file} with ${[idCol, ...col].join(', ')}`;
        out.criteria = [A(`The file has ${[idCol, ...col].join(', ')}`, `csv_columns(${[idCol, ...col].join(', ')})`), A(`Each ${one} appears once`, `csv_unique(${idCol})`), A(`No ${col[0]} is blank`, `csv_no_blank(${col[0]})`)];
        if (!p.subset && b.count > 1) out.criteria.push(A(`All ${nice(b.count)} rows in the range are there`, `csv_min_rows(${b.count})`));
        out.criteria.push(L(`Every change follows the rules in the batch spec`));
        out.skills = p.archetype === 'enrich' ? ['data-entry', 'research'] : p.archetype === 'migrate' ? ['sql', 'data-cleaning'] : ['data-cleaning', 'excel'];
        out.tier = p.archetype === 'enrich' ? 1 : 2;
        return out;
      }
      out.title = cap(p.phrase);
      out.what = 'Produce clean_data.csv: one row per unique id, dates as YYYY-MM-DD, categories trimmed and consistent, obvious duplicates removed. Write cleaning_notes.md listing every rule you applied and how many rows each changed.';
      out.outputs = ['clean_data.csv', 'cleaning_notes.md'];
      out.deliverableFormat = 'clean_data.csv plus cleaning_notes.md';
      out.criteria = [A(`clean_data.csv has ${idCol} and date`, `csv_columns(${idCol}, date)`), A('Every id appears once', `csv_unique(${idCol})`), A('No date is blank', 'csv_no_blank(date)'), L('The notes list every rule applied with its row count')];
      out.skills = ['data-cleaning', 'excel'];
      return out;
    }
    case 'collect': {
      const cols = collectColumns(a, idCol, p);
      const script = !a.provided && (a.sources.length || /\b(scrape|calendar|portal|api|public data|records)\b/i.test(p.phrase));
      const file = `raw_${fileBase(p.phrase.replace(/^collect (?:the )?/i, ''), 1) || 'data'}${suffix}.csv`.replace('raw_data', 'raw_data');
      out.title = titled(cap(p.phrase));
      out.what = script
        ? `Write a script that collects ${range ? `${range} of ` : ''}the records ${a.sources[0] ? `from ${a.sources[0]}` : 'from the public source named in the goal'}${a.place ? ` for ${a.place}` : ''}. Save one row per record with the columns ${cols.join(', ')}. Put the source URL and the command to rerun it at the top of the script. Do not collect people’s names.`
        : `${lead}${range ? ` (${range})` : ''}. Save one row per ${one} with the columns ${cols.join(', ')}, and note where each row came from.`;
      out.outputs = script ? [`collect${suffix}.py`, file] : [file];
      out.deliverableFormat = script ? `Python script plus ${file}` : file;
      out.criteria = [...(script ? [A('The submission includes the collection script', 'file_ext(py)')] : []), A(`${file} has ${cols.join(', ')}`, `csv_columns(${cols.join(', ')})`), A('At least 20 rows were collected', 'csv_min_rows(20)'), L(script ? 'The script states its source URL and how to rerun it' : 'Every row names its source')];
      out.skills = script ? ['python', 'web-scraping'] : ['research', 'data-entry'];
      out.tier = script ? 3 : 2;
      if (cols.includes('address')) out.sensitive = ['address'];
      return out;
    }
    case 'visualize': {
      const subject = p.phrase.replace(/^(?:a|an|the)?\s*(?:[\w-]+\s+)?(?:chart|graph|plot)s?\s+(?:of|showing|for)\s+/i, '');
      const base = `chart_${fileBase(subject, 2) || fileBase(p.phrase, 2)}${suffix}`;
      const isMap = GEO.test(p.phrase);
      out.title = `Design the ${lead.replace(/^(?:a|an|the)\s+/i, '').toLowerCase()} ${isMap ? '' : /chart|graph/i.test(p.phrase) ? '' : 'chart'}`.replace(/\s+$/, '').replace(/^Design the (.)/, (m, c) => `Design the ${c}`);
      out.what = `${/\b(?:chart|graph|plot)s?\b/i.test(lead) && !isMap ? `Make ${lead.replace(/^(?:a|an|the)\s+/i, 'the ').replace(/^The /, 'the ')}` : `${isMap ? 'Map' : 'Chart'} ${lead.replace(/^(?:a|an|the)\s+/i, '').toLowerCase()}`} ${aud}, from the upstream data. Deliver an SVG and a JSON spec with title, source and series. The title states the finding in plain words; follow the colors and fonts in the style file${isMap ? ', and use a colorblind-safe sequential palette with a legend' : ''}.`;
      out.outputs = [`${base}.svg`, `${base}.json`];
      out.deliverableFormat = `${base}.svg plus ${base}.json`;
      out.criteria = [A('The chart is delivered as SVG', 'file_ext(svg)'), A('The JSON spec has title, source and series', 'json_keys(title, source, series)'), L('The title states the finding rather than naming the metric'), P('The chart is legible for a general audience at phone width')];
      out.skills = isMap ? ['data-viz', 'gis'] : ['data-viz', 'svg'];
      return out;
    }
    case 'analyze': {
      const tracker = /\btracker\b/i.test(p.phrase);
      if (tracker) {
        out.title = cap(p.phrase);
        out.what = `Build ${lead.replace(/^(?:a|an|the)\s+/i, 'a ').toLowerCase()} as a spreadsheet: one row per ${/campaign/i.test(a.frame) ? 'send or post' : 'item'}, with date, channel, reach, responses and amount, plus totals. Include a short how-to-update note.`;
        out.outputs = ['tracker.csv', 'tracker_howto.md'];
        out.deliverableFormat = 'tracker.csv plus tracker_howto.md';
        out.criteria = [A('tracker.csv has date, channel, reach, responses and amount', 'csv_columns(date, channel, reach, responses, amount)'), L('The how-to lets someone else keep it up to date')];
        out.skills = ['excel', 'data-entry'];
        out.tier = 1;
        return out;
      }
      if (/\b(?:table|counts?|totals?|tall(?:y|ies)|crosstab|frequenc\w+)\b/i.test(p.phrase) && !/\b(?:model|regression|forecast|predict)/i.test(p.phrase)) {
        // A table of counts is counted from the rows themselves, not estimated.
        const base = `table_${fileBase(p.phrase.replace(/^(?:a|an|the)\s+table\s+of\s+/i, ''), 3) || 'counts'}${suffix}`;
        out.title = titled(cap(p.phrase));
        out.what = `${lead} from the upstream files. Count from the rows themselves (one row per group, plus a total), say in ${base}_note.md which file each count comes from, and say how a row with several codes was counted.`;
        out.outputs = [`${base}.csv`, `${base}_note.md`];
        out.deliverableFormat = `${base}.csv plus ${base}_note.md`;
        out.criteria = [A('The table is a CSV', 'file_ext(csv)'), A('The table has a row for each group', 'csv_min_rows(2)'), L('Every count can be reproduced from the upstream files'), L('The note says how the counts were made')];
        out.skills = ['statistics', 'excel'];
        out.tier = 2;
        return out;
      }
      out.title = titled(cap(p.phrase.length > 70 ? `Analyze ${slugOf(p.phrase, 3).replace(/-/g, ' ')}` : p.phrase));
      out.what = `${lead}${range ? ` for ${range}` : ''}. Write analysis.md with the numbers later tiles will cite, each traceable to the script, and state the method and its limits in plain words.`;
      out.outputs = [`analysis${suffix}.md`, `analysis${suffix}.py`];
      out.deliverableFormat = `analysis${suffix}.md plus the script`;
      out.criteria = [A('The analysis includes its script', 'file_ext(py|r|sql|ipynb)'), A('The write-up has a Method section', 'has_heading("Method")'), L('Every number in the write-up can be traced to the script'), L('Limits of the data are stated')];
      out.skills = ['statistics', 'python'];
      out.tier = 3;
      return out;
    }
    case 'write': return writeContent(p, b, ctx, out, { range, suffix, lead, titled, withTone, aud, one });
    case 'edit': {
      if (/^proofread-/.test(p.id)) {
        const t = p.lang;
        out.title = `Proofread the ${lang(t)} translation`;
        out.what = `Read every ${lang(t)} file against its source and the glossary. Fix errors directly and list each change in proofread.md with a "Findings" section (original, fix, reason). Check that terms are the same across every file${a.languages.targets.length > 1 ? ' and match the other language versions where the glossary says so' : ''}.`;
        out.outputs = [`proofread_${t}.md`];
        out.deliverableFormat = `proofread_${t}.md plus corrected files`;
        out.criteria = withTone([A('The report has a Findings section', 'contains("Findings")'), L('Each finding quotes the original and the fix'), L('Glossary terms are consistent across all files')]);
        out.skills = [`translation-${t}`, 'editing'];
        out.languages = [a.languages.source || 'en', t];
        return out;
      }
      if (p.id === 'edit-voice') {
        out.title = 'Edit the sections for one voice';
        out.what = 'Edit every section so the whole reads as one document: consistent terms, voice and formatting, no repetition between sections, and transitions that connect them. Keep facts and numbers unchanged; list any you doubt.';
        out.outputs = ['edited_sections.md', 'edit_notes.md'];
        out.deliverableFormat = 'edited_sections.md plus edit_notes.md';
        out.criteria = withTone([A('The notes have a Changes section', 'has_heading("Changes")'), L('Facts and numbers are unchanged'), P('The sections read as one voice')]);
        out.skills = ['editing', 'copywriting'];
        return out;
      }
      if (p.id === 'citation-check') {
        out.title = 'Check every citation';
        out.what = 'Check that every citation in the synthesis matches an included paper and says what the paper says, and that the reference list is complete. Deliver citation_check.md with a "Findings" section.';
        out.outputs = ['citation_check.md'];
        out.deliverableFormat = 'citation_check.md';
        out.criteria = [A('The report has a Findings section', 'contains("Findings")'), L('Each problem names the citation and the fix')];
        out.skills = ['citation-management', 'literature-review'];
        return out;
      }
      out.title = titled(cap(p.phrase));
      out.what = `${lead}${range ? ` (${range})` : ''}. Fix clarity, grammar and consistency; keep meaning and numbers. List each substantive change in edit_notes.md.`;
      out.outputs = [`edited${suffix}.md`, `edit_notes${suffix}.md`];
      out.deliverableFormat = `edited${suffix}.md plus edit_notes${suffix}.md`;
      out.criteria = withTone([A('Edit notes are included', 'file_ext(md)'), L('Meaning and numbers are unchanged')]);
      out.skills = ['editing'];
      return out;
    }
    case 'design': {
      const base = fileBase(p.phrase, 2) || 'design';
      const perAsset = /^asset-/.test(p.axis || '');
      out.title = titled(cap(p.phrase.replace(/^(?:create|make|design)\s+/i, 'Design ').replace(/^(?!Design)/, 'Design ')));
      out.what = `${lead}${range ? ` for ${range}` : ''}${a.audiences[0] ? `, for ${a.audiences[0]}` : ''}. Follow the look set in the conventions file. Deliver the artwork as SVG (and PDF or PNG if you have them), with editable source or a note on fonts and colors used.${/slides?|deck/i.test(p.phrase) ? ' One slide per key idea, with speaker notes in a Markdown file.' : ''}`;
      out.outputs = [`${base}${suffix}.svg`, ...( /slides?|deck/i.test(p.phrase) ? [`${base}${suffix}_notes.md`] : [])];
      out.deliverableFormat = `${base}${suffix}.svg${/slides?|deck/i.test(p.phrase) ? ` plus ${base}${suffix}_notes.md` : ''}`;
      out.criteria = [A('The artwork is delivered as SVG, PDF or PNG', 'file_ext(svg|pdf|png)'), L('It follows the colors, fonts and tone in the conventions file'), P(`It is clear and readable ${a.formats.includes('phone') ? 'on a phone' : a.formats.includes('print') ? 'when printed' : 'at its intended size'}`)];
      if (perAsset && b.count > 1) out.criteria.splice(1, 0, A(`One file for each of the ${b.count} items`, `min_files(${b.count})`));
      out.skills = /slides?|deck/i.test(p.phrase) ? ['graphic-design', 'instructional-design'] : /screen|mockup|wireframe|ui\b/i.test(p.phrase) ? ['ux-design', 'figma'] : ['graphic-design'];
      return out;
    }
    case 'web': {
      const page = p.id === 'build' ? 'index.html' : `${fileBase(p.phrase, 2)}.html`;
      out.title = titled(cap(p.phrase.replace(/^set up\s+/i, 'Build ')));
      const extras = p.details?.length ? ` Include: ${p.details.map((d) => d.toLowerCase()).join('; ')}.` : '';
      out.what = PRODUCT_FRAMES.has(frame)
        ? `Build ${page} from the upstream copy, charts and style tokens, using semantic HTML, no external dependencies and a layout that works from 320px up.${extras} Use the files from other tiles as they are; don’t rewrite their content.`
        : `${lead}${a.audiences[0] ? ` for ${a.audiences[0]}` : ''}: a single page with a form or link that works on a phone, matching the look in the conventions file.${extras} Deliver the page and a note on where it is hosted or how to publish it.`;
      out.outputs = [page, ...(PRODUCT_FRAMES.has(frame) ? ['styles.css'] : ['publish_note.md'])];
      out.deliverableFormat = `${page}${PRODUCT_FRAMES.has(frame) ? ' plus styles.css' : ' plus publish_note.md'}`;
      out.criteria = [A('The page is HTML', 'file_ext(html)'), L('The page uses semantic landmarks and one h1'), L('Every upstream piece is included unchanged')];
      if (a.formats.includes('phone')) out.criteria.push(L('The layout works at 320px wide without sideways scrolling'));
      out.skills = ['web-dev', 'html-css'];
      out.tier = 3;
      return out;
    }
    case 'software': {
      const side = p.side;
      const feat = p.phrase.replace(/:\s*(?:API|screens)$/i, '');
      const base = fileBase(feat, 2) || 'feature';
      out.title = cap(side === 'api' ? `Build the API for ${feat.toLowerCase()}` : side === 'ui' ? `Build the screens for ${feat.toLowerCase()}` : feat);
      out.what = side === 'api'
        ? `Implement the endpoints for “${feat}” exactly as the API contract defines them, with input validation and tests. Stub anything owned by other features.`
        : side === 'ui'
          ? `Build the screens for “${feat}” against the API contract, using mock responses from the contract so you don’t wait for the back end. Cover loading, empty and error states.`
          : `${lead}, following the API contract and data model. Include tests.`;
      out.outputs = [`${base}_${side || 'feature'}.js`, `${base}_${side || 'feature'}.test.js`];
      out.deliverableFormat = `${out.outputs.join(' plus ')} and a README section`;
      out.criteria = [A('Code is delivered as JavaScript or TypeScript', 'file_ext(js|ts)'), A('Tests are included', 'min_files(2)'), L(side === 'ui' ? 'Loading, empty and error states are handled' : 'Every endpoint in the contract for this feature is implemented'), L('Nothing outside this feature’s part of the contract is changed')];
      out.skills = side === 'ui' ? ['mobile-dev', 'javascript'] : ['javascript', 'sql'];
      out.tier = 3;
      return out;
    }
    case 'research': {
      if (frame === 'literature' || /\b(screen|extract)/i.test(p.phrase)) return literatureContent(p, b, ctx, out, { range, suffix, lead });
      const perAsset = /^asset-/.test(p.axis || '');
      const file = perAsset ? `research${suffix}.md` : `${fileBase(p.phrase, 2) || 'research'}${suffix}.csv`;
      out.title = titled(cap(p.phrase));
      if (perAsset) {
        out.what = `Research ${range}: facts, dates, sources and two or three possible guests or voices, following the outline. Deliver research${suffix}.md with a Sources heading.`;
        out.outputs = [file];
        out.deliverableFormat = file;
        out.criteria = [A('The notes have a Sources section', 'has_heading("Sources")'), A('The notes are 400 to 1,200 words', 'word_count(400, 1200)'), L('Every fact has a source')];
      } else {
        const n = /\bquotes?\b|\bvenues?\b|\bvendors?\b|\bcatering\b|\bshortlist\b/i.test(p.phrase) ? 5 : 8;
        out.what = `${lead}${a.place ? ` in or near ${a.place}` : ''}${a.primary.scale ? ` for about ${nice(a.primary.scale.n)} ${a.primary.scale.noun}` : ''}. Compare at least ${n} options in one table with cost, fit, pros, cons and a source link, and recommend a top three with a sentence each.`;
        out.outputs = [file];
        out.deliverableFormat = file;
        out.criteria = [A(`${file} has option, cost, pros, cons and source_url`, 'csv_columns(option, cost, pros, cons, source_url)'), A(`At least ${n} options are compared`, `csv_min_rows(${n})`), L('The top three are recommended with a reason each')];
      }
      out.skills = /\bvenue|catering|vendor/i.test(p.phrase) ? ['research', 'event-planning'] : ['research'];
      return out;
    }
    case 'outreach': {
      const target = p.target;
      const file = `outreach_log${suffix}.csv`;
      out.title = titled(cap(p.phrase.replace(/\b\d[\d,]*\b\s*/, '')));
      out.what = `${lead.replace(/\b\d[\d,]*\b\s*/, '')}${range ? ` (${range}${target ? ` of the ${nice(target)}` : ''})` : ''}. Use the message in the conventions file, log every contact and response, and follow up once. Don’t promise anything the brief doesn’t allow.`;
      out.outputs = [file];
      out.deliverableFormat = `${file} with contact, channel, date, response`;
      out.criteria = [A('The log has contact, channel, date and response', 'csv_columns(contact, channel, date, response)'), A('At least 3 contacts per commitment sought are logged', `csv_min_rows(${Math.max(5, b.count * 3)})`), L('Every contact got the approved message and one follow-up')];
      out.skills = ['outreach', 'copywriting'];
      out.tier = 1;
      out.sensitive = ['contact details'];
      return out;
    }
    case 'schedule': {
      const file = `${fileBase(p.phrase, 2) || 'schedule'}.csv`;
      out.title = cap(p.phrase);
      out.what = `${lead}${a.primary.scale ? ` for about ${nice(a.primary.scale.n)} ${a.primary.scale.noun}` : ''}: one row per item with time, item, owner and notes, from setup to wrap-up, using the venue and vendor details from upstream tiles where they exist.`;
      out.outputs = [file];
      out.deliverableFormat = `${file} with time, item, owner, notes`;
      out.criteria = [A('The schedule has time, item, owner and notes', 'csv_columns(time, item, owner, notes)'), A('At least 10 items are scheduled', 'csv_min_rows(10)'), L('Every item has an owner and there are no gaps or overlaps')];
      out.skills = ['event-planning', 'project-management'];
      return out;
    }
    case 'media': {
      const file = `${keyBase(p).replace(/-/g, '_')}${suffix}.md`;
      const isEdit = /\bedit|\bmix|\bmaster/i.test(p.phrase);
      const isRecord = /\brecord|\binterview|\bfilm|\bshoot|\bnarrat/i.test(p.phrase);
      out.title = titled(cap(p.phrase.replace(/\beach (episode|video|lesson)\b/i, 'the $1').replace(/\s+the (episode|video)$/i, '')));
      out.what = isEdit
        ? `Edit ${range || 'the recording'} to the running time and audio specs in the format guide: cut, level, remove noise, add the intro and outro. Upload the finished file to the shared drive and deliver a link, the final running time and a list of cuts.`
        : isRecord
          ? `${lead.replace(/\beach (episode|video)\b/i, range || 'the $1')}: book the time, record following the outline, and upload the raw files. Deliver a link, the recording length, and time-stamped notes on the best moments.`
          : `${lead}${range ? ` for ${range}` : ''}. Deliver a link to the files and notes on what was done.`;
      out.outputs = [file];
      out.deliverableFormat = `${file} with a link to the files`;
      out.criteria = [A('The delivery note links to the files', 'contains("http")'), A('The note states the running time', 'contains("minutes")'), L(isEdit ? 'The edit meets the format guide (length, levels, intro and outro)' : 'The notes are time-stamped and specific'), P(isEdit ? 'The audio is clean and easy to follow' : 'The recording is usable for editing')];
      out.skills = /video|film|shoot/i.test(`${p.phrase} ${a.title}`) ? ['video-editing'] : ['audio-editing'];
      if (isRecord) out.skills = ['audio-editing', 'research'];
      return out;
    }
    case 'teach': {
      const isQuiz = /\bquiz|\bworksheet|\bassessment|\bquestions?\b/i.test(p.phrase);
      const lessonNo = range;
      if (isQuiz) {
        const file = `quiz${suffix}.csv`;
        out.title = titled('Write the quizzes');
        out.what = `Write a quiz for ${lessonNo || 'the lesson'}: 5 to 8 multiple-choice questions tied to its objectives, each with the right answer, two plausible wrong answers and a one-line explanation.`;
        out.outputs = [file];
        out.deliverableFormat = `${file} with question, correct_answer, option_b, option_c, explanation`;
        out.criteria = [A('The quiz has question, correct_answer, option_b, option_c and explanation', 'csv_columns(question, correct_answer, option_b, option_c, explanation)'), A('At least 5 questions per lesson', `csv_min_rows(${5 * Math.max(1, b.count)})`), L('Every question tests a stated objective of its lesson')];
        out.skills = ['instructional-design'];
        return out;
      }
      const file = `lesson${suffix}.md`;
      out.title = titled(/\blessons?\b/i.test(p.phrase) ? 'Write the lesson' : cap(p.phrase));
      out.what = `Write ${lessonNo || 'the lesson'}${a.audiences[0] ? ` for ${a.audiences[0]}` : ''} using the lesson template: objectives, a hook, the explanation with examples, an activity and a recap. Aim for about 45 minutes of teaching time.`;
      out.outputs = [file];
      out.deliverableFormat = file;
      out.criteria = withTone([A('The lesson has an Objectives section', 'has_heading("Objectives")'), A('The lesson is 600 to 1,800 words', `word_count(${600 * Math.max(1, b.count)}, ${1800 * Math.max(1, b.count)})`), L('Every activity serves a stated objective')]);
      out.skills = ['instructional-design', 'technical-writing'];
      return out;
    }
    case 'finance': {
      let file = `${fileBase(p.phrase, 2) || 'finance'}${suffix}.csv`;
      out.title = titled(cap(p.phrase.replace(/\b12 months of\b/i, '').replace(/^\s+/, '')).replace(/^Transactions categorized/i, 'Categorize transactions'));
      if (/\bcategori|\btransactions?\b/i.test(p.phrase)) {
        out.what = `Categorize every transaction ${range ? `in ${range}` : ''} using the chart of accounts and rules. Flag anything that fits no rule as UNSURE with a note.`;
        out.outputs = [file];
        out.deliverableFormat = `${file} with date, description, amount, category`;
        out.criteria = [A('The file has date, description, amount and category', 'csv_columns(date, description, amount, category)'), A('Every transaction has a category', 'csv_no_blank(category)'), L('Categories follow the chart of accounts')];
      } else if (/\brecommend/i.test(p.phrase)) {
        const core = p.phrase.replace(/,?\s+each\b.*$/i, '');
        const n = /\bup to (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(core);
        const max = n ? ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[n[1].toLowerCase()] || Number(n[1])) : null;
        const budget = /\b((?:the |our )?[\w-]+ budget)\b/i.exec(p.phrase)?.[1];
        out.title = `Write ${core.replace(/^(?:a|an|the)\s+/i, '').replace(/^[A-Z]/, (c) => c.toLowerCase())} with rough costs`;
        out.keepTitle = true;
        file = `recommendations${suffix}.csv`;
        out.what = `${cap(p.phrase)}. Base each recommendation on the findings in the upstream files and cite the finding it answers. Give each a rough cost as quantity × unit rate = total, say where each rate comes from, and show that the total fits ${budget ? budget.replace(/^(?:the|our)\s+/i, 'the ') : 'the budget the requester named'}.`;
        out.outputs = [file, 'recommendations.md'];
        out.deliverableFormat = `${file} with recommendation, finding, cost, basis plus recommendations.md`;
        out.criteria = [A('The table has recommendation, finding, cost and basis', 'csv_columns(recommendation, finding, cost, basis)'), ...(max ? [A(`No more than ${max} recommendations`, `csv_max_rows(${max})`)] : []), L('Each recommendation follows from a finding it cites'), L(`Each cost shows its arithmetic and the basis for its rate${budget ? ', and the total fits the budget' : ''}`)];
        out.skills = ['research', 'excel'];
        return out;
      } else if (/\breconcil/i.test(p.phrase)) {
        out.what = `Reconcile each bank account ${range ? `for ${range}` : 'month by month'} against its statements: match every transaction, list unmatched items and explain each difference.`;
        out.outputs = [file];
        out.deliverableFormat = `${file} with account, month, statement_balance, book_balance, difference`;
        out.criteria = [A('The file has account, month, statement_balance, book_balance and difference', 'csv_columns(account, month, statement_balance, book_balance, difference)'), L('Every non-zero difference is explained')];
      } else {
        out.what = `${lead}${a.audiences[0] ? ` for ${a.audiences[0]}` : ''}: the table and a one-page note explaining the main lines in plain words.`;
        out.outputs = [file, `${fileBase(p.phrase, 2)}_note.md`];
        out.deliverableFormat = `${file} plus a one-page note`;
        out.criteria = [A('The table is a CSV with line and amount', 'csv_columns(line, amount)'), A('The note is 150 to 600 words', 'word_count(150, 600)'), L('Totals add up and match the upstream files')];
      }
      out.skills = ['bookkeeping', 'excel'];
      return out;
    }
    case 'transcribe': {
      const file = `transcript${suffix}.md`;
      const hours = /^hour-media/.test(p.axis || '') ? b.count : 1;
      out.title = titled('Transcribe the recordings');
      out.what = `Transcribe ${range || 'the recordings'} verbatim (clean verbatim is fine: drop “um” and false starts), label speakers, and add a timestamp at least every two minutes.${p.details?.length ? ` Also: ${p.details.join('; ').toLowerCase()}.` : ''} Mark unclear words as [inaudible 12:34].`;
      out.outputs = [file];
      out.deliverableFormat = file;
      out.criteria = [A('The transcript is Markdown', 'file_ext(md)'), A('The transcript is a plausible length for the audio', `word_count(${Math.round(hours * 4000)}, ${Math.round(hours * 11000)})`), A('Timestamps are included', 'contains("[")'), L('Speakers are labeled consistently')];
      out.skills = ['transcription'];
      out.tier = 1;
      return out;
    }
    case 'catalog': {
      const file = `catalog${suffix}.csv`;
      out.title = titled(cap(p.phrase));
      out.what = `${lead}${range ? ` (${range})` : ''}: one row per item with a short description, category, condition, estimated value and photo file name.`;
      out.outputs = [file];
      out.deliverableFormat = `${file} with item_id, name, description, category, estimated_value, photo_file`;
      out.criteria = [A('The catalog has item_id, name, description, category, estimated_value and photo_file', 'csv_columns(item_id, name, description, category, estimated_value, photo_file)'), A('Each item appears once', 'csv_unique(item_id)'), L('Descriptions are specific enough to identify the item')];
      out.skills = ['data-entry'];
      out.tier = 1;
      return out;
    }
    case 'test': {
      out.title = p.role === 'check' ? cap(p.phrase) : titled(cap(p.phrase));
      const bulk = p.id === 'spot-check';
      out.what = bulk
        ? `Check a random 5% of rows from every batch file against the batch spec. Record each check with pass or fail and send failing batches back with specific notes.`
        : `${lead}. Check ${a.formats.includes('phone') || frame === 'software' ? 'on an iPhone and an Android phone at 320px and up, ' : ''}${a.formats.includes('accessible') ? 'with a screen reader and keyboard only, against WCAG 2.2 AA, ' : ''}and in two desktop browsers. Write qa_report.md with a "Findings" section: each issue, where it is, severity and the fix.`;
      out.outputs = [bulk ? 'spot_check.md' : 'qa_report.md'];
      out.deliverableFormat = out.outputs[0];
      out.criteria = [A('The report has a Findings section', 'contains("Findings")'), L('Every issue names where it is and how to fix it')];
      if (a.formats.includes('accessible')) out.criteria.push(L('Each accessibility issue cites the WCAG criterion'));
      out.skills = a.formats.includes('accessible') ? ['accessibility', 'qa-review'] : ['qa-review', 'testing'];
      return out;
    }
    case 'legal': {
      out.title = cap(p.phrase);
      out.what = `${lead}. Deliver legal_review.md: each issue found, the clause or rule it concerns, the risk in plain words and a suggested change. This is research for the requester’s lawyer, not legal advice.`;
      out.outputs = ['legal_review.md'];
      out.deliverableFormat = 'legal_review.md';
      out.criteria = [A('The review has an Issues section', 'has_heading("Issues")'), L('Each issue cites the clause or rule')];
      out.skills = ['legal-research'];
      out.tier = 3;
      return out;
    }
    default: {
      out.title = titled(cap(p.phrase));
      out.what = `${lead}${range ? ` (${range})` : ''}.`;
      out.outputs = [`${fileBase(p.phrase, 2) || 'work'}${suffix}.md`];
      out.deliverableFormat = out.outputs[0];
      out.criteria = [A('The deliverable is Markdown', 'file_ext(md)'), L('It does everything the spec asks')];
      return out;
    }
  }
}

function audienceFor(a) {
  const x = a.audiences[0];
  if (!x) return 'for the requester’s audience';
  return /^(?:the|our)\b/.test(x) || /s$/.test(x) || /\b(?:people|youth|staff|public)$/.test(x) ? `for ${x}` : `for the ${x}`;
}

function estimateWords(p, b) {
  const per = { page: 300, question: 60, post: 400, section: 500, slide: 40, word: 1, document: 1500, lesson: 1200, chapter: 4000, episode: 1200, item: 40, listing: 60, response: 60, record: 20, email: 250, recipe: 250, screen: 150, minute: 130 }[p.qty?.unit] || 400;
  return Math.max(60, Math.round((p.qty ? b.count : 1) * per));
}

function columnFor(p) {
  const ph = p.phrase.toLowerCase();
  if (/\btitles?\b/.test(ph)) return ['title_fixed'];
  if (/\bsizes?\b/.test(ph)) return ['size'];
  if (/\bdescriptions?\b/.test(ph)) return ['description'];
  if (/\bprices?\b/.test(ph)) return ['price'];
  if (/\bcolou?rs?\b/.test(ph)) return ['color'];
  if (/\baddress/.test(ph)) return ['address_clean'];
  if (/\bnames?\b/.test(ph)) return ['name_clean'];
  if (/\bemails?\b/.test(ph)) return ['email_clean'];
  if (/\bdates?\b/.test(ph)) return ['date_clean'];
  if (/\bphotos?|images?\b/.test(ph)) return ['photo_file'];
  if (/\btags?\b|\bkeywords?\b/.test(ph)) return ['tags'];
  const w = words(ph).filter((x) => !STOP.has(x) && x.length > 2).pop() || 'value';
  return [`${singularWord(w)}_new`.replace(/[^a-z_]/g, '')];
}

function collectColumns(a, idCol, p) {
  const t = `${a.text} ${p.phrase}`.toLowerCase();
  const cols = [idCol];
  if (/\b(monthly|trend|over time|years?|months?|dates?|since|weekly|daily)\b/.test(t)) cols.push('date');
  const by = /\bby ([a-z]+) type\b/.exec(t);
  if (by) cols.push(`${by[1]}_type`); else if (/\b(type|category|kind)\b/.test(t)) cols.push('category');
  if (GEO.test(t)) cols.push('address', 'zip');
  if (/\b(amount|cost|price|spending|revenue|value|response time)\b/.test(t)) cols.push('value');
  if (cols.length < 3) cols.push('source_url');
  return [...new Set(cols)];
}

/** @param {any} p @param {any} b @param {any} ctx @param {any} out @param {any} o */
function writeContent(p, b, ctx, out, o) {
  const { range, suffix, titled, withTone, aud } = o;
  const { a } = ctx;
  const ph = p.phrase.toLowerCase();
  const base = fileBase(p.phrase.replace(/^write (?:the |a |an )?/i, ''), 2) || 'text';
  const file = `${base}${suffix}.md`;
  const n = Math.max(1, b.count || 1);
  let min = 400;
  let max = 900;
  let heading = null;
  let skills = ['technical-writing'];
  if (/show notes|description/.test(ph)) { min = 150 * n; max = 450 * n; skills = ['copywriting']; }
  else if (/email|newsletter/.test(ph)) { min = 120 * n; max = 400 * n; skills = ['copywriting']; }
  else if (/social|post|caption|tweet/.test(ph)) { min = 25 * n; max = 120 * n; skills = ['copywriting']; }
  else if (/letters? of|support letter/.test(ph)) { min = 180 * (p.qty?.n || 3); max = 450 * (p.qty?.n || 3); skills = ['grant-writing', 'copywriting']; }
  else if (/summary of each|summaries|one-paragraph/.test(ph)) { min = 60 * n; max = 220 * n; skills = ['technical-writing']; }
  else if (METHODOLOGY.test(ph)) { min = 400; max = 800; heading = 'Sources'; skills = ['technical-writing', 'methodology']; }
  else if (REPORTISH.test(ph)) { min = 500; max = 1400; heading = /recommend|go\/no-go/.test(ph) ? 'Recommendation' : /themes/.test(ph) ? 'Themes' : 'Findings'; }
  else if (/copy|hours|what to bring|how to|about|faq/.test(ph)) { min = 120; max = 700; skills = ['copywriting']; }
  else if (/guide|handbook|manual/.test(ph)) { min = 800; max = 2000; skills = ['technical-writing', 'instructional-design']; }
  else if (/descriptions?/.test(ph) && p.qty) { min = 25 * n; max = 90 * n; skills = ['copywriting']; }
  if (a.frame === 'document' && /\b(grant|proposal|application)\b/i.test(a.title)) skills = ['grant-writing', 'technical-writing'];
  if (p.skills) skills = p.skills;
  // "A 2-page report", "a 900-word post": the length the requester asked for sets the word range.
  if (p.qty?.kind === 'length' && ['page', 'word'].includes(p.qty.unit) && !/\b(book|story|stories|manuscript|script|poem)\b/i.test(ph)) {
    // Split by page or word, a tile writes its share; split by asset, it writes that length for each asset it holds.
    const split = /^(?:page|word)-/.test(p.axis || '');
    const target = (p.qty.unit === 'page' ? 450 : 1) * (split ? n : p.qty.n) * (/^asset-/.test(p.axis || '') ? n : 1);
    min = Math.round((target * 0.6) / 10) * 10;
    max = Math.round((target * 1.3) / 10) * 10;
  }
  if (p.words) { min = Math.round(p.words * 0.7); max = Math.round(p.words * 1.4); }
  if (p.sectionName) heading = p.sectionName;
  // Text in another language has its headings in that language too.
  if (p.lang) heading = null;
  const bulkRows = p.qty && ['items'].includes(p.qty.kind) && a.frame === 'bulk';
  if (bulkRows) {
    const idCol = ctx.idCol;
    const col = columnFor(p)[0];
    const csv = `${fileBase(p.phrase, 1)}${suffix}.csv`;
    out.title = titled(cap(p.phrase));
    out.what = `${cap(p.phrase)} for ${range || 'the rows'}${p.subset ? ' (only the ones missing it)' : ''}: 40 to 90 words each, in the voice and format the batch spec sets. Deliver only ${idCol} and ${col}; other tiles own the other columns.`;
    out.outputs = [csv];
    out.deliverableFormat = `${csv} with ${idCol}, ${col}`;
    out.criteria = withTone([A(`The file has ${idCol} and ${col}`, `csv_columns(${idCol}, ${col})`), A(`No ${col} is blank`, `csv_no_blank(${col})`), A(`Each row appears once`, `csv_unique(${idCol})`), L('Each description is accurate to the product data and follows the batch spec')]);
    out.skills = ['copywriting', 'data-entry'];
    return out;
  }
  out.title = titled(cap(p.phrase.replace(/^(?!write|draft)/i, 'Write ').replace(/^Write (?:a |an )/i, 'Write the ')));
  if (out.title.length > 78) out.title = `${out.title.slice(0, 75)}…`;
  const parts = p.folded ? ` Cover each of: ${p.folded.map((f) => f.toLowerCase()).join('; ')}.` : '';
  const kids = ctx.pieces.filter((x) => x.parent === p.id);
  // The parts the requester listed for the document, shared out when it is written page by page.
  const per = p.details?.length ? Math.ceil(p.details.length / Math.max(1, b.of)) : 0;
  const mine = p.details?.length ? (b.of > 1 && /^page-/.test(p.axis || '') ? p.details.slice((b.index - 1) * per, b.index * per) : p.details) : [];
  const covers = mine.length ? ` Cover: ${mine.map((d) => lowerFirst(d.replace(/[.]$/, ''))).join('; ')}.` : '';
  const inLang = p.lang ? ` Write it in ${lang(p.lang)}${/\bsummary|version\b/i.test(ph) ? ', from the final upstream text' : ''}.` : '';
  const vp = verbPhrase(p).replace(/\s+for (?:our|the) \w+$/i, '');
  const ownAudience = /\bfor (?:our |the |local )?[a-z-]+s\b/i.test(vp);
  out.what = `${vp}${range ? ` (${range})` : ''}${ownAudience ? '' : ` ${aud}`}, following the shared conventions.${inLang}${parts}${covers}${kids.length ? ` Bring in ${kids.map((k) => lowerFirst(shortPhrase(k.phrase))).join(' and ')} from the upstream tiles.` : ''}${REPORTISH.test(ph) ? ' Every number and claim must come from an upstream file; cite which.' : ''}`;
  out.outputs = [file];
  out.deliverableFormat = `${file} (${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')} words)`;
  out.criteria = [A(`The text is ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')} words`, `word_count(${min}, ${max})`)];
  if (heading) out.criteria.push(A(`It has a ${heading} section`, `has_heading("${heading}")`));
  out.criteria.push(L(REPORTISH.test(ph) ? 'Every number and claim traces to an upstream file' : 'It covers everything the outline assigns to it'));
  if (mine.length) out.criteria.push(L(`It covers ${mine.map((d) => lowerFirst(d.replace(/[.]$/, ''))).join('; ')}`.slice(0, 200)));
  if (p.lang) out.criteria.push(L(`It reads as natural ${lang(p.lang)} for its audience`));
  out.criteria = withTone(out.criteria);
  out.skills = p.lang ? [...skills.slice(0, 1), `translation-${p.lang}`] : skills;
  if (p.lang) out.languages = [a.languages.source || 'en', p.lang];
  return out;
}

/** @param {any} p @param {any} b @param {any} ctx @param {any} out @param {any} o */
function literatureContent(p, b, ctx, out, o) {
  const { range, suffix } = o;
  const ph = p.phrase.toLowerCase();
  if (/screen/.test(ph)) {
    const file = `screened${suffix}.csv`;
    out.title = `Screen candidate papers${range ? `: ${range}` : ''}`;
    out.what = `Screen ${range || 'the candidate papers'} in candidates.csv against the inclusion criteria in the protocol, by title and abstract. Give each a decision (include or exclude) and a one-line reason.`;
    out.outputs = [file];
    out.deliverableFormat = `${file} with id, decision, reason`;
    out.criteria = [A('The file has id, decision and reason', 'csv_columns(id, decision, reason)'), A('Every paper has a decision', 'csv_no_blank(decision)'), A('Every paper in the range is screened', `csv_min_rows(${Math.max(1, b.count)})`), L('Reasons cite the specific inclusion criterion')];
    out.skills = ['literature-review'];
    out.tier = 2;
    out.keepTitle = true;
    return out;
  }
  if (/extract|table/.test(ph)) {
    const file = `extraction${suffix}.csv`;
    out.title = `Extract study details${range ? `: ${range}` : ''}`;
    out.what = `For ${range || 'each included paper'}, record the design, sample, setting and main finding exactly as the paper reports them.`;
    out.outputs = [file];
    out.deliverableFormat = `${file} with id, design, sample, setting, finding`;
    out.criteria = [A('The file has id, design, sample, setting and finding', 'csv_columns(id, design, sample, setting, finding)'), A('Every paper in the range has a row', `csv_min_rows(${Math.max(1, b.count)})`), L('Findings are stated as the paper states them, without overreach')];
    out.skills = ['literature-review', 'research'];
    out.tier = 3;
    out.keepTitle = true;
    return out;
  }
  const file = `synthesis${suffix}.md`;
  out.title = 'Write the synthesis of findings';
  out.what = 'Using the extraction table, write the synthesis grouped by theme, with in-text citations by paper id and a References section.';
  out.outputs = [file];
  out.deliverableFormat = file;
  out.criteria = [A('The synthesis is 600 to 1,500 words', 'word_count(600, 1500)'), A('It has a References section', 'has_heading("References")'), L('Every claim cites at least one included paper')];
  out.skills = ['technical-writing', 'literature-review'];
  out.tier = 3;
  out.keepTitle = true;
  return out;
}

function conventionsContent(p, ctx, out) {
  const { a } = ctx;
  const frame = a.frame;
  const idCol = ctx.idCol;
  out.title = cap(p.title || p.phrase);
  const intro = `Your file is the contract every other tile works from: it fixes ${p.fixes}. Write it so a stranger could do their piece from it alone.`;
  switch (frame) {
    case 'translation': {
      const t = p.lang;
      out.title = `Build the ${lang(t)} glossary`;
      out.what = `${intro} Read the source and list the 10 or more terms that must be translated the same way everywhere (program names, form labels, legal terms), with the ${lang(t)} term and a note. Add three lines on tone${a.audiences[0] ? ` for ${a.audiences[0]}` : ''}.`;
      out.outputs = [`glossary_${t}.csv`];
      out.deliverableFormat = `glossary_${t}.csv with term_en, term_${t}, note`;
      out.criteria = [A(`The glossary has term_en, term_${t} and note`, `csv_columns(term_en, term_${t}, note)`), A('At least 10 terms are listed', 'csv_min_rows(10)'), L(`Terms use plain, widely understood ${lang(t)}`)];
      out.skills = [`translation-${t}`, 'copywriting'];
      out.languages = [a.languages.source || 'en', t];
      return out;
    }
    case 'coding':
      out.what = `${intro} Read a sample of about 60 ${a.primary.items?.noun || 'responses'}${a.sensitive.redact ? ' from the redacted file' : ''} and draft 8 to 15 codes, each with a label, a definition that says what it excludes, and one short anonymized example. Include OTHER.`;
      out.outputs = ['codebook.csv'];
      out.deliverableFormat = 'codebook.csv with code, label, definition, example';
      out.criteria = [A('codebook.csv has code, label, definition and example', 'csv_columns(code, label, definition, example)'), A('At least 8 codes are defined', 'csv_min_rows(8)'), L('Codes are distinct and each definition says what is excluded')];
      out.skills = ['survey-coding', 'methodology'];
      out.tier = 3;
      return out;
    case 'literature':
      out.what = `${intro} Define databases, search strings, date range and inclusion criteria specific enough that two screeners would agree, then run the searches and list every candidate.`;
      out.outputs = ['protocol.md', 'candidates.csv'];
      out.deliverableFormat = 'protocol.md plus candidates.csv';
      out.criteria = [A('candidates.csv has id, title, year, source and url', 'csv_columns(id, title, year, source, url)'), A('At least 40 candidate papers were found', 'csv_min_rows(40)'), A('The protocol has an Inclusion criteria section', 'has_heading("Inclusion")'), L('Inclusion criteria are specific enough for two screeners to agree')];
      out.skills = ['literature-review', 'research'];
      out.tier = 3;
      return out;
    case 'bulk': {
      const ops = ctx.pieces.filter((x) => x.role === 'work' && x.qty);
      out.what = `${intro} Check the attached ${a.primary.items?.noun || 'file'} (row count, id column, blanks), then write the rules each operation follows (${ops.map((o) => o.phrase.toLowerCase()).join('; ')}), with three before/after examples each. Name the id column (${idCol}) and which output columns each operation owns, and list the batch ranges.`;
      out.outputs = ['batch_spec.md'];
      out.deliverableFormat = 'batch_spec.md';
      out.criteria = [A('The spec has a Rules section', 'has_heading("Rules")'), A('The spec names the id column', `contains("${idCol}")`), A('The spec is 300 to 1,500 words', 'word_count(300, 1500)'), L('Every operation has rules and before/after examples')];
      out.skills = ['data-cleaning', 'excel'];
      return out;
    }
    case 'software':
      out.what = `${intro} Define the data model and every endpoint the features need (method, path, request, response, errors), and the states of each screen. Front end and back end will be built in parallel from this file alone.`;
      out.outputs = ['api_contract.md', 'data_model.json'];
      out.deliverableFormat = 'api_contract.md plus data_model.json';
      out.criteria = [A('The data model is valid JSON', 'json_valid()'), A('The contract has an Endpoints section', 'has_heading("Endpoints")'), L('Every feature in the job maps to endpoints and screens'), L('Each endpoint lists its errors')];
      out.skills = ['javascript', 'sql'];
      out.tier = 3;
      return out;
    case 'dataproduct': case 'web':
      out.what = `${intro} ${frame === 'dataproduct' ? 'List every column the data tiles produce with its type and meaning, and' : 'Lay out the page sections in order with a line on each, and'} set colors (colorblind-safe), fonts and spacing in style.json.`;
      out.outputs = ['conventions.md', 'style.json'];
      out.deliverableFormat = 'conventions.md plus style.json';
      out.criteria = [A('style.json lists colors and fonts', 'json_keys(colors, fonts)'), A('The conventions file is 200 to 900 words', 'word_count(200, 900)'), L(frame === 'dataproduct' ? 'Every column is defined with its unit' : 'Every section has a purpose line')];
      out.skills = frame === 'dataproduct' ? ['data-viz', 'methodology'] : ['ux-design', 'copywriting'];
      return out;
    case 'event':
      out.what = `${intro} Confirm the date options, headcount${a.primary.scale ? ` (${nice(a.primary.scale.n)})` : ''}, budget ceiling per line, theme, colors and fonts, accessibility needs, and who approves each decision.`;
      out.outputs = ['event_brief.md'];
      out.deliverableFormat = 'event_brief.md';
      out.criteria = [A('The brief has a Budget section', 'has_heading("Budget")'), A('The brief is 250 to 900 words', 'word_count(250, 900)'), L('Every other tile can find its constraints here')];
      out.skills = ['event-planning', 'project-management'];
      return out;
    case 'campaign':
      out.what = `${intro} Set the audiences, the three key messages, the calls to action, voice, brand colors and fonts, send dates and tracking links.`;
      out.outputs = ['message_brief.md'];
      out.deliverableFormat = 'message_brief.md';
      out.criteria = [A('The brief has a Messages section', 'has_heading("Messages")'), A('The brief is 250 to 900 words', 'word_count(250, 900)'), L('Each audience has a message and a call to action')];
      out.skills = ['copywriting', 'outreach'];
      return out;
    case 'finance':
      out.what = `${intro} List the accounts and categories and write a rule for each common transaction (payee pattern → category), plus how to flag anything uncertain.`;
      out.outputs = ['chart_of_accounts.csv'];
      out.deliverableFormat = 'chart_of_accounts.csv with account, category, rule';
      out.criteria = [A('The chart has account, category and rule', 'csv_columns(account, category, rule)'), A('At least 12 accounts are listed', 'csv_min_rows(12)'), L('Rules are specific enough that two people categorize the same way')];
      out.skills = ['bookkeeping', 'excel'];
      return out;
    case 'course':
      out.what = `${intro} Write each lesson’s objectives and the template every lesson, slide deck and quiz follows (sections, length, reading level, file names).`;
      out.outputs = ['course_outline.md'];
      out.deliverableFormat = 'course_outline.md';
      out.criteria = [A('The outline has an Objectives section', 'has_heading("Objectives")'), A('The outline is 400 to 1,500 words', 'word_count(400, 1500)'), L('Every lesson has measurable objectives')];
      out.skills = ['instructional-design'];
      return out;
    case 'media':
      out.what = `${intro} Give each episode a topic, angle and possible guests, and set the running time, audio specs, intro and outro, and file naming.`;
      out.outputs = ['season_outline.md'];
      out.deliverableFormat = 'season_outline.md';
      out.criteria = [A('The outline has a Format section', 'has_heading("Format")'), A('The outline is 400 to 1,500 words', 'word_count(400, 1500)'), L('Every episode has a topic and possible guests')];
      out.skills = ['audio-editing', 'research'];
      return out;
    default:
      out.what = a.vague
        ? `${intro} Talk the goal through with the requester’s notes and write scope.md: what “done” looks like, and two or three parts that separate people can do at the same time, each with its inputs, outputs and a size in hours. Name them Part A, Part B and Part C.`
        : `${intro} Write the outline of the whole deliverable (each part’s purpose, length and key points), plus voice, terms, file names and formats.`;
      out.outputs = [a.vague ? 'scope.md' : 'outline.md'];
      out.deliverableFormat = out.outputs[0];
      out.criteria = [A(`The ${a.vague ? 'scope' : 'outline'} is 250 to 1,000 words`, 'word_count(250, 1000)'), A('It has a Parts section', 'has_heading("Parts")'), L(a.vague ? 'Each part has inputs, outputs and a size, and the parts can be done independently' : 'Each part has a purpose, a length and key points')];
      out.skills = a.frame === 'document' && /\b(grant|proposal)\b/i.test(a.title) ? ['grant-writing', 'technical-writing'] : ['technical-writing', 'research'];
      return out;
  }
}

function integrationContent(p, ctx, out) {
  const { a } = ctx;
  const frame = a.frame;
  out.title = cap(p.phrase);
  const reqs = a.requirements.filter((r) => ['format', 'quality', 'timing', 'language', 'tone'].includes(r.kind));
  const coversLine = reqs.length ? ` The final result must meet: ${reqs.map((r) => r.text.replace(/\.$/, '')).join('; ')}.` : '';
  const covers = reqs.map((r) => L(`Covers: ${r.text.replace(/\.$/, '')}`)).slice(0, 4);
  const common = 'Combine the upstream files as they are, fix only seams between them, and write a short handoff note listing every file and who made it.';
  switch (frame) {
    case 'translation': {
      const print = a.formats.includes('print') || a.formats.includes('pdf');
      out.what = `Apply the proofreaders’ fixes and lay out the final ${a.languages.targets.map(lang).join(' and ') || ''} version${a.languages.targets.length > 1 ? 's' : ''} so ${a.languages.targets.length > 1 ? 'they match' : 'it matches'} the original’s structure${print ? ', ready to print' : ''}. ${common}${coversLine}`;
      out.outputs = [`final_${(a.languages.targets[0] || 'es')}.md`, 'handoff.md'];
      out.deliverableFormat = `final version as Markdown or HTML${print ? ' (print-ready)' : ''} plus handoff.md`;
      out.criteria = [A('The final version is Markdown or HTML', 'file_ext(md|html)'), L('The layout keeps the original structure and applies the proofreading fixes'), ...covers];
      out.skills = ['copywriting', ...a.languages.targets.slice(0, 1).map((t) => `translation-${t}`)];
      out.languages = [a.languages.source || 'en', ...a.languages.targets];
      return out;
    }
    case 'coding': {
      const merged = a.namedFiles?.find((f) => /\.csv$/i.test(f.name))?.name || 'coded_all.csv';
      const named = codedColumns(a, ctx.idCol);
      const cols = [ctx.idCol, ...named.carry, named.code || 'code'];
      const parts = ['the codebook', 'the agreement results', ...ctx.pieces.filter((x) => x.role === 'work' && x.archetype === 'write').map((x) => lowerFirst(shortPhrase(x.phrase).replace(/^(?:write|draft)\s+/i, '').replace(/^(?:a|an)\s+/i, 'the ')))];
      out.what = `Merge the coded batches into ${merged}${named.carry.length || named.code ? ` with ${cols.join(', ')}` : ''} and combine ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} into report.md with a Codebook section. ${common}`;
      out.outputs = ['report.md', merged];
      out.deliverableFormat = `report.md plus ${merged}`;
      out.criteria = [A('The report includes the codebook', 'contains("Codebook")'), A(`The merged file has ${cols.join(', ')}`, `csv_columns(${cols.join(', ')})`), ...(a.primary.items?.n ? [A(`All ${nice(a.primary.items.n)} rows are merged`, `csv_min_rows(${a.primary.items.n})`)] : []), L('The report reads as one document, not pasted pieces')];
      out.skills = ['project-integration', 'editing'];
      return out;
    }
    case 'literature':
      out.what = `Combine the protocol, a PRISMA-style count of papers found, screened and included, the synthesis and the reference list into review.md. ${common}`;
      out.outputs = ['review.md'];
      out.deliverableFormat = 'review.md';
      out.criteria = [A('The review has a References section', 'has_heading("References")'), L('Counts of screened and included papers are consistent'), ...covers];
      out.skills = ['editing', 'project-integration'];
      return out;
    case 'bulk': {
      const cols = ctx.pieces.filter((x) => x.role === 'work' && x.qty).map((x) => columnFor(x)[0]);
      out.what = `Join every batch file on ${ctx.idCol} into one final file with the original columns plus ${cols.join(', ')}. Report rows changed per operation and anything missing. ${common}`;
      out.outputs = ['final.csv', 'change_log.md'];
      out.deliverableFormat = 'final.csv plus change_log.md';
      out.criteria = [A(`final.csv has ${[ctx.idCol, ...cols].join(', ')}`, `csv_columns(${[ctx.idCol, ...cols].join(', ')})`), A(`Each ${ctx.idCol} appears once`, `csv_unique(${ctx.idCol})`), ...(a.primary.items?.n ? [A(`All ${nice(a.primary.items.n)} rows are present`, `csv_min_rows(${a.primary.items.n})`)] : []), L('The change log counts changes per operation')];
      out.skills = ['data-cleaning', 'project-integration'];
      return out;
    }
    case 'dataproduct': case 'web':
      out.what = `Apply every fix from the test report to the page, check that every upstream piece is included, and publish it (or hand over the folder with instructions). ${common}${coversLine}`;
      out.outputs = ['index.html', 'changelog.md'];
      out.deliverableFormat = 'index.html plus changelog.md';
      out.criteria = [A('The final page is HTML', 'file_ext(html)'), ...(frame === 'dataproduct' ? [A('The page links or includes the methodology', 'contains("Methodology")')] : []), L('Every test finding is fixed or explained in the changelog'), ...covers];
      out.skills = ['web-dev', 'project-integration'];
      out.tier = 3;
      return out;
    case 'software':
      out.what = `Merge the feature branches, wire the screens to the real API, fix what the test report found, and produce a test build with release notes. ${common}`;
      out.outputs = ['release_notes.md', 'app.js'];
      out.deliverableFormat = 'release_notes.md plus the merged code';
      out.criteria = [A('Release notes are included', 'has_heading("Release notes")'), A('Code is included', 'file_ext(js|ts)'), L('Every feature in the job works end to end in the build'), ...covers];
      out.skills = ['javascript', 'mobile-dev', 'project-integration'];
      out.tier = 3;
      return out;
    default: {
      const name = { media: 'release_checklist.md', course: 'course_package.md', event: 'event_binder.md', campaign: 'campaign_kit.md', finance: 'financial_package.md', document: 'final_document.md' }[frame] || 'final.md';
      out.what = `${frame === 'document' ? 'Assemble the sections in the outline’s order into one document with a table of contents, consistent headings and one reference list.' : 'Put every upstream piece in one place, in order, with a checklist of what is ready and what the requester still has to do.'} ${common}${coversLine}`;
      out.outputs = [name, 'handoff.md'];
      out.deliverableFormat = `${name} plus handoff.md`;
      out.criteria = [A('The package is Markdown', 'file_ext(md)'), A('It lists every file with who made it', 'contains("handoff")'), L('It reads as one deliverable, not pasted pieces'), ...covers];
      out.skills = frame === 'event' ? ['event-planning', 'project-integration'] : ['editing', 'project-integration'];
      return out;
    }
  }
}

/* ---------------------------------------------------------------- naming */

const VERB_FOR = { write: 'Write', design: 'Design', finance: 'Prepare', research: 'Research', collect: 'Compile', analyze: 'Build', web: 'Build', software: 'Build', schedule: 'Plan', outreach: 'Run', teach: 'Write', media: 'Produce', visualize: 'Design', test: 'Test', clean: 'Clean', code: 'Code', catalog: 'Catalog', legal: 'Review', edit: 'Edit', translate: 'Translate', transcribe: 'Transcribe', enrich: 'Fill in', migrate: 'Migrate' };
const ACRONYMS = /\b(faq|qr|api|ui|ux|p&l|kpi|seo|pdf|csv|sms|stem|us)\b/gi;

/** The phrase without its audience or purpose tail and without the count of assets: "8 lessons" → "lessons". */
function shortPhrase(phrase) {
  let t = phrase.replace(/\s+(?:for|to) the ones .*$|\s+that (?:have|lack|are missing) .*$|\s+(?:where|if) (?:needed|missing).*$/i, '')
    .replace(/\s+to (?:create|see|find|show|help|let|make|get|track|manage|allow|keep|sign)\b.*$/i, '');
  t = t.replace(/\s+(?:to find|to show|so that|so|in order to|that will|for (?:our|the|your) (?:board|committee|council|city council|policy committee|staff|funders?|donors?|members?|volunteers|families|teens|students))\b.*$/i, '');
  if (t.length > 60) t = t.replace(/(?<!^up)\s+(?:for|to|that|which|with|from)\s+.*$/i, '').replace(/,\s*each\b.*$/i, '');
  return t.replace(/^\d[\d,]*\s+/, '').replace(/\s+/g, ' ').trim();
}

const lowerFirst = (s) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const acr = (s) => s.replace(ACRONYMS, (m) => m.toUpperCase());

function verbPhrase(p) {
  if (p.folded) return `Write the ${p.frameWeb ? 'page ' : ''}copy: ${p.folded.length} short sections`;
  if (p.side) {
    const feat = shortPhrase(p.phrase.replace(/:\s*(?:API|screens)$/i, '')).replace(/^(?:a|an|the)\s+/i, '');
    return acr(`${p.side === 'api' ? 'Back end' : 'Screens'}: ${lowerFirst(feat)}`);
  }
  const sp = shortPhrase(p.phrase);
  const lead = leadVerbOf(sp);
  const verb = p.verb && /^[a-z]+(?: up| in| out)?$/.test(p.verb) && !/^(?:a|an|the)$/.test(p.verb) ? cap(p.verb) : VERB_FOR[p.archetype] || 'Do';
  const obj = lowerFirst(sp.replace(/^(?:a|an|the|our|some|its|their|your)\s+/i, ''));
  let vp = lead ? cap(sp).replace(/^(\S+(?: up| in| out)?) (?:a|an) /i, '$1 the ') : `${verb} ${/^(?:every|each|all|both|up to)\b/i.test(obj) ? '' : 'the '}${obj}`;
  // A bare topic in a document is a section: "Safety" → "Write the safety section".
  if (!lead && p.archetype === 'write' && p.ctxFrame === 'document' && words(sp).length <= 3 && !ARCHETYPES.write.nouns.test(sp.toLowerCase())) vp += ' section';
  if (p.archetype === 'visualize' && !/\b(chart|map|graph|plot|table|infographic|dashboard)s?\b/i.test(vp)) vp += ' chart';
  return acr(vp);
}

function assetLabel(p, b) {
  const noun = (p.unitNoun || 'items').split(' ').pop();
  const one = singularWord(noun);
  const many = /s$/.test(noun) ? noun : `${noun}s`;
  return b.from === b.to ? `${one} ${b.from}` : `${many} ${b.from}–${b.to}`;
}

/** A work tile's title: "Edit episode 3", "Design the slides for lesson 2", "Fix titles: listings 1–128". */
function titleFor(p, b) {
  if (p.title) return p.title;
  const perAsset = /^asset-/.test(p.axis || '');
  const vp = verbPhrase(p);
  if (perAsset) {
    const lab = assetLabel(p, b);
    const assetWord = singularWord((p.unitNoun || '').split(' ').pop() || 'item');
    const eachRe = new RegExp(`\\beach (?:${assetWord}|${assetWord}s)\\b|\\bthe ${assetWord}s?\\b`, 'i');
    if (eachRe.test(vp)) return vp.replace(eachRe, lab);
    if (p.assetUnit) {
      // "Write 8 lessons" → "Write lesson 3"; "Write 8 social media posts" → "Write social media posts 1–3".
      const obj = shortPhrase(p.phrase).replace(/^(?:[a-z]+\s+)?/i, (m) => (leadVerbOf(m) ? '' : m)).replace(/^(?:the|a|an)\s+/i, '').replace(/^(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s+/i, '');
      const verb = leadVerbOf(shortPhrase(p.phrase)) ? cap(leadVerbOf(shortPhrase(p.phrase))) : VERB_FOR[p.archetype] || 'Do';
      const adj = obj.split(' ').slice(0, -1).join(' ');
      return acr(`${verb} ${adj ? `${adj} ` : ''}${lab}`);
    }
    return `${vp} for ${lab}`;
  }
  const range = rangeText(p, b);
  if (!range) return vp;
  // "Illustrate page 3 of the picture book".
  const docNoun = /^page-/.test(p.axis || '') && /\b(picture book|book|handbook|report|guide|manual|brochure|magazine|document|catalog|zine)\b/i.exec(p.phrase);
  if (docNoun) return `${vp.split(' ')[0]} ${range} of the ${docNoun[1].toLowerCase()}`;
  if (/^hour-media/.test(p.axis || '')) {
    if (p.archetype === 'transcribe') return `Transcribe ${range}`;
    return `${vp.replace(/\s+(?:of|for) (?:each|every|the) \w+$/i, '')} (${range})`;
  }
  // "Recruit 30 volunteers" + "volunteers 1–5" → "Recruit volunteers 1–5".
  const v = vp.replace(/\b\d[\d,]*\s+(?:[a-z]+\s+)?(?:of\s+)?/i, (m) => (/\bof\s+$/.test(m) ? '' : m.replace(/^\d[\d,]*\s+/, '')));
  const rangeNoun = range.split(' ')[0];
  const tail = new RegExp(`\\b(?:every |each |all |the )?${singularWord(rangeNoun)}s?$`, 'i');
  if (tail.test(v)) return `${v.replace(tail, '').trim()} ${range}`;
  // "Code every response with one or more themes" → "Code comments 1–45 with one or more themes".
  const unitNames = [singularWord(rangeNoun), p.qty?.unit].filter((x) => x && /^[a-z-]+$/i.test(x));
  const every = unitNames.length ? new RegExp(`\\b(?:every|each|all(?: the)?|the) (?:${unitNames.join('|')})s?\\b`, 'i') : null;
  if (every?.test(v)) return v.replace(every, range);
  return `${v}: ${range}`;
}

function keyBase(p) {
  if (p.role === 'conventions') return p.lang ? `glossary-${p.lang}` : 'conventions';
  if (p.role === 'integrate') return 'integrate';
  if (p.role === 'check' && p.archetype === 'code') return 'agreement-check';
  if (p.side) return kebab(`${p.side === 'api' ? 'api' : 'screens'}-${words(shortPhrase(p.phrase.replace(/:\s*(?:API|screens)$/i, ''))).filter((w) => !STOP.has(w)).slice(-2).join('-')}`);
  if (/\bscreen/i.test(p.phrase) && p.archetype === 'research') return 'screen-papers';
  if (/\bextract/i.test(p.phrase) && p.archetype === 'research') return 'extract-studies';
  if (/\bsynthes/i.test(p.phrase) && p.archetype === 'research') return 'write-synthesis';
  if (!/^(?:p\d+|d\d+|x\d+)(?:-|$)/.test(p.id)) return p.id.replace(/^p\d+-/, '');
  const full = shortPhrase(p.phrase);
  const objOf = (sp, verb) => words(sp).filter((w) => !STOP.has(w) && !/\d/.test(w) && !/^(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve)-/.test(w) && !w.startsWith(verb.slice(0, 4)));
  const verbOf = (sp) => (leadVerbOf(sp) || VERB_FOR[p.archetype] || 'do').toLowerCase().split(' ')[0];
  // "Code every response with one or more themes" is keyed by what it works on, not the "with" tail.
  const bare = full.replace(/\s+with\s+.*$/i, '');
  const sp = objOf(bare, verbOf(bare)).length ? bare : full;
  const verb = verbOf(sp);
  const obj = objOf(sp, verb);
  return kebab(`${verb}-${obj.slice(-2).join('-') || slugOf(p.phrase, 2)}`);
}

function streamLabel(p) {
  if (p.role === 'conventions' || p.role === 'prep') return 'Setup';
  if (p.role === 'integrate') return 'Assembly';
  if (p.role === 'layer' && p.archetype === 'translate') return 'Translation';
  if (p.role === 'check') return 'Checks';
  const sp = shortPhrase(p.phrase);
  const verb = leadVerbOf(sp);
  const assetWord = /^asset-/.test(p.axis || '') ? singularWord((p.unitNoun || '').split(' ').pop() || '') : '';
  const v = verb ? cap(verb) : VERB_FOR[p.archetype] || 'Work';
  if (p.side) return p.side === 'api' ? 'Back end' : 'Screens';
  const obj = words(sp).slice(verb ? verb.split(' ').length : 0).filter((w) => !STOP.has(w) && !/\d/.test(w) && singularWord(w) !== assetWord && !w.startsWith(v.toLowerCase().slice(0, 4)) && !/^(?:one|two|three|four|five|six|seven|eight|nine|ten)-/.test(w));
  return acr(`${v}${obj.length ? ` ${obj.slice(-2).join(' ')}` : ''}`).slice(0, 28);
}

/* ---------------------------------------------------------------- emit */

function kebab(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, ''); }

/**
 * Builds tile drafts for a read job.
 * @param {ReturnType<import('./analyze.js').analyzeJob>} a
 */
export function buildTiles(a) {
  const pieces = planPieces(a);
  sizeAll(pieces, a);
  foldSmall(pieces);
  let deps = wirePieces(pieces, a);
  // One report that already gathers everything is the final deliverable; a separate assembly adds nothing.
  const integ = pieces.find((p) => p.role === 'integrate');
  const sinks = integ ? deps.get(integ.id) : [];
  if (integ && sinks.length === 1 && !['translation', 'coding', 'bulk', 'dataproduct', 'web', 'software', 'literature'].includes(a.frame)) {
    const last = pieces.find((p) => p.id === sinks[0]);
    if (last && last.archetype === 'write' && REPORTISH.test(last.phrase) && last.batches.length === 1) {
      last.covers.push(...integ.covers);
      pieces.splice(pieces.indexOf(integ), 1);
      deps = new Map([...deps].filter(([k]) => k !== integ.id));
    }
  }
  const itemNoun = a.primary.items?.noun;
  const namedId = (a.namedFiles || []).flatMap((f) => f.columns).find((c) => /_id$/.test(c));
  const idCol = namedId || (itemNoun ? idColumn(itemNoun) : /\bfilings\b/i.test(a.text) ? 'filing_id' : /\bcases?\b/i.test(a.text) ? 'case_id' : 'record_id');
  const ctx = { a, pieces, idCol };

  // Pieces in dependency order.
  const order = [];
  const seen = new Set();
  const visit = (id, guard = new Set()) => {
    if (seen.has(id) || guard.has(id)) return;
    guard.add(id);
    for (const d of deps.get(id) || []) visit(d, guard);
    seen.add(id);
    order.push(id);
  };
  for (const p of pieces) visit(p.id);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const tilesOf = new Map();
  const keys = new Set();
  const tiles = [];
  for (const id of order) {
    const p = byId.get(id);
    const list = [];
    for (const b of p.batches) {
      const c = contentFor(p, b, ctx);
      if (p.role === 'work' && !c.keepTitle) c.title = titleFor(p, b);
      else if (b.of > 1 && !c.title.includes(':')) c.title = `${c.title}: ${rangeText(p, b)}`;
      let key = kebab(`${keyBase(p)}${b.of > 1 ? `-${String(b.index).padStart(2, '0')}` : ''}`) || `tile-${tiles.length + 1}`;
      if (p.lang && p.role !== 'conventions' && !key.split('-').includes(p.lang)) key = kebab(`${key}-${p.lang}`);
      let k = key;
      let n = 2;
      while (keys.has(k)) k = `${key}-${n++}`;
      keys.add(k);
      // Inputs: what the upstream tiles deliver (only the aligned ones for per-asset and batch work).
      const up = [];
      for (const d of deps.get(p.id) || []) {
        const dp = byId.get(d);
        const dt = tilesOf.get(d) || [];
        const aligned = dp.axis && p.axis && dp.axis === p.axis && dp.batches.length > 1 && p.batches.length > 1;
        for (const t of dt) {
          if (aligned && (t.part.to < b.from || t.part.from > b.to)) continue;
          up.push(t);
        }
      }
      const inputs = [...new Set(up.flatMap((t) => t.outputs))];
      if (!up.some((t) => !['conventions'].includes(t.phase)) && a.provided && ['clean', 'enrich', 'code', 'translate', 'transcribe', 'catalog', 'migrate', 'finance'].includes(p.archetype) && p.role !== 'conventions' && !a.sensitive.redact) inputs.unshift('the source file the requester attached');
      if (p.role === 'prep' || (p.role === 'conventions' && !pieces.some((x) => x.role === 'prep') && ['translation', 'coding', 'bulk', 'finance'].includes(a.frame))) inputs.unshift('the source file the requester attached');
      const spec = specText(p, b, c, inputs, up, ctx);
      const criteria = c.criteria.map((x, i) => ({ id: `c${i + 1}`, text: x.text.slice(0, 200), check: x.check, ...(x.rule ? { rule: x.rule } : {}) }));
      const minutes = b.minutes;
      const skills = [...new Set(c.skills)].slice(0, 3);
      const tier = Math.min(4, Math.max(c.tier, ...skills.map((s) => SKILL_TIER_FLOOR[s] || 1)));
      const tile = {
        key: k, kind: p.role === 'integrate' ? 'INTEGRATION' : p.kind || 'WORK', title: c.title.length > 80 ? `${c.title.slice(0, 77)}…` : c.title,
        spec, deliverableFormat: c.deliverableFormat, acceptanceCriteria: criteria, skillTags: skills, tier, estMinutes: minutes,
        dependsOn: [...new Set(up.map((t) => t.key))], sensitiveInputs: c.sensitive || [], languages: c.languages || [],
        inputs, outputs: c.outputs, stream: streamLabel(p), piece: p.id, partOf: p.batches.length > 1 ? p.id : null,
        part: p.batches.length > 1 ? { index: b.index, of: b.of, from: b.from, to: b.to, label: rangeText(p, b) } : null,
        covers: [...new Set(p.covers)], priority: p.priority || 1, archetype: p.archetype, phase: p.role === 'work' ? 'work' : p.role === 'prep' ? 'prep' : p.role === 'conventions' ? 'conventions' : p.role === 'integrate' ? 'integrate' : p.role,
        assumed: !!p.assumed,
      };
      if (!tile.part) tile.part = { index: b.index, of: b.of, from: b.from, to: b.to, label: '' };
      list.push(tile);
      tiles.push(tile);
    }
    tilesOf.set(id, list);
  }
  // The final assembly works from every file made upstream, not just the last step's.
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  for (const t of tiles.filter((x) => x.kind === 'INTEGRATION')) {
    const seen = new Set();
    const walk = (k) => { for (const d of byKey.get(k)?.dependsOn || []) if (!seen.has(d)) { seen.add(d); walk(d); } };
    walk(t.key);
    t.inputs = [...new Set([...tiles.filter((x) => seen.has(x.key)).flatMap((x) => x.outputs)])];
    t.spec = t.spec.replace(/You receive: [^\n]*/, `You receive: every file made upstream (${t.inputs.length} files, listed with each tile).`);
  }
  // Every file name is made by exactly one tile; a renamed file is renamed for its readers too.
  const owner = new Map();
  for (const t of tiles) {
    t.outputs = t.outputs.map((f) => {
      if (!owner.has(f)) { owner.set(f, t.key); return f; }
      const renamed = `${t.key.replace(/-/g, '_')}_${f}`;
      owner.set(renamed, t.key);
      t.deliverableFormat = t.deliverableFormat.split(f).join(renamed);
      const first = owner.get(f);
      for (const r of tiles) {
        if (!r.dependsOn.includes(t.key) || !r.inputs.includes(f)) continue;
        if (!r.dependsOn.includes(first)) r.inputs = r.inputs.map((x) => (x === f ? renamed : x));
        else r.inputs.push(renamed);
      }
      return renamed;
    });
  }
  return { pieces, tiles };
}

function specText(p, b, c, inputs, up, ctx) {
  const { a } = ctx;
  const goal = a.goal.length > 420 ? `${a.goal.slice(0, 417)}…` : a.goal;
  const conv = up.filter((t) => t.phase === 'conventions').flatMap((t) => t.outputs);
  const siblings = p.batches.length > 1 ? ` Other people are doing the other ${p.batches.length - 1} part${p.batches.length > 2 ? 's' : ''} of this at the same time, so stay inside your range.` : '';
  const lines = [
    `Context: this tile is one piece of "${a.title}". The requester's goal: ${goal}`,
    `Your piece: ${c.what}${siblings}`,
    inputs.length ? `You receive: ${inputs.join('; ')}.` : 'You receive: the goal above and any files the requester attached. Nothing from other tiles.',
    `You deliver: ${c.deliverableFormat}.`,
  ];
  if (conv.length && p.role !== 'conventions') lines.push(`Shared conventions: follow ${conv.join(' and ')} for terms, formats and file names, so your work fits the other pieces without edits.`);
  if (p.role !== 'integrate') lines.push(`Stay inside your piece: ${scopeLine(p, ctx)}`);
  if (p.physical || /\b(scan|photograph)\b/i.test(p.phrase)) lines.push('On site: this tile needs the physical items. Take it only if you can get to them or they are sent to you.');
  if (a.sensitive.yes && p.role !== 'prep') lines.push(a.sensitive.redact ? 'Privacy: work only from de-identified files. If you see personal details, stop and flag the row.' : 'Privacy: the inputs may include personal details. Use them only for this tile and keep them out of your deliverable.');
  return lines.join('\n\n');
}

function scopeLine(p, ctx) {
  const others = ctx.pieces.filter((x) => x !== p && x.role === 'work').slice(0, 4).map((x) => x.phrase.toLowerCase());
  if (p.role === 'conventions') return 'set the rules and don’t do the other pieces’ work; they start as soon as your file is accepted.';
  if (p.role === 'check') return 'report and fix what you find in the files you receive; don’t redo other tiles’ work.';
  if (p.role === 'prep') return 'only de-identify. Keep every row and don’t analyze or change anything else.';
  return others.length ? `other tiles handle ${others.join('; ')}${ctx.pieces.filter((x) => x.role === 'work').length > 5 ? ' and more' : ''}. Leave those alone and deliver only your files.` : 'deliver only the files listed.';
}

export { FRAME_LABELS, TILE_OVERHEAD };
