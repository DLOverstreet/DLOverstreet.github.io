// The agent swarm. On a job handed to the swarm, AI agents do every step after you submit
// it: the autopilot answers the Scoping agent's questions, adapts the plan for agents and
// funds it; agents take the offers, do each tile with the worker agent, peer-review each
// other where the plan asks for a person's judgment, and revise failed rounds; the autopilot
// signs off the delivery. Agents are contributor accounts marked isAgent, so every claim,
// check, payout and reputation event goes through the same services a person uses.
import { AGENTS, samplePlaceholder, workerFiles } from '../agents/index.js';
import { joinParts } from '../agents/split.js';
import { runAgent } from '../llm/run-agent.js';
import { runCostUsd, modelCaps, estimateTokens } from '../llm/prices.js';
import { adaptForAgents } from '../decompose/agents.js';
import { estimateAgentWork, splitOffer, speedFor, measuredSpeeds, agentSeconds } from '../decompose/agent-time.js';
import { UserError, must, tilesOf } from './core.js';
import { respondToOffer, claimFromBoard, explainFit } from './market.js';
import { submitWork, submitPeerReview, requesterReview, upstreamFiles } from './work.js';
import { acceptDelivery } from './delivery.js';
import { createCompetition, competes } from './competition.js';
import { answerScoping, fundCommission, replacePlan, draftGraph, postCommission } from './commissions.js';
import { loadFileTexts, hasText } from './files.js';
import { config } from '../domain/config.js';
import { runAutoChecks } from '../domain/autochecks.js';
import { redactText, redactCsv } from '../lib/redact.js';
import { parseCsv, toCsv } from '../lib/csv.js';
import { DAY, isTextFile } from '../lib/util.js';

const NAMES = ['Atlas', 'Beacon', 'Cobalt', 'Delta', 'Ember', 'Flint', 'Garnet', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Lumen',
  'Meridian', 'Nova', 'Onyx', 'Pike', 'Quill', 'Rook', 'Sable', 'Tern', 'Umber', 'Vale', 'Wren', 'Zephyr'];
const LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'zh', 'ja', 'ko', 'vi', 'tl', 'hi', 'ar', 'ru', 'pl', 'uk', 'tr', 'fa', 'sw'];

export const agentId = (i) => `usr_agent_${String(i + 1).padStart(2, '0')}`;

/** The swarm's settings: config defaults overlaid with what Settings saved. */
export function swarmSettings(db) {
  return { ...config.swarm, ...(db.meta.settings.swarm || {}) };
}

/** Makes sure the swarm has `size` agent accounts. Agents never appear as personas. */
export function ensureAgents(T, size = swarmSettings(T.db).size) {
  const n = Math.max(2, Math.min(NAMES.length, size));
  if (T.db.filter('User', (u) => u.isAgent).length >= n) return;
  T.db.tx((tx) => {
    for (let i = 0; i < n; i++) {
      const id = agentId(i);
      if (tx.get('User', id)) continue;
      tx.insert('User', {
        id, githubId: null, name: `Agent ${NAMES[i]}`, email: null, org: 'Tessera swarm', persona: false,
        blurb: 'An AI agent in Tessera’s swarm. Works only on jobs handed to the swarm.',
        isRequester: false, isContributor: true, isAdmin: false, isAgent: true,
      });
      tx.insert('ContributorProfile', {
        userId: id, skills: [], anySkill: 4, languages: LANGUAGES, tools: ['text'], timezone: 'UTC',
        availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '00:00', end: '23:59' })),
        weeklyHoursCap: 10000, payFloorCents: 0, llmMode: 'SHARED', briefStyle: 'CONCISE', llm: { provider: 'anthropic' },
      });
    }
  });
}

/**
 * Anthropic's server-side web tools for a research call: the latest versions (dynamic
 * filtering, raw results left out of the response) on models that take them, the basic ones
 * otherwise.
 * @param {string} model
 * @param {{ maxSearchesPerTile: number, maxFetchesPerTile: number }} s
 */
export function webTools(model, s) {
  if (modelCaps(model).webTools) {
    return [
      { type: 'web_search_20260318', name: 'web_search', max_uses: s.maxSearchesPerTile, response_inclusion: 'excluded' },
      { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: s.maxFetchesPerTile, max_content_tokens: 20000, citations: { enabled: true }, response_inclusion: 'excluded' },
    ];
  }
  return [
    { type: 'web_search_20250305', name: 'web_search', max_uses: s.maxSearchesPerTile },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: s.maxFetchesPerTile, max_content_tokens: 20000, citations: { enabled: true } },
  ];
}

/** The attached table's size, for time estimates: its data rows and the average characters per row. */
export function sourceShape(c) {
  const t = (c.files || []).filter((f) => f.summary?.rowCount > 0).sort((a, b) => b.summary.rowCount - a.summary.rowCount)[0];
  return t ? { sourceRows: t.summary.rowCount, charsPerRow: t.size ? Math.round(t.size / (t.summary.rowCount + 1)) : null } : { sourceRows: null, charsPerRow: null };
}

/** Writing speed per model, measured from this browser's own worker runs. */
export function swarmSpeeds(db) {
  return measuredSpeeds(db.filter('AgentRun', (r) => r.agent === 'worker' && !r.error && r.provider !== 'mock'));
}

/** Model spend on a commission, in dollars (zero with the mock). */
export function spentUsd(db, commissionId) {
  return db.filter('AgentRun', (r) => r.commissionId === commissionId).reduce((n, r) => n + runCostUsd(r), 0);
}

// ---------------------------------------------------------------- the worker's input

const NUMBERED = /^(.+?)_(\d+)(?:[-–](\d+))?\.csv$/i;

function csvTable(f) {
  const { columns, rows } = parseCsv(f.text);
  return { name: f.name, columns, rows };
}

function concatTables(list) {
  const order = (f) => f.partIndex ?? Number(NUMBERED.exec(f.name)?.[2] || 0);
  const sorted = [...list].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  const tables = sorted.map(csvTable);
  const columns = [...new Set(tables.flatMap((t) => t.columns))];
  const rows = tables.flatMap((t) => t.rows.map((r) => columns.map((c) => r[t.columns.indexOf(c)] ?? '')));
  return { columns, rows, from: sorted.map((f) => f.name) };
}

/** A tile whose job is to put batch files together (by kind, title or output name). */
export function isMergeTile(tile) {
  return tile.kind === 'INTEGRATION'
    || /\b(merge|combine|compile|consolidate|assemble|stack|join|collate)\b/i.test(tile.title || '')
    || (tile.outputs || []).some((n) => /(^|_)(all|merged|combined|full|final)(_|\.csv$)/i.test(n));
}

