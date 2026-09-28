// Adapting a plan for an agent swarm. Agents can write, code, analyze what they're given,
// design in SVG, translate and review, but they can't record audio, make calls, visit a
// place, touch paper or reach the live web. Tiles that need a person in the real world are
// turned into the preparation an agent can do (scripts, guides, kits, collection scripts),
// each with a handoff saying exactly what a person must still do. Repetitive real-world
// batches (twenty hours of transcription, six rounds of outreach) collapse into one kit.
// When agents may use the web, tiles that need outside facts (research, prices, venues,
// funders, public data) get a research step first and cite their sources instead of
// handing every fact to a person to check.
import { dropTile } from './ops.js';

const kit = (heads) => heads.map((h) => ({ check: 'AUTO', text: `The kit has a ${h} section`, rule: `has_heading("${h}")` }));

/** Real-world steps an agent prepares for, in the order they're tested. */
export const HUMAN_STEPS = [
  {
    kind: 'interview', test: /\binterview\w*\b/i, collapse: false,
    title: (rest) => `Write the interview guide${rest}`,
    deliver: 'an interview guide: who to invite and why, a short invitation message, 10 to 15 questions in order with follow-ups, and logistics',
    heads: ['Questions', 'Invitation'], handoff: 'A person invites the guest and records the interview using this guide.',
  },
  {
    kind: 'record', test: /\b(record|film|shoot|narrat(?:e|es|ed|ing|ion|or)|voice ?over|host)\b/i, collapse: false,
    title: (rest) => `Write the script and run sheet${rest}`,
    deliver: 'a full script with timings, a run sheet (segments, lengths, cues), and a recording checklist',
    heads: ['Script', 'Run sheet'], handoff: 'A person records it from the script and run sheet, then uploads the raw files.',
  },
  {
    kind: 'avedit', test: /\b(edit (?:the )?(?:episode|video|audio|footage|recording)s?|edit episode|edit video|mix|master)\b|^edit\b.*\b(episode|video)/i, collapse: true,
    title: () => 'Write the editing guide',
    deliver: 'an editing guide for every item in the range: target length, structure, intro and outro, music and level notes, and what to cut',
    heads: ['Structure', 'Checklist'], handoff: 'A person edits the audio or video following the guide.',
  },
  {
    kind: 'transcribe', test: /\btranscri\w+/i, collapse: true,
    title: () => 'Write the transcription guide and template',
    deliver: 'a transcription guide (verbatim rules, speaker labels, timestamps, how to mark unclear words) and a transcript template',
    heads: ['Rules', 'Template'], handoff: 'A person (or a speech-to-text service) transcribes the recordings using the guide and template.',
  },
  {
    kind: 'outreach', test: /\b(recruit|contact|call (?:the|each|every|our|them|people|donors|members|guests|volunteers|parents|vendors|businesses)|phone (?:bank|calls?)|cold[- ]call|email (?:the|each|our)|send (?:the )?(?:emails?|messages?|letters?|invitations?|invites|survey)|solicit|field the survey|collect responses|door|canvass|book (?:the |a )?(?:referees|speakers|venue|caterer|guests?)|reach out)\b/i, collapse: true, archetypes: ['outreach'],
    title: (rest) => `Draft the outreach kit${rest}`,
    deliver: 'an outreach kit: who to contact and where to find them, the first message and a follow-up, a call script, and a tracking sheet template',
    heads: ['Messages', 'Call script'], handoff: 'A person sends the messages or makes the calls and logs each reply in the tracking sheet.',
    extraFiles: [{ name: 'tracking.csv', rule: 'csv_columns(contact, channel, date, response)', text: 'The tracking sheet has contact, channel, date and response' }],
  },
  {
    kind: 'physical', test: /\b(scan|photograph|pick up|drop off|deliver the|install|set up (?:tables|chairs|the room)|on site|in person|print (?:and|the) (?:mail|post))\b/i, collapse: true,
    title: () => 'Write the on-site guide',
    deliver: 'a step-by-step guide for the physical work: equipment, setup, naming and file conventions, quality checks, and a log template',
    heads: ['Steps', 'Quality checks'], handoff: 'A person does the physical work following the guide.',
  },
];

