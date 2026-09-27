// AUTO acceptance checks. A criterion marked AUTO carries a machine-readable rule such as
// csv_columns(case_id, filed_date) or word_count(400, 600). Rules the checker doesn't
// understand are passed to the LLM Reviewer instead of silently passing.
import { parseCsv } from '../lib/csv.js';
import { fileExt, wordCount } from '../lib/util.js';

/** Splits "a, 'b, c', d" into ["a", "b, c", "d"]. */
function splitArgs(src) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of src) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out.filter((a) => a !== '');
}

export function parseRule(rule) {
  const m = /^\s*([a-z_]+)\s*\((.*)\)\s*$/s.exec(String(rule || ''));
  if (!m) return null;
  const name = m[1];
  if (!RULES[name]) return null;
  const args = splitArgs(m[2]).flatMap((a) => (name === 'file_ext' ? a.split('|') : [a])).map((a) => a.trim());
  return { name, args };
}

const csvFiles = (files) => files.filter((f) => ['csv', 'tsv'].includes(fileExt(f.name)) && typeof f.text === 'string');
const jsonFiles = (files) => files.filter((f) => ['json', 'geojson'].includes(fileExt(f.name)) && typeof f.text === 'string');
const proseFiles = (files) => files.filter((f) => ['md', 'markdown', 'txt'].includes(fileExt(f.name)) && typeof f.text === 'string');
const textFiles = (files) => files.filter((f) => typeof f.text === 'string');

function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, '_'); }