/**
 * Batch files merged without a model, so a merge of thousands of rows is exact. Batches are
 * grouped by the plan (files from tiles that share a partOf group, in part order), or by name
 * when the plan doesn't say (coded_01.csv, coded_02.csv). A group is stacked into the CSV output
 * named after it, or into a merge tile's only CSV output; a merge tile's single CSV output built
 * from several groups joins them on their shared id column, onto the attached source file when
 * it has that column.
 * @param {{ kind?: string, title?: string, outputs?: string[], acceptanceCriteria?: any[] }} tile
 * @param {{ name: string, text: string|null, group?: string|null, partIndex?: number }[]} files upstream files with their text
 * @param {{ name: string, text: string|null }[]} [sources] the requester's attached files
 * @returns {{ name: string, text: string, rows: number, from: string[], added?: string[] }[]}
 */
export function mergeBatches(tile, files, sources = []) {
  const csvOut = (tile.outputs || []).filter((n) => /\.csv$/i.test(n));
  if (!csvOut.length) return [];
  const groups = new Map();
  for (const f of files) {
    if (typeof f.text !== 'string' || !/\.csv$/i.test(f.name) || csvOut.includes(f.name)) continue;
    const m = NUMBERED.exec(f.name);
    const g = f.group ? `plan:${f.group}` : m ? m[1] : null;
    if (g) (groups.get(g) || groups.set(g, []).get(g)).push(f);
  }
  const stemOf = (list) => NUMBERED.exec(list[0].name)?.[1] || list[0].name.replace(/\.csv$/i, '');
  const out = [];
  const used = new Set();
  for (const name of csvOut) {
    const stem = name.replace(/\.csv$/i, '').replace(/_(all|merged|combined|full|final)$/i, '');
    const hit = [...groups.entries()].find(([g, list]) => list.length > 1 && !used.has(g) && (g === stem || stemOf(list) === stem));
    if (!hit) continue;
    used.add(hit[0]);
    const t = concatTables(hit[1]);
    out.push({ name, text: toCsv(t.columns, t.rows), rows: t.rows.length, from: t.from, added: t.columns });
  }
  if (out.length || csvOut.length !== 1 || !isMergeTile(tile) || !groups.size) return out;
  if (groups.size === 1) {
    if ([...groups.values()][0].length < 2) return out;
    const t = concatTables([...groups.values()][0]);
    return [{ name: csvOut[0], text: toCsv(t.columns, t.rows), rows: t.rows.length, from: t.from, added: t.columns }];
  }
  const tables = [...groups.values()].map(concatTables);
  const key = tables[0].columns.find((c) => tables.every((t) => t.columns.includes(c)));
  if (!key) return out;
  const base = sources.filter((f) => typeof f.text === 'string' && /\.csv$/i.test(f.name)).map(csvTable).find((t) => t.columns.includes(key));
  // One batch column the tile doesn't ask for, and one asked-for column nobody made: the batch
  // named it differently ("category" for "taxonomy_new"), so it takes the asked-for name.
  const want = wantedColumns(tile.acceptanceCriteria || []);
  if (want.length) {
    const have = new Set([...(base ? base.columns : []), ...tables.flatMap((t) => t.columns)]);
    const missing = want.filter((w) => !have.has(w));
    const odd = [...new Set(tables.flatMap((t) => t.columns.filter((c) => c !== key && !want.includes(c))))];
    if (missing.length === 1 && odd.length === 1) for (const t of tables) t.columns = t.columns.map((c) => (c === odd[0] ? missing[0] : c));
  }
  const columns = [...(base ? base.columns : [key])];
  for (const t of tables) for (const c of t.columns) if (!columns.includes(c)) columns.push(c);
  const byKey = new Map();
  const order = [];
  const row = (k) => { if (!byKey.has(k)) { byKey.set(k, new Map([[key, k]])); order.push(k); } return byKey.get(k); };
  if (base) for (const r of base.rows) { const m = row(r[base.columns.indexOf(key)]); base.columns.forEach((c, j) => m.set(c, r[j] ?? '')); }
  for (const t of tables) {
    const ki = t.columns.indexOf(key);
    for (const r of t.rows) { const m = row(r[ki]); t.columns.forEach((c, j) => { if (c !== key && (r[j] ?? '') !== '') m.set(c, r[j]); }); }
  }
  const rows = order.map((k) => columns.map((c) => byKey.get(k).get(c) ?? ''));
  out.push({ name: csvOut[0], text: toCsv(columns, rows), rows: rows.length, from: [...(base ? [base.name] : []), ...tables.flatMap((t) => t.from)], added: columns.filter((c) => c !== key && !(base && base.columns.includes(c))) });
  return out;
}

/**
 * A merge is handed in as is only if it passes the tile's CSV checks. When exactly one
 * required column is missing and exactly one batch column is unexpected (a batch named it
 * "category" where the tile wants "taxonomy_new"), that column is renamed first.
 * @template {{ name: string, text: string, added?: string[] }} M
 * @param {M} m
 * @param {any[]} criteria
 * @returns {M & { fails: string[] }}
 */
export function settleMerge(m, criteria) {
  const rules = criteria.filter((c) => c.check === 'AUTO' && /^\s*csv_/.test(c.rule || ''));
  const failing = (text) => runAutoChecks(rules, [{ name: m.name, size: text.length, text }]).results.filter((r) => !r.pass);
  let text = m.text;
  let fails = failing(text);
  if (fails.length) {
    const want = wantedColumns(rules);
    const { columns, rows } = parseCsv(text);
    const missing = want.filter((w) => !columns.includes(w));
    const extra = columns.filter((c) => !want.includes(c) && (m.added || []).includes(c));
    if (missing.length === 1 && extra.length === 1) {
      text = toCsv(columns.map((c) => (c === extra[0] ? missing[0] : c)), rows);
      fails = failing(text);
    }
  }
  return { ...m, text, fails: fails.map((f) => `${f.rule}: ${f.reason}`) };
}

/** Every tile upstream of this one, however many layers up. */
function ancestors(db, tileId) {
  const seen = new Set();
  const queue = [tileId];
  while (queue.length) {
    const id = queue.shift();
    for (const e of db.filter('TileEdge', (x) => x.toTileId === id)) if (!seen.has(e.fromTileId)) { seen.add(e.fromTileId); queue.push(e.fromTileId); }
  }
  return seen;
}

/**
 * The files a tile works from: everything its upstream tiles delivered, any file its inputs
 * name that an earlier accepted tile made, and for a merge tile every batch file upstream of
 * it (a model-made plan may wire a merge to the last layer only, or name the batches loosely).
 * Each file carries its maker's batch group and part, so merges follow the plan.
 */
export function inputRefs(db, tile) {
  const out = upstreamFiles(db, tile.id);
  const want = new Set(tile.inputs || []);
  const have = new Set(out.map((f) => f.name));
  const merge = isMergeTile(tile) && (tile.outputs || []).some((n) => /\.csv$/i.test(n));
  const up = merge ? ancestors(db, tile.id) : null;
  const accepted = db.filter('Tile', (x) => x.commissionId === tile.commissionId && !x.dynamic && x.status === 'ACCEPTED' && x.acceptedSubmissionId && x.id !== tile.id);
  for (const t of accepted) {
    const batch = merge && up.has(t.id) && t.partOf;
    for (const f of db.get('Submission', t.acceptedSubmissionId)?.files || []) {
      if (have.has(f.name)) continue;
      if (want.has(f.name) || (batch && /\.csv$/i.test(f.name))) { out.push({ ...f, fromTile: t.key, fromTitle: t.title }); have.add(f.name); }
    }
  }
  const byKey = new Map(accepted.map((t) => [t.key, t]));
  return out.map((f) => {
    const maker = byKey.get(f.fromTile);
    return maker?.partOf ? { ...f, group: maker.partOf, partIndex: maker.part?.index ?? 0 } : f;
  });
}