/** Steps agents can do but whose facts or results a person should confirm, in the order they're tested. */
const VERIFY = [
  { kind: 'person', test: /\bpublish\b|\bship a test build\b|\bdeploy\b/i, handoff: 'A person uploads the final files to the site or app store.' },
  { kind: 'facts', test: /\b(venues?|catering|price quotes?|prices?|vendors?|competitors?|foundations?|funders?|suppliers?|shortlist|options|candidates)\b|\b(?:get|request|collect|compare) (?:\w+ ){0,2}quotes?\b/i, handoff: 'A person confirms every entry marked (verify): names, prices, availability and links.' },
  { kind: 'person', test: /\b(test|audit|qa)\b.*\b(phone|screen reader|browser|site|app|page|dashboard)\b|\bon phones\b/i, handoff: 'A person checks the result on a real phone and with a screen reader; the agent reviewed the code.' },
];

/** Tiles that need facts from outside the job's own files, whatever the job came with. */
const OUTSIDE_FACTS = /\b(literature|evidence base|benchmark|best practices?|statistics|data sources?|regulations?|laws?|legal|policy|policies|market|competitors?|prices?|pricing|costs?|budget|rates?|venues?|vendors?|suppliers?|caterers?|catering|funders?|foundations?|grants?)\b/i;
/** Research words that point outside only when the job brought no material of its own ("Research the main findings" is about the job's data). */
const LOOK_UP = /\b(research|find|identify|look up|compare|sources|quotes)\b/i;
/** Tiles whose numbers a reader will act on: every figure needs its basis. */
const NUMBERS = /\b(recommend\w*|costs?|budget|estimates?|pric(?:e|es|ing)|forecast|projection)\b/i;
/** Tiles that check other tiles' work. */
const CHECKS = /\b(agreement|consistency|inter-?rater|double[- ]cod\w*|second coder|spot[- ]check\w*|cross[- ]check\w*|quality check|qa|fact[- ]check\w*|verify the|audit the)\b/i;

const LIVE_DATA = /\b(collect|scrape|pull|download|compile)\b.*\b(data|records|filings|counts|calendar|portal|public)\b|\bfoot traffic\b|\bfrom (?:the )?public\b/i;
const DATA_FILE = /\.(csv|tsv|geojson|xlsx)$/i;
/** A tile that computes from data files made upstream isn't collecting live data ("Collect theme counts" from coded_all.csv). */
const readsData = (t) => (t.inputs || []).some((f) => DATA_FILE.test(f));

function stepFor(t) {
  if (t.kind === 'INTEGRATION' || t.phase === 'conventions') return null;
  const text = `${t.title} ${t.archetype || ''}`;
  for (const s of HUMAN_STEPS) {
    if (s.archetypes && s.archetypes.includes(t.archetype)) return s;
    if (s.test.test(t.title)) return s;
  }
  if (/\bmedia\b/.test(text) && /\bedit\b/i.test(t.title)) return HUMAN_STEPS.find((s) => s.kind === 'avedit');
  return null;
}

function restOf(title) {
  const m = /\b(for|:)\s*(.+)$/i.exec(title);
  if (m) return ` for ${m[2]}`;
  const item = /\b((?:episode|lesson|video|post|hour|interview|chapter|session)s?\s+\d[\d–-]*)\b/i.exec(title);
  if (item) return ` for ${item[1]}`;
  const who = /^(?:book|recruit|contact|call|invite)\s+(?:the\s+)?(.{3,40})$/i.exec(title.trim());
  return who ? ` for ${who[1]}` : '';
}

const SOURCE = /requester|attached/i;

