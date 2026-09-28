// The agent swarm. On a job handed to the swarm, AI agents do every step after you submit
// it: the autopilot answers the Scoping agent's questions, adapts the plan for agents and
// funds it; agents take the offers, do each tile with the worker agent, peer-review each
// other where the plan asks for a person's judgment, and revise failed rounds; the autopilot
// signs off the delivery. Agents are contributor accounts marked isAgent, so every claim,
// check, payout and reputation event goes through the same services a person uses.
import { AGENTS } from '../agents/index.js';
import { runAgent } from '../llm/run-agent.js';
import { runCostUsd } from '../llm/prices.js';
import { adaptForAgents } from '../decompose/agents.js';
import { UserError, must, tilesOf } from './core.js';
import { respondToOffer, claimFromBoard, explainFit } from './market.js';
import { submitWork, submitPeerReview, requesterReview, upstreamFiles } from './work.js';
import { acceptDelivery } from './delivery.js';
import { answerScoping, fundCommission, replacePlan, draftGraph, postCommission } from './commissions.js';
import { loadFileTexts } from './files.js';
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
  const sorted = [...list].sort((a, b) => Number(NUMBERED.exec(a.name)?.[2] || 0) - Number(NUMBERED.exec(b.name)?.[2] || 0));
  const tables = sorted.map(csvTable);
  const columns = [...new Set(tables.flatMap((t) => t.columns))];
  const rows = tables.flatMap((t) => t.rows.map((r) => columns.map((c) => r[t.columns.indexOf(c)] ?? '')));
  return { columns, rows, from: sorted.map((f) => f.name) };
}

/**
 * Batch files merged without a model, so a merge of thousands of rows is exact: numbered
 * batches of one file (coded_01.csv, coded_02.csv → coded_all.csv) are stacked, and for a
 * final assembly tile with one CSV output, batches of different files are joined on their
 * shared id column, onto the attached source file when it has that column.
 * @param {{ kind?: string, outputs?: string[], acceptanceCriteria?: any[] }} tile
 * @param {{ name: string, text: string|null }[]} files upstream files with their text
 * @param {{ name: string, text: string|null }[]} [sources] the requester's attached files
 * @returns {{ name: string, text: string, rows: number, from: string[] }[]}
 */