/** Columns the tile's csv_columns rules ask for. */
function wantedColumns(criteria) {
  return [...new Set(criteria.filter((c) => c.check === 'AUTO').flatMap((c) => /^\s*csv_columns\((.*)\)/.exec(c.rule || '')?.[1].split(',').map((x) => x.trim()) || []))];
}

function clipText(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters not shown)` : text;
}

/** Rows from..to (1-based) of a CSV, with its header, for a batch tile. */
function sliceCsv(text, from, to) {
  const { columns, rows } = parseCsv(text);
  if (!rows.length || to < from || from > rows.length) return null;
  return { text: toCsv(columns, rows.slice(from - 1, to)), total: rows.length };
}

/**
 * Everything a worker agent receives: the job, its tile, the accepted upstream files, the
 * requester's attachments (only this batch's rows for a batch tile), and on a revision the
 * failed checks with the files handed in last time. Merged batch files ride along as
 * precomputedFiles, which never reach the prompt or the log.
 */
export async function workerInput(T, tile) {
  const c = T.db.get('Commission', tile.commissionId);
  const restricted = c.privacy === 'RESTRICTED';
  const s = swarmSettings(T.db);
  const scrub = (name, text) => (restricted ? (/\.(csv|tsv)$/i.test(name) ? redactCsv(text).text : redactText(text)) : text);
  const answers = (c.clarifications?.questions || []).map((q) => ({ question: q.question, answer: c.clarifications.answers?.[q.id] || '' })).filter((x) => x.answer);
  /** @type {any} */
  const input = {
    job: { title: c.title, goal: restricted ? redactText(c.goal) : c.goal, ...(answers.length ? { answers } : {}), privacy: c.privacy },
    tile: {
      key: tile.key, kind: tile.kind, title: tile.title, spec: restricted ? redactText(tile.spec) : tile.spec,
      deliverableFormat: tile.deliverableFormat, outputs: tile.outputs || [],
      acceptanceCriteria: tile.acceptanceCriteria.map((x) => ({ id: x.id, text: x.text, check: x.check, ...(x.rule ? { rule: x.rule } : {}) })),
      ...(tile.part?.of > 1 ? { part: tile.part } : {}), ...(tile.handoff ? { handoff: tile.handoff } : {}), ...(tile.agentMode ? { agentMode: tile.agentMode } : {}),
    },
    inputs: [],
    attachments: [],
  };
  const ups = await loadFileTexts(T, inputRefs(T.db, tile));
  const sources = await loadFileTexts(T, c.files || []);
  const merges = mergeBatches(tile, ups, sources).map((m) => settleMerge(m, tile.acceptanceCriteria));
  // A merge that passes the checks is handed in by the swarm; one that doesn't is a draft the agent fixes.
  const merged = merges.filter((m) => !m.fails.length);
  const drafts = merges.filter((m) => m.fails.length);
  const consumed = new Set([...merged, ...drafts].flatMap((m) => m.from));
  let budget = s.maxInputChars;
  const take = (text) => {
    const room = Math.max(600, Math.min(s.maxFileChars, budget));
    const t = clipText(text, room);
    budget -= t.length;
    return t;
  };
  for (const f of ups) {
    if (typeof f.text !== 'string') { input.inputs.push({ name: f.name, note: 'Binary file, not shown.' }); continue; }
    if (consumed.has(f.name)) {
      const t = csvTable(f);
      const into = [...merged, ...drafts].find((m) => m.from.includes(f.name)).name;
      input.inputs.push({ name: f.name, note: `Already merged into ${into}; ${t.rows.length} rows, columns ${t.columns.join(', ')}.`, sample: toCsv(t.columns, t.rows.slice(0, 3)) });
      continue;
    }
    input.inputs.push({ name: f.name, content: take(restricted ? redactText(f.text) : f.text) });
  }
  for (const f of sources) {
    if (typeof f.text !== 'string') { input.attachments.push({ name: f.name, note: isTextFile(f.name) ? 'Empty.' : 'Binary file with no readable text, not shown.' }); continue; }
    const text = scrub(f.name, f.text);
    // A batch tile (one of several over the file) gets only its own rows.
    const slice = tile.part?.of > 1 && /\.(csv|tsv)$/i.test(f.name) ? sliceCsv(text, tile.part.from, tile.part.to) : null;
    input.attachments.push(slice
      ? { name: f.name, note: `Rows ${tile.part.from}–${Math.min(tile.part.to, slice.total)} of ${slice.total}: your batch.`, content: take(slice.text) }
      : { name: f.name, content: take(text) });
  }
  for (const d of drafts) {
    input.inputs.push({ name: `${d.name} (draft merge)`, note: `The swarm merged ${d.from.length} batch files into this draft, but it fails: ${d.fails.join('; ')}. Fix it and hand it in as ${d.name}.`, content: take(d.text) });
  }
  if (merged.length) {
    input.merged = merged.map((m) => ({ name: m.name, rows: m.rows, from: m.from, note: 'Already assembled by the swarm from the accepted batches. Don’t write this file; hand in the other files.' }));
    Object.defineProperty(input, 'precomputedFiles', { value: merged.map((m) => ({ name: m.name, text: m.text })), enumerable: false });
  }
  // Say what the merge step did, so a skipped merge shows up in the submission notes.
  if (isMergeTile(tile) && (tile.outputs || []).some((n) => /\.csv$/i.test(n))) {
    const report = merged.length
      ? `Merged by code: ${merged.map((m) => `${m.name} (${m.rows} rows from ${m.from.length} files)`).join('; ')}.`
      : drafts.length
        ? `Merged by code into a draft the agent fixed: ${drafts.map((d) => `${d.name} (${d.fails.join('; ')})`).join('; ')}.`
        : `No merge by code: no batch files from the plan were found upstream (${ups.filter((f) => /\.csv$/i.test(f.name)).length} CSV inputs).`;
    Object.defineProperty(input, 'mergeReport', { value: report, enumerable: false });
  }
  if (tile.research) {
    input.research = tile.research.unavailable
      ? { unavailable: tile.research.unavailable }
      : { notes: clipText(tile.research.notes || '', 12000), sources: (tile.research.sources || []).slice(0, 25).map((x, i) => ({ n: i + 1, title: x.title, url: x.url })) };
  }
  const last = tile.lastSubmissionId ? T.db.get('Submission', tile.lastSubmissionId) : null;
  if (tile.status === 'REVISION' && last && last.contributorId === tile.claimedById) {
    const failed = [];
    for (const r of T.db.filter('Review', (x) => x.submissionId === last.id)) {
      for (const v of r.criteria || []) {
        if (v.pass) continue;
        failed.push({ criterionId: v.criterionId, criterion: tile.acceptanceCriteria.find((x) => x.id === v.criterionId)?.text || v.criterionId, reason: v.reason, checkedBy: r.source });
      }
    }
    const prev = await loadFileTexts(T, last.files);
    input.revision = {
      round: last.round, failed,
      previousFiles: prev.filter((f) => typeof f.text === 'string' && !(merged.some((m) => m.name === f.name))).map((f) => ({ name: f.name, content: take(f.text) })),
    };
  }
  return input;
}

/** The rows a tile covers: its batch range, or every row of the table it makes. */
function rowRange(tile, work) {
  return tile.part && (tile.part.of > 1 || tile.part.to > tile.part.from) ? { from: tile.part.from, to: tile.part.to } : work.rows ? { from: 1, to: work.rows } : null;
}

// ---------------------------------------------------------------- the swarm

/**
 * @param {any} T
 * @param {{ paceMs?: number }} [opts] paceMs: with the mock, wait this long per task so the swarm is watchable
 */
export function createSwarm(T, { paceMs = 0 } = {}) {
  const running = new Map();
  const failures = new Map();
  let timer = null;
  let stepping = false;
  /** Set when the key's organization has the web tools switched off; research then stops for this session. */
  let webOff = null;

  /** Whether agents may use the web now: the setting is on and the provider can run Anthropic's web tools (the mock stands in). */
  function webReady() {
    const s = swarmSettings(T.db);
    const route = T.llm.agent(s.workerModel);
    return !!s.web && !webOff && route.providerName !== 'openai-compatible';
  }

  const jobs = () => T.db.filter('Commission', (c) => c.workforce === 'agents' && !['ACCEPTED', 'CANCELLED'].includes(c.status));
  const isAgent = (id) => !!T.db.get('User', id)?.isAgent;
  const paused = (c) => c.autopilot?.state === 'PAUSED';
  const load = (id) => T.db.count('Tile', (t) => t.claimedById === id && ['CLAIMED', 'REVISION', 'SUBMITTED', 'IN_REVIEW'].includes(t.status));

  function note(commissionId, text, patch = {}) {
    T.db.tx((tx) => {
      const c = tx.get('Commission', commissionId);
      tx.update('Commission', commissionId, { autopilot: { ...(c.autopilot || {}), ...patch, note: text, notedAt: tx.now() } });
    });
  }
  function pause(commissionId, why) {
    note(commissionId, why, { state: 'PAUSED' });
  }
  function setActivity(tileId, activity) {
    if (T.db.get('Tile', tileId)) T.db.tx((tx) => tx.update('Tile', tileId, { agentActivity: activity }));
  }
  const pace = () => (paceMs && T.llm.platform('light').providerName === 'mock' ? new Promise((r) => setTimeout(r, paceMs * (0.6 + Math.random() * 0.8))) : null);
  const competition = createCompetition(T, { setActivity, pace });

  // --- synchronous steps: bookkeeping the autopilot and agents do without a model

  /** The plan is ready: adapt it for agents, then fund it. */
  function launch(c) {
    const tiles = draftGraph(T.db, c.id).filter((t) => t.status !== 'CANCELLED');
    const hasSource = (c.files || []).some(hasText);
    const shape = sourceShape(c);
    const s = swarmSettings(T.db);
    const tps = speedFor(s.workerModel, swarmSpeeds(T.db));
    const adapted = adaptForAgents(tiles, {
      hasSource, sourceRows: shape.sourceRows, web: webReady(),
      timing: { ...shape, tps, targetSeconds: s.splitAboveSeconds, maxParts: s.maxParts, split: !!s.split },
    });
    // Saved whenever the plan changed or gained expected agent times, which the Swarm tab shows per tile.
    if (adapted.changes.length || adapted.handoffs.length || adapted.estimate) replacePlan(T, c.requesterId, c.id, adapted.tiles, 'Adapted the plan for the agent swarm');
    fundCommission(T, c.requesterId, c.id, { acceptOverBudget: true });
    const eta = adapted.estimate ? ` Expected time along the longest chain: about ${Math.max(1, Math.round(adapted.estimate.seconds / 60))} min.` : '';
    note(c.id, `The swarm started on ${adapted.tiles.length} tiles.${eta}`, { launchedAt: T.clock.now(), changes: adapted.changes, handoffs: adapted.handoffs, estimate: adapted.estimate || null });
  }

  /** Each tile offered to agents goes to the least busy of them. */
  function takeOffers(c) {
    let n = 0;
    const byTile = new Map();
    for (const o of T.db.filter('Offer', (x) => x.commissionId === c.id && x.response === 'PENDING' && isAgent(x.contributorId))) {
      (byTile.get(o.tileId) || byTile.set(o.tileId, []).get(o.tileId)).push(o);
    }
    for (const [, offers] of byTile) {
      const o = offers.sort((a, b) => load(a.contributorId) - load(b.contributorId) || a.contributorId.localeCompare(b.contributorId))[0];
      try { respondToOffer(T, o.contributorId, o.id, true); n++; } catch (e) { if (T.debug) console.warn('swarm offer:', e.message); }
    }
    return n;
  }

  /** Tiles on the open board after matching (offers lapsed, or none was made) go to the best free agent. */
  function claimOpen(c) {
    let n = 0;
    const now = T.clock.now();
    for (const t of T.db.filter('Tile', (x) => x.commissionId === c.id && x.status === 'OPEN' && x.matchSummary)) {
      if (T.db.find('Job', (j) => j.type === 'match' && j.payload.tileId === t.id && ['PENDING', 'RUNNING'].includes(j.status))) continue;
      const fits = T.db.filter('User', (u) => u.isAgent).map((u) => ({ u, fit: explainFit(T.db, t.id, u.id, now) })).filter((x) => x.fit.eligible)
        .sort((a, b) => load(a.u.id) - load(b.u.id) || b.fit.score - a.fit.score || a.u.id.localeCompare(b.u.id));
      if (!fits.length) continue;
      try { claimFromBoard(T, fits[0].u.id, t.id); n++; } catch (e) { if (T.debug) console.warn('swarm claim:', e.message); }
    }
    return n;
  }

  /** A verification or assembly job that failed (a timeout, a rate limit) gets one more go. */
  function retryFailedJobs(c) {
    let n = 0;
    const ids = new Set(tilesOf(T.db, c.id).map((t) => t.id));
    for (const j of T.db.filter('Job', (x) => x.status === 'FAILED' && !x.swarmRetried && ((x.type === 'verify' && ids.has(x.payload.tileId)) || (['assemble', 'scope', 'decompose'].includes(x.type) && x.payload.commissionId === c.id)))) {
      T.worker.retry(j.id);
      T.db.tx((tx) => tx.update('Job', j.id, { swarmRetried: true }));
      n++;
    }
    return n;
  }

  function signOff(c) {
    const gaps = (c.delivery?.gaps || []).length;
    const root = c.autopilot?.rootCheck;
    acceptDelivery(T, c.requesterId, c.id, root ? `Signed off by the autopilot after the root supervisor’s review${root.accept ? '' : ' (you overrode its concerns)'}` : 'Signed off by the autopilot on the requester’s behalf');
    const by = root ? (root.accept ? ` The root supervisor accepted it: ${root.note}` : ' You overrode the root supervisor’s concerns.') : '';
    note(c.id, `${gaps ? `Signed off by the autopilot with ${gaps} gap${gaps > 1 ? 's' : ''} flagged in the deliverable.` : 'Signed off by the autopilot.'}${by}`, { state: 'DONE', doneAt: T.clock.now() });
  }

  // --- model tasks

  async function answer(c) {
    const input = {
      job: { title: c.title, goal: c.privacy === 'RESTRICTED' ? redactText(c.goal) : c.goal },
      files: (c.files || []).map((f) => ({ name: f.name, summary: f.summary })),
      questions: c.clarifications.questions.map((q) => ({ id: q.id, question: q.question, why: q.why, suggestedAnswer: q.suggestedAnswer || '' })),
    };
    const { output } = await runAgent({ agent: AGENTS.autopilot, input, route: T.llm.forCommission(c, 'light'), log: T.log, meta: { commissionId: c.id, userId: c.requesterId } });
    const answers = Object.fromEntries(output.answers.map((a) => [a.id, a.answer]));
    answerScoping(T, c.requesterId, c.id, answers);
    const assumed = output.answers.filter((a) => a.assumption).length;
    note(c.id, `The autopilot answered ${output.answers.length} scoping question${output.answers.length === 1 ? '' : 's'}${assumed ? `, ${assumed} by assumption` : ''}.`);
  }

  /**
   * Looks up what a tile needs from the web before the work starts, once per tile (a revision
   * reuses it). Without web access the tile carries a note saying so, and the worker marks
   * outside facts "(verify)".
   */
  async function research(tile) {
    const c = T.db.get('Commission', tile.commissionId);
    const s = swarmSettings(T.db);
    const save = (research) => T.db.tx((tx) => tx.update('Tile', tile.id, { research }));
    if (!webReady()) {
      save({ unavailable: webOff || 'Web access is off in Settings.', at: T.clock.now() });
      return;
    }
    const route = T.llm.agent(s.workerModel);
    setActivity(tile.id, { agentId: tile.claimedById, doing: 'researching', since: T.clock.now(), model: route.label });
    const restricted = c.privacy === 'RESTRICTED';
    const input = {
      job: { title: c.title, goal: restricted ? redactText(c.goal) : c.goal },
      tile: { title: tile.title, spec: restricted ? redactText(tile.spec) : tile.spec, outputs: tile.outputs || [], criteria: tile.acceptanceCriteria.map((x) => x.text) },
      requesterFiles: (c.files || []).map((f) => f.name),
      limits: { searches: s.maxSearchesPerTile, pageReads: s.maxFetchesPerTile },
    };
    await pace();
    try {
      const res = await runAgent({ agent: AGENTS.researcher, input, route, log: T.log, meta: { commissionId: c.id, tileId: tile.id, userId: tile.claimedById }, tools: webTools(route.model, s), retries: 1 });
      save({ notes: res.output, sources: res.sources || [], searches: res.usage?.webSearches || 0, reads: res.usage?.webFetches || 0, model: res.model, at: T.clock.now() });
    } catch (e) {
      if (!/web access isn.t available/i.test(e.message || '')) throw e;
      webOff = e.message;
      note(c.id, 'Web search is switched off for this API key’s organization (Claude Console → Settings → Capabilities), so agents mark outside facts “(verify)” instead.');
      save({ unavailable: e.message, at: T.clock.now() });
    }
  }

  async function work(tile) {
    const agent = tile.claimedById;
    const c = T.db.get('Commission', tile.commissionId);
    const s = swarmSettings(T.db);
    if (tile.webResearch && !tile.research) {
      await research(tile);
      tile = T.db.get('Tile', tile.id);
    }
    // A check of others' work runs on a different model from the one that did the work.
    const route = T.llm.agent(tile.independentCheck ? s.checkModel : s.workerModel);
    const started = Date.now();
    setActivity(tile.id, { agentId: agent, doing: tile.status === 'REVISION' ? 'revising' : 'working', since: T.clock.now(), model: route.label });
    const input = await workerInput(T, tile);
    const model = route.shadowModel || route.model;
    const shape = sourceShape(c);
    const tps = speedFor(model, swarmSpeeds(T.db));
    // A long first attempt may be split among several agents when that saves real time for little extra cost.
    const offer = tile.status === 'REVISION' || tile.revisionCount ? null : offerFor(c, tile, input, { model, tps, shape, s });
    /** @type {any} */
    let res;
    /** @type {any} */
    let split = null;
    /** @type {any} */
    let won = null;
    if (competes(tile, s)) {
      // Competing workers do the tile and a supervisor on another model keeps the best (competition.js).
      const checkRoute = T.llm.agent(tile.independentCheck ? s.workerModel : s.checkModel);
      won = await competition.compete(tile, input, { route, checkRoute, s, offer, rows: rowRange(tile, estimateAgentWork(tile, shape)), userFeedback: tile.supervision?.state === 'retry' ? tile.supervision.feedback : null });
      const now = T.db.get('Tile', tile.id);
      if (now.claimedById !== agent || !['CLAIMED', 'REVISION'].includes(now.status)) return;
      if (won.status === 'escalated') {
        T.db.tx((tx) => tx.update('Tile', tile.id, { supervision: { ...(now.supervision || {}), state: 'escalated', specId: won.spec.id, reason: won.reason, at: tx.now() }, agentActivity: null }));
        note(c.id, `“${tile.title}” needs you: ${won.reason} Settle it on the Supervision page; the other tiles carry on.`);
        return;
      }
      res = { output: won.output, model: won.model, problems: [] };
      if (won.split) split = { parts: won.split.parts, reason: won.split.reason, report: won.split.report || [], competed: true };
    } else {
      if (offer) input.delegation = offer.delegation;
      await pace();
      const call = (inp, extra = {}) => runAgent({ agent: AGENTS.worker, input: inp, route, log: T.log, meta: { commissionId: c.id, tileId: tile.id, userId: agent }, maxTokens: 20000, bestEffort: true, ...extra });
      res = await call(input, { cache: !!offer });
      if (res.output.split) {
        split = offer && !res.problems?.length ? await runParts(tile, input, res.output, route) : { failed: `the split plan didn't hold up (${(res.problems || ['not offered']).join('; ')})` };
        if (split.failed) {
          // The parts couldn't be done or joined: one agent does the whole tile after all.
          delete input.delegation;
          res = await call(input, { cache: !!offer });
        } else {
          res = { ...res, output: split.output, problems: split.problems };
        }
      }
    }
    const cur = T.db.get('Tile', tile.id);
    if (cur.claimedById !== agent || !['CLAIMED', 'REVISION'].includes(cur.status)) return;
    // Placeholder data when the real data was in the inputs is never handed in; the task retries.
    const fake = samplePlaceholder(res.output, input);
    if (fake) throw new Error(`Refused to hand in placeholder data: ${fake}`);
    const pre = input.precomputedFiles || [];
    const allowed = (name) => config.limits.allowedExtensions.includes(String(name).split('.').pop().toLowerCase());
    const files = [
      ...res.output.files.filter((f) => allowed(f.name) && !pre.some((p) => p.name === f.name)).map((f) => ({ name: f.name, text: f.content })),
      ...pre.map((p) => ({ name: p.name, text: p.text })),
    ].slice(0, config.limits.maxFilesPerSubmission);
    if (!files.length) throw new Error('The agent handed in no usable files.');
    const seconds = Math.round((Date.now() - started) / 1000);
    const notes = [
      res.output.approach.map((a, i) => `${i + 1}. ${a}`).join('\n'),
      res.output.notes,
      input.mergeReport || '',
      won ? competitionNote(won) : '',
      split && !split.failed ? `Split into ${split.parts} parts that ran at the same time (${split.reason})${split.competed ? ', each competed on its own' : ''}; joined by code: ${split.report.join('; ') || 'one file per part'}.${split.repaired ? ' The joined files failed a check, so the lead agent fixed them.' : ''}` : '',
      split?.failed ? `Offered a split, but ${split.failed}, so one agent did the whole tile.` : '',
      tile.research && !tile.research.unavailable ? `Web research: ${tile.research.searches || 0} searches, ${tile.research.reads || 0} pages read, ${(tile.research.sources || []).length} sources.` : '',
      res.problems?.length ? `Handed in with known problems after ${config.llm.maxRetries + 1} attempts: ${res.problems.join('; ')}` : '',
    ].filter(Boolean).join('\n\n');
    await submitWork(T, agent, tile.id, {
      files, notes, minutesSpent: Math.max(1, Math.round((Date.now() - started) / 60000)),
      checklist: Object.fromEntries(res.output.checklist.map((x) => [x.criterionId, x.done])),
      modelUsed: `${res.model} (agent)`, handoff: res.output.handoff,
      supervised: won ? {
        specId: won.spec.id, score: won.score, threshold: won.spec.threshold, flagged: won.flagged, disagreements: won.disagreements,
        model: won.supervisorId, confidence: won.confidence, verdicts: won.verdicts, winner: won.winner,
      } : null,
    });
    const estSeconds = agentSeconds(tile, { ...shape, tps });
    T.db.tx((tx) => tx.update('Tile', tile.id, {
      agentTiming: { estSeconds, seconds, parts: split && !split.failed ? split.parts : null, offered: offer ? offer.parts : null, at: T.clock.now() },
      ...(won && cur.supervision ? { supervision: { ...cur.supervision, state: 'resolved', resolvedAt: T.clock.now() } } : {}),
    }));
    setActivity(tile.id, null);
  }

  /** What the submission notes say about the competition behind it. */
  function competitionNote(won) {
    const names = (won.spec.competitors || []).map((x) => x.name);
    const who = won.split ? `Each part competed on its own (${names.length} configs)` : names.length > 1 ? `${names.length} worker configs competed (${names.join(', ')})` : `${names[0] || 'One config'} worked alone`;
    const how = won.winner && !won.split ? `; ${won.winner.configName} won with ${won.score.toFixed(2)}` : `; the joined parts scored ${won.score.toFixed(2)}`;
    return `${who}${how} (threshold ${won.spec.threshold}), scored by ${won.supervisorId || 'the supervisor'}.${won.flagged ? ` Flagged: the workers disagreed sharply${won.disagreements.length ? ` (${won.disagreements.slice(0, 3).join('; ')})` : ''}.` : ''}`;
  }

  /**
   * Whether this tile may be split, and the offer the lead agent sees: how many parts, how the
   * work divides, which files the parts share, and the rows they cover.
   */
  function offerFor(c, tile, input, { model, tps, shape, s }) {
    const pre = new Set((input.precomputedFiles || []).map((f) => f.name));
    const files = (tile.outputs || []).filter((n) => !pre.has(n));
    if (!files.length) return null;
    const work = estimateAgentWork(tile, shape);
    const inputTokens = estimateTokens(AGENTS.worker.prompt.system) + estimateTokens(JSON.stringify(input));
    const offer = splitOffer({ tile, work, inputTokens, model, tps, settings: s, spentUsd: spentUsd(T.db, c.id) });
    if (!offer) return null;
    const rows = rowRange(tile, work);
    return {
      ...offer,
      delegation: {
        maxParts: offer.parts, by: offer.by, files, ...(offer.by === 'rows' && rows ? { rows } : {}),
        estimate: `About ${offer.estSeconds} s for one agent; about ${offer.splitSeconds} s in ${offer.parts} parts at once.`,
      },
    };
  }

  /**
   * Does a split tile: every part at once, each by its own worker call that reads the shared
   * context from the prompt cache the lead agent's call wrote. The parts are joined by code and
   * checked like one agent's work; if the joined files fail a check, the lead agent fixes them.
   * @returns {Promise<{ failed?: string, output?: any, parts?: number, reason?: string, report?: string[], repaired?: boolean, problems?: string[] }>}
   */
  async function runParts(tile, input, lead, route) {
    const agent = tile.claimedById;
    const parts = lead.split.parts;
    const n = parts.length;
    const plan = parts.map((p, i) => ({ part: i + 1, brief: p.brief, files: p.files, ...(p.rows ? { rows: p.rows } : {}) }));
    setActivity(tile.id, { agentId: agent, doing: `working in ${n} parts at once`, parts: n, since: T.clock.now(), model: route.label });
    const { delegation, ...shared } = input;
    const settled = await Promise.allSettled(parts.map((p, i) => runAgent({
      agent: AGENTS.worker, route, log: T.log, maxTokens: 20000, retries: 1, cache: true,
      input: { ...shared, part: { index: i + 1, of: n, brief: p.brief, files: p.files, ...(p.rows ? { rows: p.rows } : {}), plan } },
      meta: { commissionId: tile.commissionId, tileId: tile.id, userId: agent, part: `${i + 1}/${n}` },
    })));
    const bad = settled.findIndex((r) => r.status === 'rejected' || r.value.problems?.length);
    if (bad >= 0) {
      const r = settled[bad];
      return { failed: `part ${bad + 1} failed (${r.status === 'rejected' ? r.reason?.message || r.reason : r.value.problems.join('; ')})` };
    }
    const outs = settled.map((r) => /** @type {any} */ (r).value.output);
    const idColumn = tile.acceptanceCriteria.map((c) => /^\s*csv_unique\((\w+)\)/.exec(c.rule || '')?.[1]).find(Boolean) || null;
    const joined = joinParts(outs, { expected: delegation.files, idColumn });
    if (joined.problems.some((x) => /^no part handed in/.test(x))) return { failed: joined.problems.join('; ') };
    let output = {
      approach: [...lead.approach, `Split the tile into ${n} parts that other agents did at the same time: ${plan.map((p) => p.brief).join(' | ')}`],
      files: joined.files,
      notes: [lead.notes, ...outs.map((o, i) => `Part ${i + 1}: ${o.notes}`)].filter(Boolean).join('\n\n'),
      checklist: tile.acceptanceCriteria.map((x) => ({ criterionId: x.id, done: true, note: 'Each part was written against it; the checks ran on the joined files.' })),
      handoff: [...new Set([lead.handoff, ...outs.map((o) => o.handoff)].filter(Boolean))].join('\n'),
    };
    const failing = runAutoChecks(tile.acceptanceCriteria, workerFiles(output, input)).results.filter((r) => !r.pass);
    const fake = samplePlaceholder(output, input);
    let repaired = false;
    let problems = joined.problems;
    if (failing.length || fake) {
      // The joined files fail a check: the lead agent fixes them in one pass, as on a revision.
      setActivity(tile.id, { agentId: agent, doing: 'fixing the joined parts', since: T.clock.now(), model: route.label });
      const failed = [
        ...failing.map((r) => ({ criterionId: tile.acceptanceCriteria.find((x) => x.rule === r.rule)?.id || r.rule, criterion: r.rule, reason: r.reason, checkedBy: 'the swarm, on the joined parts' })),
        ...(fake ? [{ criterionId: 'sample', criterion: 'No placeholder data', reason: fake, checkedBy: 'the swarm, on the joined parts' }] : []),
      ];
      const fix = await runAgent({
        agent: AGENTS.worker, route, log: T.log, maxTokens: 20000, bestEffort: true, cache: true,
        input: Object.defineProperty({ ...shared, revision: { round: 0, failed, previousFiles: joined.files } }, 'precomputedFiles', { value: input.precomputedFiles || [], enumerable: false }),
        meta: { commissionId: tile.commissionId, tileId: tile.id, userId: agent },
      });
      output = { ...fix.output, approach: [...output.approach, ...fix.output.approach], notes: [output.notes, fix.output.notes].filter(Boolean).join('\n\n') };
      problems = [...problems, ...(fix.problems || [])];
      repaired = true;
    }
    return { output, parts: n, reason: lead.split.reason, report: joined.report, repaired, problems };
  }

  async function reviewInput(target, sub, criteria, c) {
    const restricted = c.privacy === 'RESTRICTED';
    const files = await loadFileTexts(T, sub.files, { maxChars: 20000 });
    return {
      tile: { title: target.title, spec: restricted ? redactText(target.spec) : target.spec, deliverableFormat: target.deliverableFormat },
      criteria: criteria.map((x) => ({ id: x.id, text: x.text })),
      submission: { notes: sub.notes, files: files.map((f) => ({ name: f.name, excerpt: typeof f.text === 'string' ? clipText(restricted ? redactText(f.text) : f.text, 8000) : '(binary file)' })) },
    };
  }

  const verdictsOf = (out) => out.criteria.map((v) => ({ criterionId: v.criterionId, pass: v.pass, reason: v.reason.length >= 10 ? v.reason : `${v.reason} (as judged).` }));

  async function peerReview(rt) {
    const agent = rt.claimedById;
    const c = T.db.get('Commission', rt.commissionId);
    const target = T.db.get('Tile', rt.reviewOf.tileId);
    const sub = T.db.get('Submission', rt.reviewOf.submissionId);
    setActivity(rt.id, { agentId: agent, doing: 'reviewing', since: T.clock.now() });
    const input = await reviewInput(target, sub, rt.acceptanceCriteria, c);
    await pace();
    const route = T.llm.agent(swarmSettings(T.db).checkModel);
    const { output, model } = await runAgent({ agent: AGENTS.reviewer, input, route, log: T.log, meta: { commissionId: c.id, tileId: rt.id, userId: agent } });
    const cur = T.db.get('Tile', rt.id);
    if (cur.claimedById !== agent || cur.status !== 'CLAIMED') return;
    submitPeerReview(T, agent, rt.id, { verdicts: verdictsOf(output), notes: `Reviewed by an agent (${model}), confidence ${Math.round(output.confidence * 100)}%.` });
    setActivity(rt.id, null);
  }

  /** A peer review no agent is eligible for: the autopilot reviews it as the requester. */
  async function selfReview(rt) {
    const c = T.db.get('Commission', rt.commissionId);
    const target = T.db.get('Tile', rt.reviewOf.tileId);
    const sub = T.db.get('Submission', rt.reviewOf.submissionId);
    const input = await reviewInput(target, sub, rt.acceptanceCriteria, c);
    const { output } = await runAgent({ agent: AGENTS.reviewer, input, route: T.llm.forCommission(c, 'heavy'), log: T.log, meta: { commissionId: c.id, tileId: target.id, userId: c.requesterId } });
    requesterReview(T, c.requesterId, target.id, verdictsOf(output));
  }

  // --- the loop

  /** What each swarm job needs next: synchronous steps run now, model tasks are returned. */
  function plan() {
    const tasks = [];
    let acted = 0;
    for (const c of jobs()) {
      if (paused(c)) continue;
      const cap = swarmSettings(T.db).spendCapUsd;
      if (cap > 0 && spentUsd(T.db, c.id) >= cap) { pause(c.id, `Paused at the $${cap} spend cap. Raise it in Settings, then resume.`); continue; }
      try {
        acted += retryFailedJobs(c);
        // Lessons from each scored task are written in the background while the job goes on.
        const reflecting = T.db.filter('TaskSpec', (x) => x.commissionId === c.id && x.reflect === 'pending');
        for (const sp of reflecting) tasks.push({ key: `reflect:${sp.id}`, commissionId: c.id, run: () => competition.reflect(sp.id) });
        if (c.status === 'SCOPING' && c.clarifications?.scopedAt && !c.clarifications.answeredAt && c.planState !== 'DECOMPOSING' && c.clarifications.questions.length) {
          tasks.push({ key: `answer:${c.id}`, commissionId: c.id, run: () => answer(c) });
        } else if (c.status === 'PLANNED') {
          launch(c); acted++;
        } else if (c.status === 'ACTIVE') {
          // A tile two agents in a row couldn't get through review needs a person to look at it.
          const cleared = c.autopilot?.cleared || {};
          const stuck = T.db.find('Tile', (t) => t.commissionId === c.id && (t.reopenCount || 0) >= 2 && t.reopenCount > (cleared[t.id] || 0));
          if (stuck) { pause(c.id, `Paused: “${stuck.title}” failed review with ${stuck.reopenCount} agents in a row. Read its reviews, then resume to give it to another agent.`); continue; }
          acted += takeOffers(c) + claimOpen(c);
          // A task the supervisor escalated waits for you on the Supervision page.
          for (const t of T.db.filter('Tile', (x) => x.commissionId === c.id && ['CLAIMED', 'REVISION'].includes(x.status) && isAgent(x.claimedById) && x.supervision?.state !== 'escalated')) {
            const key = `${t.dynamic ? 'review' : 'work'}:${t.id}:${t.status}:${t.revisionCount || 0}:${t.reopenCount || 0}:${t.supervision?.retries || 0}`;
            tasks.push({ key, commissionId: c.id, tileId: t.id, run: () => (t.dynamic && t.reviewOf ? peerReview(t) : work(t)) });
          }
          for (const t of T.db.filter('Tile', (x) => x.commissionId === c.id && x.dynamic && x.status === 'OPEN' && x.matchSummary && x.matchSummary.eligible === 0)) {
            tasks.push({ key: `self-review:${t.id}`, commissionId: c.id, run: () => selfReview(t) });
          }
        } else if (c.status === 'DELIVERED') {
          // With competition on, the root supervisor judges the whole job first (after the last lessons are written).
          const root = c.autopilot?.rootCheck;
          if (swarmSettings(T.db).competition === 'off') { signOff(c); acted++; }
          else if (reflecting.length) { /* the last reflections finish first */ }
          else if (!root || root.deliveredAt !== c.deliveredAt) tasks.push({ key: `root:${c.id}:${c.deliveredAt}`, commissionId: c.id, run: () => competition.rootCheck(c) });
          else if (root.accept || root.overridden === c.deliveredAt) { signOff(c); acted++; }
          else pause(c.id, `Paused before sign-off: the root supervisor wants you to look first. ${root.concerns.join(' ')} Accept the delivery yourself, or resume to let the autopilot sign off.`);
        }
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        pause(c.id, `Paused: the autopilot hit a problem it can’t fix on its own (${e.message}).`);
      }
    }
    return { tasks, acted };
  }

  function start(task) {
    const p = (async () => {
      try {
        await task.run();
        failures.delete(task.key);
      } catch (e) {
        const f = failures.get(task.key) || { count: 0 };
        f.count += 1;
        f.until = Date.now() + Math.min(120000, 5000 * 2 ** f.count);
        failures.set(task.key, f);
        if (task.tileId) setActivity(task.tileId, { error: String(e.message || e), at: T.clock.now() });
        if (f.count >= 3) pause(task.commissionId, `Paused after three failed attempts: ${e.message}`);
        if (T.debug) console.warn('swarm task failed:', task.key, e);
      } finally {
        running.delete(task.key);
      }
    })();
    running.set(task.key, p);
    return p;
  }

  /** One pass: runs the bookkeeping and starts model tasks up to the concurrency limit. Returns how much it did. */
  async function step() {
    if (stepping) return 0;
    stepping = true;
    try {
      if (!jobs().length) return 0;
      ensureAgents(T);
      const { tasks, acted } = plan();
      let started = 0;
      const limit = Math.max(1, swarmSettings(T.db).concurrency);
      for (const task of tasks) {
        if (running.size >= limit) break;
        if (running.has(task.key)) continue;
        const f = failures.get(task.key);
        if (f && f.until > Date.now()) continue;
        start(task);
        started++;
      }
      return acted + started;
    } finally {
      stepping = false;
    }
  }

  /** Runs jobs, swarm steps and agent tasks until nothing is left to do. For tests and the seed. */
  async function settle({ maxRounds = 2000 } = {}) {
    for (let i = 0; i < maxRounds; i++) {
      await T.worker.drain();
      const n = await step();
      if (running.size) { await Promise.race(running.values()); continue; }
      if (!n && !T.db.find('Job', (j) => j.status === 'PENDING' && j.runAfter <= T.clock.now())) return i;
    }
    throw new Error('swarm.settle() did not settle');
  }

  return {
    step, settle,
    start(ms = 1000) { if (!timer) timer = setInterval(() => { step().catch((e) => console.error(e)); }, ms); },
    stop() { clearInterval(timer); timer = null; },
    get running() { return [...running.keys()]; },
    reset() { failures.clear(); },
  };
}

