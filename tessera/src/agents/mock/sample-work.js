// The simulated contributor. Given a tile, it writes files that satisfy the tile's AUTO
// rules (the right columns, row counts, word counts, headings and formats) and read like
// plausible work. The crowd simulation and the "fill with sample work" demo button use it.
// With quality "bad" it produces thin work that fails review, to exercise revisions.
import { parseRule } from '../../domain/autochecks.js';
import { prng, fileExt } from '../../lib/util.js';
import { toCsv } from '../../lib/csv.js';

const EN = [
  'This part of the work follows the spec line by line and keeps every name the downstream tiles expect.',
  'Each step was checked against the acceptance criteria before moving on.',
  'Where the source was ambiguous, the choice made is written down here so a reviewer can follow it.',
  'The numbers below come straight from the input files and can be recomputed from them.',
  'Nothing in this file identifies a person; sensitive fields were dropped or masked at the start.',
  'The approach favors plain language so a reader without a technical background can follow it.',
  'Edge cases were handled explicitly rather than silently dropped, and each one is counted.',
  'A second pass compared the output with the input to confirm that no rows were lost.',
  'The limits of the data are stated plainly so readers don’t read more into it than it supports.',
  'Anyone can rerun this work from the inputs using the steps described in the approach section.',
];
const ES = [
  'Esta parte del trabajo sigue la especificación punto por punto y conserva los nombres que esperan las otras piezas.',
  'Cada paso se revisó contra los criterios de aceptación antes de continuar.',
  'Cuando la fuente era ambigua, la decisión tomada queda escrita aquí para que la revisión pueda seguirla.',
  'El texto usa un español claro y sencillo, pensado para cualquier lector.',
  'Los términos del glosario se usan de la misma manera en todo el documento.',
  'Nada en este archivo identifica a una persona; los datos sensibles se quitaron al inicio.',
  'Las cifras vienen directamente de los archivos de entrada y se pueden volver a calcular.',
  'Los límites de los datos se explican con claridad para no sacar conclusiones de más.',
];

function requirements(tile) {
  const req = { exts: [], csvColumns: [], minRows: 0, maxRows: Infinity, jsonKeys: [], json: false, words: null, contains: [], headings: [], minFiles: 1, uniques: [] };
  for (const c of tile.acceptanceCriteria || []) {
    if (c.check !== 'AUTO' || !c.rule) continue;
    const r = parseRule(c.rule);
    if (!r) continue;
    const a = r.args;
    switch (r.name) {
      case 'file_ext': req.exts.push(a[0].toLowerCase()); break;
      case 'csv_columns': for (const col of a) if (!req.csvColumns.includes(col)) req.csvColumns.push(col); break;
      case 'csv_min_rows': req.minRows = Math.max(req.minRows, Number(a[0]) || 0); break;
      case 'csv_max_rows': req.maxRows = Math.min(req.maxRows, Number(a[0]) || Infinity); break;
      case 'csv_no_blank': case 'csv_unique': if (!req.csvColumns.includes(a[0])) req.csvColumns.push(a[0]); break;
      case 'json_valid': req.json = true; break;
      case 'json_keys': req.json = true; req.jsonKeys.push(...a); break;
      case 'word_count': req.words = [Number(a[0]) || 0, a[1] === undefined ? Number(a[0]) * 2 || 400 : Number(a[1])]; break;
      case 'contains': req.contains.push(a[0]); break;
      case 'has_heading': req.headings.push(a[0]); break;
      case 'min_files': req.minFiles = Math.max(req.minFiles, Number(a[0]) || 1); break;
      default: break;
    }
  }
  return req;
}

function nameFromFormat(tile, ext, fallback) {
  const m = new RegExp(`([A-Za-z0-9_.-]+\\.${ext})\\b`).exec(tile.deliverableFormat || '');
  return m ? m[1] : fallback;
}