export function mergeBatches(tile, files, sources = []) {
  const csvOut = (tile.outputs || []).filter((n) => /\.csv$/i.test(n));
  if (!csvOut.length) return [];
  const groups = new Map();
  for (const f of files) {
    if (typeof f.text !== 'string') continue;
    const m = NUMBERED.exec(f.name);
    if (m) (groups.get(m[1]) || groups.set(m[1], []).get(m[1])).push(f);
  }
  const out = [];
  for (const name of csvOut) {
    const stem = name.replace(/\.csv$/i, '').replace(/_(all|merged|combined|full)$/i, '');
    const g = groups.get(stem);
    if (!g || g.length < 2) continue;
    const t = concatTables(g);
    out.push({ name, text: toCsv(t.columns, t.rows), rows: t.rows.length, from: t.from, added: t.columns });
  }
  if (out.length || csvOut.length !== 1 || tile.kind !== 'INTEGRATION' || groups.size < 2) return out;
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

/**
 * The files a tile works from: everything its upstream tiles delivered, plus any file its
 * inputs name that an earlier accepted tile made (a final assembly tile names batch files
 * from several layers up).
 */
export function inputRefs(db, tile) {
  const out = upstreamFiles(db, tile.id);
  const want = new Set(tile.inputs || []);
  const have = new Set(out.map((f) => f.name));
  if (![...want].some((n) => !have.has(n))) return out;
  for (const t of db.filter('Tile', (x) => x.commissionId === tile.commissionId && !x.dynamic && x.status === 'ACCEPTED' && x.acceptedSubmissionId && x.id !== tile.id)) {
    for (const f of db.get('Submission', t.acceptedSubmissionId)?.files || []) {
      if (want.has(f.name) && !have.has(f.name)) { out.push({ ...f, fromTile: t.key, fromTitle: t.title }); have.add(f.name); }
    }
  }
  return out;
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
    if (typeof f.text !== 'string') { input.attachments.push({ name: f.name, note: isTextFile(f.name) ? 'Empty.' : 'Binary file, not shown.' }); continue; }
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

  // --- synchronous steps: bookkeeping the autopilot and agents do without a model

  /** The plan is ready: adapt it for agents, then fund it. */
  function launch(c) {
    const tiles = draftGraph(T.db, c.id).filter((t) => t.status !== 'CANCELLED');
    const hasSource = (c.files || []).some((f) => isTextFile(f.name));
    const sourceRows = Math.max(0, ...(c.files || []).map((f) => f.summary?.rowCount || 0)) || null;
    const adapted = adaptForAgents(tiles, { hasSource, sourceRows });
    if (adapted.changes.length || adapted.handoffs.length) replacePlan(T, c.requesterId, c.id, adapted.tiles, 'Adapted the plan for the agent swarm');
    fundCommission(T, c.requesterId, c.id, { acceptOverBudget: true });
    note(c.id, `The swarm started on ${adapted.tiles.length} tiles.`, { launchedAt: T.clock.now(), changes: adapted.changes, handoffs: adapted.handoffs });
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
    acceptDelivery(T, c.requesterId, c.id, 'Signed off by the autopilot on the requester’s behalf');
    note(c.id, gaps ? `Signed off by the autopilot with ${gaps} gap${gaps > 1 ? 's' : ''} flagged in the deliverable.` : 'Signed off by the autopilot.', { state: 'DONE', doneAt: T.clock.now() });
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

  async function work(tile) {
    const agent = tile.claimedById;
    const c = T.db.get('Commission', tile.commissionId);
    const route = T.llm.forCommission(c, swarmSettings(T.db).workerTier);
    const started = Date.now();
    setActivity(tile.id, { agentId: agent, doing: tile.status === 'REVISION' ? 'revising' : 'working', since: T.clock.now(), model: route.label });
    const input = await workerInput(T, tile);
    await pace();
    const res = await runAgent({ agent: AGENTS.worker, input, route, log: T.log, meta: { commissionId: c.id, tileId: tile.id, userId: agent }, maxTokens: 16000, bestEffort: true });
    const cur = T.db.get('Tile', tile.id);
    if (cur.claimedById !== agent || !['CLAIMED', 'REVISION'].includes(cur.status)) return;
    const pre = input.precomputedFiles || [];
    const allowed = (name) => config.limits.allowedExtensions.includes(String(name).split('.').pop().toLowerCase());
    const files = [
      ...res.output.files.filter((f) => allowed(f.name) && !pre.some((p) => p.name === f.name)).map((f) => ({ name: f.name, text: f.content })),
      ...pre.map((p) => ({ name: p.name, text: p.text })),
    ].slice(0, config.limits.maxFilesPerSubmission);
    if (!files.length) throw new Error('The agent handed in no usable files.');
    const notes = [
      res.output.approach.map((a, i) => `${i + 1}. ${a}`).join('\n'),
      res.output.notes,
      pre.length ? `Merged by the swarm without a model: ${pre.map((p) => p.name).join(', ')}.` : '',
      res.problems?.length ? `Handed in with known problems after ${config.llm.maxRetries + 1} attempts: ${res.problems.join('; ')}` : '',
    ].filter(Boolean).join('\n\n');
    await submitWork(T, agent, tile.id, {
      files, notes, minutesSpent: Math.max(1, Math.round((Date.now() - started) / 60000)),
      checklist: Object.fromEntries(res.output.checklist.map((x) => [x.criterionId, x.done])),
      modelUsed: `${res.model} (agent)`, handoff: res.output.handoff,
    });
    setActivity(tile.id, null);
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
    const route = T.llm.forCommission(c, swarmSettings(T.db).workerTier);
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
          for (const t of T.db.filter('Tile', (x) => x.commissionId === c.id && ['CLAIMED', 'REVISION'].includes(x.status) && isAgent(x.claimedById))) {
            const key = `${t.dynamic ? 'review' : 'work'}:${t.id}:${t.status}:${t.revisionCount || 0}:${t.reopenCount || 0}`;
            tasks.push({ key, commissionId: c.id, tileId: t.id, run: () => (t.dynamic && t.reviewOf ? peerReview(t) : work(t)) });
          }
          for (const t of T.db.filter('Tile', (x) => x.commissionId === c.id && x.dynamic && x.status === 'OPEN' && x.matchSummary && x.matchSummary.eligible === 0)) {
            tasks.push({ key: `self-review:${t.id}`, commissionId: c.id, run: () => selfReview(t) });
          }
        } else if (c.status === 'DELIVERED') {
          signOff(c); acted++;
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
    return tx.update('Commission', commissionId, { autopilot: { ...(c.autopilot || {}), state: 'RUNNING', note: 'Resumed.', notedAt: tx.now(), cleared } });
  }, { actor: actorId });
  T.swarm?.reset();
  return out;
}