// ---------------------------------------------------------------- the API

/**
 * Hands a job to the swarm. You write it; agents do everything after. With a plan from the
 * breakdown tool, scoping and decomposition are skipped.
 */
export async function runWithAgents(T, actorId, input) {
  const user = must(T.db.get('User', actorId), 'Unknown user.');
  if (!user.isRequester) throw new UserError('Switch to a requester persona to hand a job to the swarm.');
  ensureAgents(T);
  const now = T.clock.now();
  const budgetCents = input.budgetCents || (input.plan?.pricing?.total ? Math.max(5000, Math.min(10000000, Math.ceil(input.plan.pricing.total * 1.1))) : 1000000);
  return postCommission(T, actorId, {
    title: input.title, goal: input.goal, files: input.files || [], privacy: input.privacy || 'PUBLIC', language: input.language || 'en',
    budgetCents, deadline: input.deadline || now + 7 * DAY, workforce: 'agents', ...(input.plan ? { plan: input.plan } : {}),
  });
}

function requireSteward(tx, actorId, commissionId) {
  const c = must(tx.get('Commission', commissionId), 'Commission not found.');
  const u = must(tx.get('User', actorId), 'Unknown user.');
  if (c.workforce !== 'agents') throw new UserError('This job isn’t run by the swarm.');
  if (c.requesterId !== actorId && !u.isAdmin) throw new UserError('Only the requester can pause or resume the swarm on this job.');
  return c;
}