function cellFor(col, i, rnd) {
  const c = col.toLowerCase();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  if (/(^|_)id$|_id$/.test(c)) return `${c.replace(/_?id$/, '').slice(0, 3).toUpperCase() || 'ID'}-${String(1000 + i)}`;
  if (/date/.test(c)) { const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000 * 3); return d.toISOString().slice(0, 10); }
  if (/^zip/.test(c)) return String(85001 + Math.floor(rnd() * 90));
  if (c === 'lat') return (33.3 + rnd() * 0.4).toFixed(5);
  if (c === 'lon') return (-112.3 + rnd() * 0.5).toFixed(5);
  if (/tract/.test(c)) return `04013${String(100000 + Math.floor(rnd() * 90000))}`;
  if (/case_type/.test(c)) return pick(['EV', 'EVR', 'SC', 'CV', 'EVN']);
  if (/is_|flag/.test(c)) return pick(['yes', 'no']);
  if (/year/.test(c)) return String(2015 + (i % 10));
  if (/value|rate|count|filings|amount/.test(c)) return String(Math.round(rnd() * 900) + 10);
  if (/decision/.test(c)) return pick(['include', 'exclude']);
  if (/^code$/.test(c)) return pick(['HOUSING_COST', 'REPAIRS', 'LANDLORD', 'SAFETY', 'OTHER', 'TRANSIT', 'NEIGHBORS', 'SERVICES']);
  if (/term_en/.test(c)) return pick(['lease', 'deposit', 'eviction notice', 'court date', 'rent relief', 'landlord', 'tenant rights', 'application', 'income limit', 'caseworker', 'library card', 'proof of address']) + (i > 11 ? ` ${i}` : '');
  if (/term_es/.test(c)) return pick(['contrato de arrendamiento', 'depósito', 'aviso de desalojo', 'fecha de corte', 'ayuda con la renta', 'arrendador', 'derechos del inquilino', 'solicitud', 'límite de ingresos', 'trabajador social', 'tarjeta de biblioteca', 'comprobante de domicilio']);
  if (/url/.test(c)) return `https://example.org/item/${i + 1}`;
  if (/title/.test(c)) return pick(['Right to counsel and eviction outcomes', 'Emergency rental assistance in practice', 'Housing court filings over time', 'Tenant protections at the city level']);
  if (/source/.test(c)) return pick(['Journal of Housing Economics', 'Urban Affairs Review', 'County court records', 'Census ACS']);
  if (/measure/.test(c)) return pick(['filings', 'judgments', 'households']);
  if (/design/.test(c)) return pick(['difference-in-differences', 'cohort', 'case study', 'RCT']);
  if (/sample|setting|finding|description|definition|example|label|note|reason/.test(c)) return pick(['clear and complete', 'see memo for detail', 'consistent with the court code list', 'applies to most residential cases', 'checked against the source']);
  if (/match_quality/.test(c)) return pick(['Exact', 'Non_Exact']);
  return `${col}-${i + 1}`;
}