export const RULES = {
  file_ext: {
    help: 'file_ext(csv|xlsx) — at least one file has one of these extensions',
    run(files, exts) {
      const want = exts.map((e) => e.replace(/^\./, '').toLowerCase());
      const hit = files.find((f) => want.includes(fileExt(f.name)));
      return hit ? { pass: true, reason: `Found ${hit.name}.` } : { pass: false, reason: `No .${want.join(' or .')} file was submitted.` };
    },
  },
  min_files: {
    help: 'min_files(2) — at least this many files',
    run(files, [n]) {
      const need = Number(n) || 1;
      return files.length >= need ? { pass: true, reason: `${files.length} file(s) submitted.` } : { pass: false, reason: `Needs at least ${need} file(s); got ${files.length}.` };
    },
  },
  csv_columns: {
    help: 'csv_columns(a, b) — a CSV file has all of these columns',
    run(files, cols) {
      const csvs = csvFiles(files);
      if (!csvs.length) return { pass: false, reason: 'No CSV file was submitted.' };
      const want = cols.map(norm);
      let bestMissing = want;
      for (const f of csvs) {
        const have = new Set(parseCsv(f.text).columns.map(norm));
        const missing = want.filter((c) => !have.has(c));
        if (!missing.length) return { pass: true, reason: `${f.name} has columns ${cols.join(', ')}.` };
        if (missing.length < bestMissing.length) bestMissing = missing;
      }
      return { pass: false, reason: `Missing column(s): ${bestMissing.join(', ')}.` };
    },
  },
  csv_min_rows: {
    help: 'csv_min_rows(100) — a CSV file has at least this many data rows',
    run(files, [n]) {
      const csvs = csvFiles(files);
      if (!csvs.length) return { pass: false, reason: 'No CSV file was submitted.' };
      const counts = csvs.map((f) => [f.name, parseCsv(f.text).rows.length]);
      const best = counts.sort((a, b) => b[1] - a[1])[0];
      return best[1] >= Number(n) ? { pass: true, reason: `${best[0]} has ${best[1]} rows.` } : { pass: false, reason: `Largest CSV has ${best[1]} rows; needs at least ${n}.` };
    },
  },
  csv_max_rows: {
    help: 'csv_max_rows(500) — every CSV file has at most this many data rows',
    run(files, [n]) {
      const csvs = csvFiles(files);
      if (!csvs.length) return { pass: false, reason: 'No CSV file was submitted.' };
      const over = csvs.find((f) => parseCsv(f.text).rows.length > Number(n));
      return over ? { pass: false, reason: `${over.name} has more than ${n} rows.` } : { pass: true, reason: `All CSVs have at most ${n} rows.` };
    },
  },
  csv_no_blank: {
    help: 'csv_no_blank(zip) — a CSV has this column and it has no blank values',
    run(files, [col]) {
      for (const f of csvFiles(files)) {
        const { columns, rows } = parseCsv(f.text);
        const i = columns.map(norm).indexOf(norm(col));
        if (i < 0) continue;
        const blanks = rows.filter((r) => !String(r[i] ?? '').trim()).length;
        return blanks ? { pass: false, reason: `${col} is blank in ${blanks} row(s) of ${f.name}.` } : { pass: true, reason: `${col} is filled in every row.` };
      }
      return { pass: false, reason: `No CSV has a ${col} column.` };
    },
  },
  csv_unique: {
    help: 'csv_unique(case_id) — values in this column are unique',
    run(files, [col]) {
      for (const f of csvFiles(files)) {
        const { columns, rows } = parseCsv(f.text);
        const i = columns.map(norm).indexOf(norm(col));
        if (i < 0) continue;
        const seen = new Set();
        let dupes = 0;
        for (const r of rows) { const v = r[i]; if (seen.has(v)) dupes++; seen.add(v); }
        return dupes ? { pass: false, reason: `${dupes} duplicate ${col} value(s) in ${f.name}.` } : { pass: true, reason: `Every ${col} is unique.` };
      }
      return { pass: false, reason: `No CSV has a ${col} column.` };
    },
  },
  json_valid: {
    help: 'json_valid() — every JSON file parses',
    run(files) {
      const js = jsonFiles(files);
      if (!js.length) return { pass: false, reason: 'No JSON file was submitted.' };
      for (const f of js) {
        try { JSON.parse(f.text); } catch (e) { return { pass: false, reason: `${f.name} isn't valid JSON (${e.message}).` }; }
      }
      return { pass: true, reason: `${js.length} JSON file(s) parse.` };
    },
  },
  json_keys: {
    help: 'json_keys(title, series) — a JSON object (or the first item of a JSON list) has these keys',
    run(files, keys) {
      const js = jsonFiles(files);
      if (!js.length) return { pass: false, reason: 'No JSON file was submitted.' };
      let missing = keys;
      for (const f of js) {
        let v;
        try { v = JSON.parse(f.text); } catch { continue; }
        const obj = Array.isArray(v) ? v[0] : v;
        if (!obj || typeof obj !== 'object') continue;
        const m = keys.filter((k) => !(k in obj));
        if (!m.length) return { pass: true, reason: `${f.name} has ${keys.join(', ')}.` };
        if (m.length < missing.length) missing = m;
      }
      return { pass: false, reason: `Missing key(s): ${missing.join(', ')}.` };
    },
  },
  word_count: {
    help: 'word_count(400, 600) — prose files (.md/.txt) total between min and max words',
    run(files, [min, max]) {
      const prose = proseFiles(files);
      if (!prose.length) return { pass: false, reason: 'No .md or .txt file was submitted.' };
      const n = prose.reduce((t, f) => t + wordCount(f.text), 0);
      const lo = Number(min) || 0;
      const hi = max === undefined ? Infinity : Number(max);
      if (n < lo) return { pass: false, reason: `${n} words; needs at least ${lo}.` };
      if (n > hi) return { pass: false, reason: `${n} words; the limit is ${hi}.` };
      return { pass: true, reason: `${n} words.` };
    },
  },
  contains: {
    help: 'contains("Methodology") — some text file contains this phrase (case-insensitive)',
    run(files, [phrase]) {
      const p = String(phrase || '').toLowerCase();
      const hit = textFiles(files).find((f) => f.text.toLowerCase().includes(p));
      return hit ? { pass: true, reason: `${hit.name} mentions “${phrase}”.` } : { pass: false, reason: `No file mentions “${phrase}”.` };
    },
  },
  has_heading: {
    help: 'has_heading("Sources") — a Markdown file has a heading containing this text',
    run(files, [phrase]) {
      const p = String(phrase || '').toLowerCase();
      const hit = proseFiles(files).find((f) => f.text.split('\n').some((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(p)));
      return hit ? { pass: true, reason: `${hit.name} has a “${phrase}” heading.` } : { pass: false, reason: `No Markdown heading mentions “${phrase}”.` };
    },
  },
  max_file_mb: {
    help: 'max_file_mb(2) — every file is at most this many megabytes',
    run(files, [mb]) {
      const lim = Number(mb) * 1024 * 1024;
      const big = files.find((f) => f.size > lim);
      return big ? { pass: false, reason: `${big.name} is larger than ${mb} MB.` } : { pass: true, reason: `All files are under ${mb} MB.` };
    },
  },
};

/**
 * Runs AUTO criteria against submitted files ({ name, size, text|null }).
 * @returns {{ results: {criterionId: string, pass: boolean, reason: string, rule: string}[], deferred: object[] }}
 */
export function runAutoChecks(criteria, files) {
  const results = [];
  const deferred = [];
  for (const c of criteria) {
    if (c.check !== 'AUTO') continue;
    const parsed = parseRule(c.rule);
    if (!parsed) { deferred.push(c); continue; }
    let r;
    try { r = RULES[parsed.name].run(files, parsed.args); } catch (e) { r = { pass: false, reason: `Check failed to run: ${e.message}` }; }
    results.push({ criterionId: c.id, pass: r.pass, reason: r.reason, rule: c.rule });
  }
  return { results, deferred };
}

export const RULE_HELP = Object.entries(RULES).map(([name, r]) => ({ name, help: r.help }));
