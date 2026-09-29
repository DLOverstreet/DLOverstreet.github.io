// Splitting one tile among several agents. A lead agent that the swarm offers a split can
// return a plan instead of files; each part then runs as its own worker call at the same time,
// and the parts are joined by code: the rows of a table stacked in part order, the sections
// of a document in order. The joined files are checked like any single agent's work.
import { parseCsv, toCsv } from '../lib/csv.js';

/** Files several parts may each write a share of, joined by code. */
const JOINABLE = /\.(csv|md|markdown|txt|json)$/i;

/**
 * Problems with a split plan, for the validator to send back. `input.delegation` says how many
 * parts are allowed, which files the tile owes, and how many rows its table has.
 * @param {{ reason: string, parts: { brief: string, files: string[], rows?: { from: number, to: number } }[] }} split
 * @param {any} input the worker input
 * @returns {string[]}
 */
export function splitProblems(split, input) {
  const d = input.delegation;
  if (!d) return ['This tile may not be split: do it whole, hand in the files and leave split out.'];
  const problems = [];
  const parts = split.parts || [];
  if (parts.length < 2 || parts.length > d.maxParts) problems.push(`split into ${d.maxParts > 2 ? `2 to ${d.maxParts}` : '2'} parts, not ${parts.length}`);
  const owed = new Set(d.files);
  const writers = new Map();
  parts.forEach((p, i) => {
    for (const f of p.files || []) {
      if (!owed.has(f)) problems.push(`part ${i + 1} names ${f}, which isn't one of this tile's files (${d.files.join(', ')})`);
      writers.set(f, [...(writers.get(f) || []), i]);
    }
  });
  for (const f of d.files) if (!writers.has(f)) problems.push(`no part writes ${f}`);
  for (const [f, list] of writers) if (list.length > 1 && !JOINABLE.test(f)) problems.push(`${f} can't be joined from several parts; give it to one part`);
  // Rows are numbered as the tile numbers them (a batch of rows 46–90 splits into 46–68 and 69–90).
  const ranged = parts.filter((p) => p.rows);
  if (ranged.length) {
    const sorted = [...ranged].sort((a, b) => a.rows.from - b.rows.from);
    for (const p of sorted) if (p.rows.to < p.rows.from) problems.push(`rows ${p.rows.from}–${p.rows.to} run backwards`);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].rows.from <= sorted[i - 1].rows.to) problems.push(`rows ${sorted[i - 1].rows.from}–${sorted[i - 1].rows.to} and ${sorted[i].rows.from}–${sorted[i].rows.to} overlap`);
    if (d.rows) {
      const outside = sorted.filter((p) => p.rows.from < d.rows.from || p.rows.to > d.rows.to);
      if (outside.length) problems.push(`this tile's rows are ${d.rows.from}–${d.rows.to}; rows ${outside.map((p) => `${p.rows.from}–${p.rows.to}`).join(', ')} fall outside them`);
      const covered = sorted.reduce((n, p) => n + (Math.min(p.rows.to, d.rows.to) - Math.max(p.rows.from, d.rows.from) + 1), 0);
      if (ranged.length === parts.length && covered < d.rows.to - d.rows.from + 1) problems.push(`the parts cover ${covered} of the ${d.rows.to - d.rows.from + 1} rows ${d.rows.from}–${d.rows.to}`);
    }
  }
  return problems;
}

function csvJoin(texts, idColumn) {
  const tables = texts.map((t) => parseCsv(t));
  const columns = [];
  for (const t of tables) for (const c of t.columns) if (!columns.includes(c)) columns.push(c);
  const id = idColumn && columns.includes(idColumn) ? idColumn : /(^|_)id$/i.test(columns[0] || '') ? columns[0] : null;
  const seen = new Set();
  const rows = [];
  let dropped = 0;
  for (const t of tables) {
    for (const r of t.rows) {
      const row = columns.map((c) => r[t.columns.indexOf(c)] ?? '');
      if (id) {
        const k = row[columns.indexOf(id)];
        if (k && seen.has(k)) { dropped++; continue; }
        if (k) seen.add(k);
      }
      rows.push(row);
    }
  }
  return { text: toCsv(columns, rows), rows: rows.length, dropped, id };
}

/**
 * Joins the parts' files, in part order. Tables are stacked under one header (a row whose id
 * an earlier part already handed in is dropped); documents are joined section after section;
 * JSON lists are concatenated. A file only one part wrote is kept as it is.
 * @param {{ files: { name: string, content: string }[] }[]} parts in part order
 * @param {{ expected: string[], idColumn?: string|null }} opts
 * @returns {{ files: { name: string, content: string }[], report: string[], problems: string[] }}
 */
export function joinParts(parts, { expected, idColumn = null }) {
  const names = [...expected];
  for (const p of parts) for (const f of p.files) if (!names.includes(f.name)) names.push(f.name);
  const files = [];
  const report = [];
  const problems = [];
  for (const name of names) {
    const shares = parts.map((p) => p.files.find((f) => f.name === name)).filter((f) => f && f.content.trim());
    if (!shares.length) { if (expected.includes(name)) problems.push(`no part handed in ${name}`); continue; }
    if (shares.length === 1) { files.push({ name, content: shares[0].content }); continue; }
    if (/\.csv$/i.test(name)) {
      const j = csvJoin(shares.map((s) => s.content), idColumn);
      files.push({ name, content: j.text });
      report.push(`${name}: ${j.rows} rows from ${shares.length} parts${j.dropped ? ` (${j.dropped} repeated ${j.id} dropped)` : ''}`);
    } else if (/\.(md|markdown|txt)$/i.test(name)) {
      files.push({ name, content: `${shares.map((s) => s.content.trim()).join('\n\n')}\n` });
      report.push(`${name}: ${shares.length} parts in order`);
    } else if (/\.json$/i.test(name)) {
      let lists;
      try { lists = shares.map((s) => JSON.parse(s.content)); } catch { lists = null; }
      if (lists && lists.every(Array.isArray)) {
        files.push({ name, content: `${JSON.stringify(lists.flat(), null, 2)}\n` });
        report.push(`${name}: ${lists.flat().length} items from ${shares.length} parts`);
      } else {
        files.push({ name, content: shares[0].content });
        problems.push(`${name} came from ${shares.length} parts and can't be joined; the first part's copy was kept`);
      }
    } else {
      files.push({ name, content: shares[0].content });
      problems.push(`${name} came from ${shares.length} parts and can't be joined; the first part's copy was kept`);
    }
  }
  return { files, report, problems };
}
