// Minimal RFC 4180 CSV reading and writing, enough for AUTO checks and generated samples.

/**
 * Parse CSV text into { columns, rows } where rows are arrays of strings.
 * @param {string} text
 * @param {{ delimiter?: string }} [opts]
 */
export function parseCsv(text, { delimiter } = {}) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const delim = delimiter || (src.split('\n', 1)[0].includes('\t') && !src.split('\n', 1)[0].includes(',') ? '\t' : ',');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  const [header = [], ...rows] = records;
  return { columns: header.map((h) => h.trim()), rows };
}

function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  return [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
}
