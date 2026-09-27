// Redaction for RESTRICTED commissions: personal data is masked or replaced with
// synthetic stand-ins before any excerpt reaches a tile, a brief or a model prompt.
import { parseCsv, toCsv } from './csv.js';

/** @type {[RegExp, string][]} */
const PATTERNS = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]'],
  [/\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court)\b\.?/g, '[address]'],
];

export function redactText(text) {
  let t = String(text ?? '');
  for (const [re, rep] of PATTERNS) t = t.replace(re, rep);
  return t;
}

const SENSITIVE_COLUMN = /(^|_|\b)(name|first|last|email|phone|ssn|address|street|dob|birth|tenant|respondent|defendant|plaintiff)(_|\b|$)/i;

/** Replaces sensitive CSV columns with synthetic values and masks free text in the rest. */
export function redactCsv(text, extraColumns = []) {
  const { columns, rows } = parseCsv(text);
  const extra = new Set(extraColumns.map((c) => c.toLowerCase()));
  const sensitive = columns.map((c) => SENSITIVE_COLUMN.test(c) || extra.has(c.toLowerCase()));
  const out = rows.map((r, i) => r.map((v, j) => (sensitive[j] ? `${columns[j]}_${String(i + 1).padStart(3, '0')}` : redactText(v))));
  return { text: toCsv(columns, out), redactedColumns: columns.filter((_, j) => sensitive[j]) };
}