function svgChart(title, rnd) {
  const bars = Array.from({ length: 8 }, () => 20 + Math.round(rnd() * 120));
  const rects = bars.map((h, i) => `<rect x="${40 + i * 44}" y="${180 - h}" width="30" height="${h}" fill="#1f5f9e"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 220" role="img" aria-label="${title}"><title>${title}</title><text x="10" y="20" font-family="sans-serif" font-size="14">${title}</text>${rects}<line x1="30" y1="180" x2="400" y2="180" stroke="#333"/></svg>\n`;
}

function prose(tile, req, rnd, { spanish, bad }) {
  const pool = spanish ? ES : EN;
  // Walk the sentence pool in a shuffled order so paragraphs don't repeat themselves.
  const order = pool.map((_, i) => i).sort(() => rnd() - 0.5);
  let cursor = 0;
  const next = () => order[cursor++ % order.length];
  const [lo, hi] = req.words || [220, 320];
  const target = bad ? 30 : Math.round((lo + hi) / 2);
  const lines = [`# ${tile.title}`, ''];
  const specLines = tile.spec.replace(/^Context:[^\n]*\n\n?/, '').split(/(?<=[.])\s+/).slice(0, 3);
  lines.push('## Summary', '', ...specLines, '');
  for (const c of req.contains) if (!/^(#|findings)/i.test(c)) lines.push(`${c}: covered below.`, '');
  const sectionNames = ['Approach', ...req.headings.filter((h) => !/sources/i.test(h)), ...(req.contains.some((c) => /findings/i.test(c)) ? ['Findings'] : [])];
  let words = lines.join(' ').split(/\s+/).length;
  let si = 0;
  const reserve = req.headings.some((h) => /sources/i.test(h)) ? 30 : 0;
  for (const name of sectionNames) {
    lines.push(`## ${name}`, '');
    if (name === 'Findings') lines.push('- Row counts match between input and output: pass.', '- No duplicate identifiers: pass.', '- Dates fall inside the expected range: pass.', '');
    const para = [];
    const share = Math.max(20, Math.floor((target - words - reserve) / Math.max(1, sectionNames.length - si)));
    let pw = 0;
    while (pw < share && !bad) { const s = pool[next() % pool.length]; para.push(s); pw += s.split(/\s+/).length; }
    lines.push(para.join(' '), '');
    words += pw + 2;
    si++;
  }
  for (const h of req.headings) if (/sources/i.test(h)) lines.push(`## ${h}`, '', '- County court public calendar, retrieved for this commission.', '- U.S. Census Bureau, American Community Survey 5-year estimates.', '');
  let text = lines.join('\n');
  if (req.words && !bad) {
    // Trim or pad to land inside the word range.
    let n = text.split(/\s+/).filter(Boolean).length;
    while (n > hi) { text = text.replace(/ [^ \n]+(\n*)$/, '$1'); n--; }
    let k = 0;
    while (n < lo) { const s = pool[k++ % pool.length]; text += `\n${s}`; n += s.split(/\s+/).length; }
  }
  return text + '\n';
}

/**
 * @returns {{ files: {name: string, text: string}[], notes: string, minutesSpent: number, checklist: Record<string, boolean> }}
 */
export function generateSampleWork(tile, { seed = tile.id || tile.key, quality = 'good', upstreamFiles = [] } = {}) {
  const rnd = prng(`${seed}:${quality}`);
  const req = requirements(tile);
  const bad = quality === 'bad';
  const spanish = (tile.languages || []).includes('es');
  const files = [];
  const exts = new Set(req.exts);
  const wantsCsv = req.csvColumns.length || exts.has('csv');
  if (wantsCsv) {
    let cols = req.csvColumns.length ? [...req.csvColumns] : ['id', 'value', 'note'];
    const rows = Math.min(req.maxRows, Math.max(req.minRows || 12, 12));
    if (bad) cols = cols.slice(0, Math.max(1, cols.length - 1));
    const data = Array.from({ length: bad ? Math.min(rows, 5) : rows }, (_, i) => cols.map((c) => cellFor(c, i, rnd)));
    files.push({ name: nameFromFormat(tile, 'csv', `${tile.key}.csv`), text: toCsv(cols, data) });
  }
  if (exts.has('py') || exts.has('r') || exts.has('sql')) {
    const ext = exts.has('py') ? 'py' : exts.has('r') ? 'r' : 'sql';
    const comment = ext === 'sql' ? '--' : '#';
    files.push({ name: nameFromFormat(tile, ext, `${tile.key}.${ext}`), text: `${comment} ${tile.title}\n${comment} Source URL: https://example.gov/public-records\n${comment} How to rerun: python ${tile.key}.py > output.csv\n${ext === 'py' ? 'import csv\n\ndef main():\n    """Reads the input, applies the rules in the spec and writes the output."""\n    pass\n\nif __name__ == "__main__":\n    main()\n' : ''}` });
  }
  if (exts.has('js') || exts.has('ts')) {
    const ext = exts.has('js') ? 'js' : 'ts';
    const name = nameFromFormat(tile, ext, `${tile.key}.${ext}`);
    files.push({ name, text: `// ${tile.title}\n// Implements this tile's part of the shared contract; see the README section in the notes.\nexport function handler(input = {}) {\n  if (!input || typeof input !== 'object') throw new Error('Invalid input');\n  return { ok: true, ...input };\n}\n` });
    if (req.minFiles > 1) files.push({ name: name.replace(new RegExp(`\\.${ext}$`), `.test.${ext}`), text: `// Tests for ${tile.title}\nimport assert from 'node:assert/strict';\nimport { handler } from './${name}';\nassert.deepEqual(handler({ a: 1 }), { ok: true, a: 1 });\n` });
  }
  if (exts.has('svg')) files.push({ name: nameFromFormat(tile, 'svg', `${tile.key}.svg`), text: svgChart(tile.title, rnd) });
  if (req.json || exts.has('json')) {
    const obj = { title: `${tile.title}: filings rose through the year`, source: 'County court public calendar' };
    for (const k of req.jsonKeys) {
      if (k in obj) continue;
      obj[k] = k === 'series' ? Array.from({ length: 6 }, (_, i) => ({ x: `2025-0${i + 1}`, y: Math.round(rnd() * 300) })) : k === 'colors' ? ['#16293f', '#1f5f9e', '#e3e7ed'] : k === 'fonts' ? ['Inter'] : `${k} value`;
    }
    if (bad && req.jsonKeys.length) delete obj[req.jsonKeys[req.jsonKeys.length - 1]];
    files.push({ name: nameFromFormat(tile, 'json', `${tile.key}.json`), text: JSON.stringify(obj, null, 2) + '\n' });
  }
  if (exts.has('html') && !(exts.has('md') && req.exts[0] === 'md')) {
    const extra = req.contains.map((c) => `<p>${c}: see the linked section.</p>`).join('\n');
    files.push({ name: nameFromFormat(tile, 'html', 'index.html'), text: `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${tile.title}</title></head>\n<body><main><h1>${tile.title}</h1>\n<p>${tile.deliverableFormat}</p>\n${extra}\n<section id="methodology"><h2>Methodology</h2><p>How this was built and where the data comes from.</p></section></main></body></html>\n` });
  }
  const needsProse = req.words || req.headings.length || req.contains.length || exts.has('md') || exts.has('txt') || !files.length;
  if (needsProse) {
    const mdName = nameFromFormat(tile, 'md', `${tile.key}.md`);
    files.push({ name: mdName, text: prose(tile, req, rnd, { spanish, bad }) });
  }
  const other = req.exts.find((e) => ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx'].includes(e));
  if (other && !files.some((f) => req.exts.includes(fileExt(f.name)))) files.push({ name: `${tile.key}.txt`, text: `Placeholder for the ${other} deliverable.\n` });
  while (files.length < req.minFiles) files.push({ name: `notes-${files.length}.md`, text: `# Notes\n\nSupporting notes for ${tile.title}.\n` });
  const minutesSpent = Math.max(5, Math.round((tile.estMinutes || 30) * (0.8 + rnd() * 0.6)));
  return {
    files,
    notes: bad
      ? 'Rushed first pass; some parts are incomplete. [deliberate-fail]'
      : `Completed per the spec${upstreamFiles.length ? ` using ${upstreamFiles.slice(0, 3).join(', ')}` : ''}. Checked every criterion before submitting.`,
    minutesSpent,
    checklist: Object.fromEntries((tile.acceptanceCriteria || []).map((c) => [c.id, !bad])),
  };
}

/**
 * A simulated peer reviewer's verdicts on another contributor's submission. Submissions only
 * reach a person after passing the automatic and LLM checks, so the reviewer agrees with
 * those; criteria only a person can judge (PEER) occasionally fail.
 */
export function generatePeerVerdicts(targetTile, { seed = targetTile.id, strict = false } = {}) {
  const rnd = prng(`peer:${seed}`);
  return (targetTile.acceptanceCriteria || []).map((c) => {
    const pass = strict ? rnd() > 0.5 : c.check === 'PEER' ? rnd() > 0.1 : true;
    return {
      criterionId: c.id,
      pass,
      reason: pass
        ? (c.check === 'PEER' ? 'Checked by hand at phone and desktop width; it reads clearly.' : 'Confirmed against the submitted files.')
        : `Not met: ${c.text.toLowerCase()} — please revise this part.`,
    };
  });
}