/** Merges a group of tiles into its first one; readers of the others read the first one's output. */
function collapseGroup(tiles, group, renamed) {
  const [first, ...rest] = group;
  for (const r of rest) {
    for (const f of r.outputs) renamed.set(f, first.outputs[0]);
    // Readers of a collapsed tile now wait for the kept one (before the drop rewires them upstream).
    for (const t of tiles) {
      if (t.key === first.key || !t.dependsOn.includes(r.key)) continue;
      t.dependsOn = [...new Set(t.dependsOn.map((d) => (d === r.key ? first.key : d)))];
      t.inputs = [...new Set(t.inputs.map((f) => (r.outputs.includes(f) ? first.outputs[0] : f)))];
    }
    tiles = dropTile(tiles, r.key);
  }
  const keep = tiles.find((t) => t.key === first.key);
  const lastPart = rest[rest.length - 1]?.part;
  keep.collapsed = group.length;
  keep.part = first.part && lastPart ? { ...first.part, to: lastPart.to, index: 1, of: 1, label: `${(first.part.label || '').replace(/[\d,–\s-]+$/, '')} ${first.part.from}–${lastPart.to}`.trim() } : null;
  keep.partOf = null;
  return { tiles, keep };
}

/** A batch tile's title without its range: "Fix titles: listings 1–128" → "Fix titles". */
function baseTitle(title) {
  return title.replace(/\s*[:,(]\s*[^:,(]*\d+\s*[–-]\s*\d+\)?\s*$/, '').replace(/\s+\d+\s*[–-]\s*\d+\s*$/, '').replace(/\s+\d+$/, '').trim() || title;
}

function markSample(t, why) {
  t.acceptanceCriteria = t.acceptanceCriteria.filter((c) => !/^csv_min_rows/.test(c.rule || ''));
  if (!t.acceptanceCriteria.some((c) => /SAMPLE/.test(c.text))) t.acceptanceCriteria.push({ id: 'x', check: 'LLM', text: 'Any rows are clearly labeled SAMPLE, and the notes say how to run the method on the real data' });
  t.acceptanceCriteria = t.acceptanceCriteria.map((c, i) => ({ ...c, id: `c${i + 1}` }));
  t.spec += `\n\nAgent note: ${why}`;
  t.agentMode = 'sample-data';
}

/**
 * Adapts a plan for the agent swarm.
 * @param {any[]} input tiles
 * @param {{ hasSource?: boolean, sourceRows?: number|null, web?: boolean }} [opts] hasSource: the requester attached a
 *   file for the tiles that read one; sourceRows: data rows in the attached table, when there is one; web: agents
 *   may search and read the web
 * @returns {{ tiles: any[], changes: string[], handoffs: { key: string, title: string, handoff: string }[] }}
 */
export function adaptForAgents(input, { hasSource = true, sourceRows = null, web = false } = {}) {
  let tiles = input.map((t) => ({ ...t, dependsOn: [...(t.dependsOn || [])], inputs: [...(t.inputs || [])], outputs: [...(t.outputs || [])], acceptanceCriteria: (t.acceptanceCriteria || []).map((c) => ({ ...c })) }));
  const changes = [];
  const renamed = new Map();
  // Collapse repetitive real-world batches into one kit.
  const groups = new Map();
  for (const t of tiles) {
    const s = stepFor(t);
    if (s && s.collapse) {
      const g = t.partOf || `${s.kind}:${t.stream || t.key}`;
      (groups.get(g) || groups.set(g, { step: s, tiles: [] }).get(g)).tiles.push(t);
    }
  }
  for (const [, g] of groups) {
    if (g.tiles.length < 2) continue;
    tiles = collapseGroup(tiles, g.tiles, renamed).tiles;
    changes.push(`${g.tiles.length} “${g.tiles[0].title.replace(/:.*$/, '')}” tiles need a person; one agent writes a single kit for all of them.`);
  }
  // Row batches are fitted to the attached table: a range past its end is dropped, and the last
  // batch ends where the table does (the job text said "about 120"; the file has 117).
  if (hasSource && sourceRows > 0) {
    // Batches over the table's rows: ones that read it or check a row count, and any other batch
    // counted in the same unit ("listings 1–37" for descriptions, when titles read the listings).
    const unit = (t) => (t.part?.label || '').replace(/[\d,–\s-]+$/, '').trim().toLowerCase();
    const direct = (t) => t.part?.of > 1 && (t.inputs.some((f) => SOURCE.test(f)) || t.acceptanceCriteria.some((c) => /^csv_min_rows/.test(c.rule || '')));
    const units = new Set(tiles.filter(direct).map(unit).filter(Boolean));
    const rowBatch = (t) => t.part?.of > 1 && (direct(t) || units.has(unit(t)));
    const past = tiles.filter((t) => rowBatch(t) && t.part.from > sourceRows);
    for (const t of past) tiles = dropTile(tiles, t.key);
    for (const t of tiles) {
      if (!rowBatch(t) || t.part.to <= sourceRows) continue;
      t.part = { ...t.part, to: sourceRows, label: (t.part.label || '').replace(/[\d,]+$/, String(sourceRows)) };
      const n = t.part.to - t.part.from + 1;
      t.acceptanceCriteria = t.acceptanceCriteria.map((c) => (/^csv_min_rows/.test(c.rule || '') ? { ...c, rule: `csv_min_rows(${n})`, text: c.text.replace(/\d[\d,]*/, String(n)) } : c));
    }
    // Whole-table outputs (the de-identified file, the merged file) can't have more rows than the table.
    for (const t of tiles) {
      t.acceptanceCriteria = t.acceptanceCriteria.map((c) => {
        const m = /^csv_min_rows\((\d+)\)/.exec(c.rule || '');
        return m && Number(m[1]) > sourceRows ? { ...c, rule: `csv_min_rows(${sourceRows})`, text: c.text.replace(/\d[\d,]*/, String(sourceRows)) } : c;
      });
    }
    if (past.length) changes.push(`The attached table has ${sourceRows} rows, so ${past.length} batch${past.length > 1 ? 'es' : ''} past its end ${past.length > 1 ? 'were' : 'was'} dropped.`);
  }
  // Batches of live-data collection become one collection script: without the web, each batch
  // would only write the same script for a different range.
  const live = (t) => !readsData(t) && ((LIVE_DATA.test(t.title) && (!t.archetype || ['collect', 'research', 'enrich'].includes(t.archetype))) || (t.skillTags || []).includes('web-scraping'));
  const liveGroups = new Map();
  for (const t of tiles) if (t.partOf && live(t) && !stepFor(t)) (liveGroups.get(t.partOf) || liveGroups.set(t.partOf, []).get(t.partOf)).push(t);
  for (const [, list] of liveGroups) {
    if (list.length < 2) continue;
    const res = collapseGroup(tiles, list, renamed);
    tiles = res.tiles;
    res.keep.title = baseTitle(res.keep.title).slice(0, 80);
    res.keep.part = null;
    changes.push(`${list.length} “${res.keep.title}” batches need the live web; one agent writes the collection script for all of them.`);
  }
  // With no file attached, a job that works on the requester's material has nothing real to
  // work on: each batch group runs once, on a labeled sample, and says how to run on the real file.
  const noSource = new Set();
  if (!hasSource && tiles.some((t) => t.inputs.some((f) => SOURCE.test(f)))) {
    const batches = new Map();
    for (const t of tiles) if (t.partOf && !stepFor(t)) (batches.get(t.partOf) || batches.set(t.partOf, []).get(t.partOf)).push(t);
    for (const [, list] of batches) {
      // Only parallel batches (same upstream tiles) fold together; a chain of batches keeps its shape.
      const deps = (t) => [...t.dependsOn].sort().join(',');
      if (list.length < 2 || !list.every((t) => deps(t) === deps(list[0]))) continue;
      const res = collapseGroup(tiles, list, renamed);
      tiles = res.tiles;
      res.keep.title = baseTitle(res.keep.title).slice(0, 80);
      res.keep.part = null;
      noSource.add(res.keep.key);
      changes.push(`${list.length} “${res.keep.title}” batches would all work on sample rows (no file was attached), so one agent does it once.`);
    }
    for (const t of tiles) if (t.inputs.some((f) => SOURCE.test(f)) && !stepFor(t)) noSource.add(t.key);
  }
  const handoffs = [];
  for (const t of tiles) {
    const s = stepFor(t);
    if (s) {
      const range = t.part && t.part.label ? ` for ${t.part.label}` : restOf(t.title);
      const title = s.title(range);
      const out = `${t.key.replace(/-/g, '_')}_kit.md`;
      for (const f of t.outputs) renamed.set(f, out);
      const extra = s.extraFiles || [];
      t.title = title.length > 80 ? `${title.slice(0, 77)}…` : title;
      t.spec = `An AI agent does this tile. It can't do the real-world step (${t.title.toLowerCase().includes('outreach') ? 'contacting people' : s.kind === 'record' || s.kind === 'interview' ? 'recording' : s.kind === 'avedit' ? 'editing audio or video' : s.kind === 'transcribe' ? 'listening to recordings' : 'physical work'}), so it prepares ${s.deliver}${t.collapsed ? `, covering all ${t.collapsed} parts of the original work` : ''}. ${s.handoff}\n\nThe original tile, for context:\n\n${t.spec}`;
      t.outputs = [out, ...extra.map((e) => e.name)];
      t.deliverableFormat = `${out}${extra.length ? ` plus ${extra.map((e) => e.name).join(', ')}` : ''}`;
      t.acceptanceCriteria = [
        { check: 'AUTO', text: 'The kit is Markdown', rule: 'file_ext(md)' },
        ...kit(s.heads),
        { check: 'AUTO', text: 'The kit is 250 to 3,000 words', rule: 'word_count(250, 3000)' },
        ...extra.map((e) => ({ check: 'AUTO', text: e.text, rule: e.rule })),
        { check: 'LLM', text: 'A person could do the real-world step from this kit alone' },
      ].map((c, i) => ({ id: `c${i + 1}`, ...c }));
      t.skillTags = [...new Set([...(t.skillTags || []), 'project-management'])].slice(0, 3);
      t.estMinutes = Math.min(120, Math.max(45, t.collapsed ? 90 : 60));
      t.handoff = s.handoff;
      t.agentMode = 'prepare';
      handoffs.push({ key: t.key, title: t.title, handoff: s.handoff });
      continue;
    }
    // Collecting live data: the agent writes the script; any rows it hands in are a labeled sample.
    // With the web, a research step first finds the real source, and rows read from it are real.
    if (live(t)) {
      markSample(t, web
        ? 'the research notes name the real source (portal, dataset, API). Write the collection script against it, hand in the rows you could read from the source with its URL, and label any rows you couldn\u2019t read as SAMPLE. A person runs the script for the full data.'
        : 'without internet access, write the collection script and hand in a small SAMPLE file with the right columns, labeled as sample data. A person runs the script to get the real records.');
      if (web) t.webResearch = true;
      t.handoff = web
        ? 'A person runs the collection script against the source the agent found to pull the full data, then the downstream files can be regenerated from it.'
        : 'A person runs the collection script to pull the real data, then the downstream files can be regenerated from it.';
      handoffs.push({ key: t.key, title: t.title, handoff: t.handoff });
      continue;
    }
    if (noSource.has(t.key)) {
      markSample(t, 'the requester attached no file, so build the method (rules, formulas, scripts, templates) and apply it to a small SAMPLE with the right columns, labeled as sample data.');
      t.handoff = 'A person runs this step on the real file (or attaches it and runs the job again).';
      handoffs.push({ key: t.key, title: t.title, handoff: t.handoff });
      continue;
    }
    // Work on the job's own data (coding, cleaning, filling in columns) stays offline, and so do
    // batches unless their title names outside facts ("Research foundations 1–6").
    const ownData = t.inputs.some((f) => SOURCE.test(f)) || (t.part?.of > 1 && readsData(t));
    const v = VERIFY.find((x) => x.test.test(t.title));
    if (v && v.kind === 'facts' && web && !ownData) {
      // With the web, facts are looked up and cited; only what couldn't be confirmed is marked.
      t.webResearch = true;
      t.agentMode = 'researched';
      if (!t.acceptanceCriteria.some((c) => /\(verify\)/.test(c.text))) t.acceptanceCriteria.push({ id: 'x', check: 'LLM', text: 'Every name, price and fact cites a source URL from the research; anything not confirmed is marked (verify)' });
    } else if (v) {
      t.handoff = v.handoff;
      t.agentMode = 'verify';
      if (/\(verify\)/.test(v.handoff) && !t.acceptanceCriteria.some((c) => /verify/i.test(c.text))) {
        t.acceptanceCriteria.push({ id: 'x', check: 'LLM', text: 'Facts that couldn’t be checked are marked (verify)' });
      }
      handoffs.push({ key: t.key, title: t.title, handoff: v.handoff });
    }
    // Other tiles that need outside facts get a research step when agents may use the web.
    const aboutOutside = OUTSIDE_FACTS.test(t.title)
      || (!hasSource && !readsData(t) && (LOOK_UP.test(t.title) || (!(t.part?.of > 1) && (t.archetype === 'research' || (t.skillTags || []).some((x) => x === 'literature-review' || x === 'legal-research')))));
    if (web && !t.webResearch && !ownData && t.kind !== 'INTEGRATION' && t.phase !== 'conventions' && !CHECKS.test(t.title) && aboutOutside) {
      t.webResearch = true;
    }
    // Numbers a reader acts on (recommendations, costs, budgets) must show where they come from.
    if (t.kind !== 'INTEGRATION' && NUMBERS.test(t.title) && !t.acceptanceCriteria.some((c) => /arithmetic/i.test(c.text))) {
      t.acceptanceCriteria.push({ id: 'x', check: 'LLM', text: 'Every number comes from a named input file or a cited source, each cost shows its arithmetic and the basis for its rate, and each recommendation follows from the findings it cites' });
    }
    // A check of other tiles' work runs on a different model from the work it checks.
    if (CHECKS.test(t.title) || (t.kind === 'REVIEW' && !t.dynamic)) t.independentCheck = true;
    t.acceptanceCriteria = t.acceptanceCriteria.map((c, i) => ({ ...c, id: `c${i + 1}` }));
  }
  // Readers of a renamed file read the kit instead.
  for (const t of tiles) t.inputs = [...new Set(t.inputs.map((f) => renamed.get(f) || f))];
  // Downstream of sample data, row-count checks can't pass and would only loop revisions.
  const sample = new Set(tiles.filter((t) => t.agentMode === 'sample-data').map((t) => t.key));
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tiles) if (!sample.has(t.key) && t.dependsOn.some((d) => sample.has(d))) { sample.add(t.key); grew = true; }
  }
  for (const t of tiles) {
    if (!sample.has(t.key) || t.agentMode === 'sample-data') continue;
    const before = t.acceptanceCriteria.length;
    t.acceptanceCriteria = t.acceptanceCriteria.filter((c) => !/^csv_min_rows/.test(c.rule || ''));
    if (t.acceptanceCriteria.length !== before) t.acceptanceCriteria = t.acceptanceCriteria.map((c, i) => ({ ...c, id: `c${i + 1}` }));
    if (!/SAMPLE/.test(t.spec)) t.spec += '\n\nAgent note: some upstream data is a labeled SAMPLE. Keep the SAMPLE label on anything built from it.';
  }
  if (handoffs.length) changes.push(`${handoffs.length} tile${handoffs.length > 1 ? 's' : ''} end with a step for a person; each says what it is.`);
  const researched = tiles.filter((t) => t.webResearch).length;
  if (researched) changes.push(`${researched} tile${researched > 1 ? 's' : ''} look${researched > 1 ? '' : 's'} up outside facts on the web first and cite ${researched > 1 ? 'their' : 'its'} sources.`);
  const checks = tiles.filter((t) => t.independentCheck).length;
  if (checks) changes.push(`${checks} check${checks > 1 ? 's' : ''} of other tiles' work run${checks > 1 ? '' : 's'} on a different model from the work ${checks > 1 ? 'they check' : 'it checks'}.`);
  return { tiles, changes, handoffs };
}