export function pauseSwarmJob(T, actorId, commissionId) {
  return T.db.tx((tx) => {
    const c = requireSteward(tx, actorId, commissionId);
    return tx.update('Commission', commissionId, { autopilot: { ...(c.autopilot || {}), state: 'PAUSED', note: 'Paused by the requester.', notedAt: tx.now() } });
  }, { actor: actorId });
}

export function resumeSwarmJob(T, actorId, commissionId) {
  const out = T.db.tx((tx) => {
    const c = requireSteward(tx, actorId, commissionId);
    if (['ACCEPTED', 'CANCELLED'].includes(c.status)) throw new UserError('This job is finished.');
    // Resuming gives each tile that stalled the swarm one more agent.
    const cleared = Object.fromEntries(tilesOf(tx, commissionId).filter((t) => t.reopenCount).map((t) => [t.id, t.reopenCount]));
    // Resuming a job the root supervisor held back lets the autopilot sign it off.
    const root = c.autopilot?.rootCheck;
    const rootCheck = root && !root.accept && c.status === 'DELIVERED' ? { ...root, overridden: c.deliveredAt } : root;
    return tx.update('Commission', commissionId, { autopilot: { ...(c.autopilot || {}), state: 'RUNNING', note: 'Resumed.', notedAt: tx.now(), cleared, ...(rootCheck ? { rootCheck } : {}) } });
  }, { actor: actorId });
  T.swarm?.reset();
  return out;
}
