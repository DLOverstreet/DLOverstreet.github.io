// Reads the text out of Word (.docx), Excel (.xlsx) and PDF files in the browser, with no
// library: .docx and .xlsx are zip archives of XML, and a PDF's text is in its page content
// streams. The text lets the Scoping agent, the Decomposer and the agents read attachments
// that used to reach them as "binary file, not shown". Word's tracked changes are kept, marked
// {+inserted+} and [-deleted-], and its comments are listed at the end.

const EXTRACTABLE = /\.(docx|xlsx|pdf)$/i;

/** Whether text can be read from this file type. */
export function canExtract(name) {
  return EXTRACTABLE.test(String(name));
}

/** @param {Uint8Array} bytes @param {'deflate'|'deflate-raw'} format */
async function inflate(bytes, format) {
  const stream = new Blob([/** @type {any} */ (bytes)]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const utf8 = new TextDecoder('utf-8');

// ------------------------------------------------------------------ zip

/**
 * The entries of a zip archive, read lazily: name → () => Promise<bytes>.
 * @param {Uint8Array} bytes
 * @returns {Map<string, () => Promise<Uint8Array>>}
 */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data, 'deflate-raw');
      throw new Error(`unsupported zip compression ${method}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function zipText(zip, name) {
  const get = zip.get(name);
  return get ? utf8.decode(await get()) : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

/** Tags and the text between them, in order. */
function* xmlTokens(xml) {
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) yield { text: m[5] };
    else yield { close: !!m[1], tag: m[2], attrs: m[3], self: !!m[4] };
  }
}

const attr = (attrs, name) => new RegExp(`${name}="([^"]*)"`).exec(attrs || '')?.[1] ?? null;

// ------------------------------------------------------------------ docx

/**
 * Word document text as Markdown-ish lines: headings marked with #, list items with -, table
 * rows with | between cells, tracked insertions {+like this+} and deletions [-like this-],
 * comment anchors [comment 3], then footnotes and comments.
 */
async function docxText(zip) {
  const doc = await zipText(zip, 'word/document.xml');
  if (!doc) throw new Error('no word/document.xml');
  const body = wordBody(doc);
  const out = [body.text];
  const notes = await zipText(zip, 'word/footnotes.xml');
  if (notes) {
    const list = [...notes.matchAll(/<w:footnote\b([^>]*)>([\s\S]*?)<\/w:footnote>/g)]
      .filter(([, a]) => !/w:type="(separator|continuationSeparator)"/.test(a))
      .map(([, a, x]) => `[${attr(a, 'w:id')}] ${wordBody(x).text.replace(/\n+/g, ' ').trim()}`).filter((l) => l.length > 4);
    if (list.length) out.push('', '## Footnotes', '', ...list);
  }
  const comments = await zipText(zip, 'word/comments.xml');
  if (comments) {
    const list = [...comments.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)]
      .map(([, a, x]) => `[comment ${attr(a, 'w:id')}] ${attr(a, 'w:author') ? `${unescapeXml(attr(a, 'w:author'))}: ` : ''}${wordBody(x).text.replace(/\n+/g, ' ').trim()}`);
    if (list.length) out.push('', '## Comments in the document', '', ...list);
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), headings: body.headings, tracked: body.tracked, comments: comments ? (comments.match(/<w:comment\b/g) || []).length : 0 };
}

function wordBody(xml) {
  const lines = [];
  const headings = [];
  let para = '';
  let style = '';
  let list = false;
  let inText = false;
  let ins = 0;
  let del = 0;
  let cells = null;
  let tracked = 0;
  const push = (s) => {
    if (!s) return;
    if (ins) { para += `{+${s}+}`; tracked++; } else if (del) { para += `[-${s}-]`; tracked++; } else para += s;
  };
  for (const t of xmlTokens(xml)) {
    if (t.text !== undefined) { if (inText) push(unescapeXml(t.text)); continue; }
    const tag = t.tag;
    if (tag === 'w:t' || tag === 'w:delText') { inText = !t.close && !t.self; continue; }
    if (t.close) {
      if (tag === 'w:ins' || tag === 'w:moveTo') ins = Math.max(0, ins - 1);
      else if (tag === 'w:del' || tag === 'w:moveFrom') del = Math.max(0, del - 1);
      else if (tag === 'w:p') {
        // Tracked markers of adjacent runs merge: {+a+}{+b+} → {+ab+}.
        const text = para.replace(/\+\}\{\+/g, '').replace(/-\]\[-/g, '').trim();
        const level = /^heading(\d)$/i.exec(style)?.[1] || (/^title$/i.test(style) ? '1' : null);
        if (cells) cells.cur.push(text);
        else if (text) {
          if (level) { lines.push('', `${'#'.repeat(Math.min(6, Number(level)))} ${text}`, ''); headings.push(text); } else lines.push(list ? `- ${text}` : text);
        }
        para = ''; style = ''; list = false;
      } else if (tag === 'w:tc' && cells) { cells.row.push(cells.cur.join(' ').trim()); cells.cur = []; }
      else if (tag === 'w:tr' && cells) { lines.push(`| ${cells.row.join(' | ')} |`); cells.row = []; }
      else if (tag === 'w:tbl') { cells = null; lines.push(''); }
      continue;
    }
    if ((tag === 'w:ins' || tag === 'w:moveTo') && !t.self) ins++;
    else if ((tag === 'w:del' || tag === 'w:moveFrom') && !t.self) del++;
    else if (tag === 'w:pStyle') style = attr(t.attrs, 'w:val') || '';
    else if (tag === 'w:numPr') list = true;
    else if (tag === 'w:tab') push('\t');
    else if (tag === 'w:br' || tag === 'w:cr') push('\n');
    else if (tag === 'w:commentReference') para += ` [comment ${attr(t.attrs, 'w:id')}]`;
    else if (tag === 'w:footnoteReference') para += `[${attr(t.attrs, 'w:id')}]`;
    else if (tag === 'w:tbl') { cells = { row: [], cur: [] }; lines.push(''); }
  }
  return { text: lines.join('\n'), headings, tracked };
}

// ------------------------------------------------------------------ xlsx

const colIndex = (ref) => [...String(ref).replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Every sheet of a workbook as CSV under a "## Sheet: name" heading. */
async function xlsxText(zip) {
  const book = await zipText(zip, 'xl/workbook.xml');
  if (!book) throw new Error('no xl/workbook.xml');
  const rels = (await zipText(zip, 'xl/_rels/workbook.xml.rels')) || '';
  const target = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(([, a]) => [attr(a, 'Id'), attr(a, 'Target')]));
  const sharedXml = (await zipText(zip, 'xl/sharedStrings.xml')) || '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => unescapeXml([...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const sheets = [];
  const parts = [];
  for (const [, a] of book.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unescapeXml(attr(a, 'name') || 'Sheet');
    const rel = target.get(attr(a, 'r:id'));
    const path = rel ? (rel.startsWith('/') ? rel.slice(1) : `xl/${rel.replace(/^\.\//, '')}`) : null;
    const xml = path ? await zipText(zip, path) : null;
    if (!xml) continue;
    const rows = [];
    for (const [, r] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const [, ca, inner] of r.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = attr(ca, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner || '')?.[1];
        const value = type === 's' ? shared[Number(v)] ?? ''
          : type === 'inlineStr' ? unescapeXml([...(inner || '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''))
            : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
              : v !== undefined ? unescapeXml(v) : '';
        const ref = attr(ca, 'r');
        row[ref ? colIndex(ref) : row.length] = value;
      }
      if (row.some((x) => x)) rows.push(Array.from(row, (x) => x ?? ''));
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    sheets.push({ name, rows: Math.max(0, rows.length - 1), columns: rows[0] ? rows[0].filter(Boolean).slice(0, 30) : [] });
    parts.push(`## Sheet: ${name}`, '', ...rows.map((r) => [...r, ...Array(width - r.length).fill('')].map(csvCell).join(',')), '');
  }
  return { text: parts.join('\n').trim(), sheets };
}

// ------------------------------------------------------------------ pdf

const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return s; };

/** A PDF value parser, enough for dictionaries, arrays, names, numbers, strings and references. */
function parsePdfValue(s, i = 0) {
  const ws = () => { while (i < s.length) { if (/\s/.test(s[i])) i++; else if (s[i] === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; } else break; } };
  function value() {
    ws();
    const ch = s[i];
    if (ch === '<' && s[i + 1] === '<') {
      i += 2;
      const d = {};
      for (;;) {
        ws();
        if (s[i] === '>' && s[i + 1] === '>') { i += 2; return d; }
        if (s[i] !== '/') { i++; if (i >= s.length) return d; continue; }
        const k = value();
        d[k.name] = value();
      }
    }
    if (ch === '[') { i++; const a = []; for (;;) { ws(); if (s[i] === ']' || i >= s.length) { i++; return a; } a.push(value()); } }
    if (ch === '/') { const m = /^\/([^\s/<>[\]()%{}]*)/.exec(s.slice(i, i + 200)); i += m[0].length; return { name: m[1].replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) }; }
    if (ch === '(') { const r = pdfLiteral(s, i); i = r.end; return { str: r.str }; }
    if (ch === '<') { const end = s.indexOf('>', i); const hex = s.slice(i + 1, end).replace(/\s/g, ''); i = end + 1; return { str: hexBytes(hex) }; }
    const ref = /^(\d+)\s+(\d+)\s+R\b/.exec(s.slice(i, i + 40));
    if (ref) { i += ref[0].length; return { ref: Number(ref[1]) }; }
    const tok = /^[^\s/<>[\]()%]+/.exec(s.slice(i, i + 60));
    if (!tok) { i++; return null; }
    i += tok[0].length;
    const n = Number(tok[0]);
    return Number.isNaN(n) ? tok[0] : n;
  }
  const v = value();
  return { value: v, end: i };
}

function hexBytes(hex) {
  const h = hex.length % 2 ? `${hex}0` : hex;
  let out = '';
  for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
  return out;
}

/** A literal string starting at s[i] === '(': escapes, octal codes and balanced parentheses. */
function pdfLiteral(s, i) {
  let depth = 0;
  let out = '';
  let k = i;
  for (; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\') {
      const n = s[++k];
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      if (map[n] !== undefined) out += map[n];
      else if (/[0-7]/.test(n)) { const o = /^[0-7]{1,3}/.exec(s.slice(k, k + 3))[0]; out += String.fromCharCode(parseInt(o, 8)); k += o.length - 1; } else if (n === '\r' || n === '\n') { if (n === '\r' && s[k + 1] === '\n') k++; } else out += n;
    } else if (ch === '(') { if (depth++) out += ch; } else if (ch === ')') { if (--depth === 0) { k++; break; } out += ch; } else out += ch;
  }
  return { str: out, end: k };
}

/** A ToUnicode CMap: character codes (as byte strings) to text, and the code lengths it uses. */
function parseCMap(text) {
  const map = new Map();
  const lens = new Set();
  // Targets are UTF-16BE (surrogate pairs come through as two units); a one-byte target is a plain code.
  const uni = (hex) => {
    if (hex.length <= 2) return hex ? String.fromCharCode(parseInt(hex, 16)) : '';
    let o = '';
    for (let k = 0; k < hex.length; k += 4) o += String.fromCharCode(parseInt(hex.slice(k, k + 4).padEnd(4, '0'), 16));
    return o;
  };
  for (const [, block] of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) { map.set(hexBytes(src), uni(dst)); lens.add(src.length / 2); }
  }
  for (const [, block] of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const len = m[1].length / 2;
      lens.add(len);
      const code = (n) => hexBytes(n.toString(16).padStart(len * 2, '0'));
      if (m[3][0] === '[') {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => uni(x[1]));
        for (let n = lo; n <= hi && n - lo < items.length; n++) map.set(code(n), items[n - lo]);
      } else {
        const base = m[3].slice(1, -1);
        const start = parseInt(base.slice(-4), 16);
        const prefix = uni(base.slice(0, -4));
        for (let n = lo; n <= hi && n - lo < 65536; n++) map.set(code(n), prefix + String.fromCharCode(start + n - lo));
      }
    }
  }
  return { map, lens: [...lens].sort((a, b) => b - a) };
}

/**
 * Text shown in one page's content stream, one line per text line. Where the font's glyph widths
 * are known, the parser follows the text position, so a move that only kerns two letters ("Y" and
 * "our") joins them and a real gap becomes a space; without widths, every sideways move is a space.
 */
function contentText(stream, fonts) {
  const lines = [];
  let line = '';
  let font = null;
  let size = 12;
  let x = 0; // text position along the line, in text space
  let x0 = 0; // start of the current line (Td moves from here)
  let tm = null; // the last text matrix { a, e, f }
  /** @type {any[]} */
  const stack = [];
  const flush = () => { if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
  const space = () => { if (line && !/\s$/.test(line)) line += ' '; };
  const show = (str) => {
    const f = fonts.get(font) || {};
    const step = f.two ? 2 : 1;
    let out = '';
    if (f.cmap) {
      for (let k = 0; k < str.length;) {
        let hit = false;
        for (const len of f.cmap.lens) {
          const code = str.slice(k, k + len);
          if (code.length === len && f.cmap.map.has(code)) { out += f.cmap.map.get(code); k += len; hit = true; break; }
        }
        if (!hit) k += f.cmap.lens.length ? f.cmap.lens[f.cmap.lens.length - 1] : 1;
      }
    } else {
      // A simple font without a map: its codes are (near enough) Latin-1; control codes are dropped.
      out = [...str].filter((ch) => ch.charCodeAt(0) > 31 || ch === '\t').join('');
    }
    for (let k = 0; k + step <= str.length; k += step) {
      const code = step === 2 ? (str.charCodeAt(k) << 8) | str.charCodeAt(k + 1) : str.charCodeAt(k);
      x += ((f.widths?.get(code) ?? f.dw ?? 500) / 1000) * size;
    }
    line += out;
  };
  const moveTo = (nx, ny) => {
    const known = !!fonts.get(font)?.widths?.size;
    if (Math.abs(ny) > 0.5) { flush(); x0 += nx; x = x0; return; }
    const gap = x0 + nx - x;
    x0 += nx;
    x = x0;
    if (!known || gap > 0.2 * size) space();
  };
  const re = /\((?:\\[\s\S]|[^\\)(]|\((?:\\[\s\S]|[^\\)])*\))*\)|<[0-9a-fA-F\s]*>|\[|\]|\/[^\s/<>[\]()%]+|[-+]?\d*\.?\d+|[A-Za-z'"*]+[0-9]?|\S/g;
  let m;
  while ((m = re.exec(stream))) {
    const tok = m[0];
    if (tok[0] === '(') { stack.push({ str: pdfLiteral(tok, 0).str }); continue; }
    if (tok[0] === '<') { stack.push({ str: hexBytes(tok.slice(1, -1).replace(/\s/g, '')) }); continue; }
    if (tok === '[') { stack.push('['); continue; }
    if (tok === ']') { const arr = []; while (stack.length && stack[stack.length - 1] !== '[') arr.unshift(stack.pop()); stack.pop(); stack.push({ arr }); continue; }
    if (tok[0] === '/') { stack.push({ name: tok.slice(1) }); continue; }
    if (/^[-+]?\d*\.?\d+$/.test(tok)) { stack.push(Number(tok)); continue; }
    // An inline image's bytes aren't text: skip from ID to EI.
    if (tok === 'ID') { const ei = stream.indexOf('EI', re.lastIndex); if (ei > 0) re.lastIndex = ei + 2; stack.length = 0; continue; }
    const top = stack[stack.length - 1];
    switch (tok) {
      case 'Tf': font = stack[stack.length - 2]?.name ?? font; if (typeof top === 'number' && top) size = Math.abs(top); break;
      case 'Tj': if (top?.str !== undefined) show(top.str); break;
      case "'": case '"': flush(); x = x0; if (top?.str !== undefined) show(top.str); break;
      case 'TJ':
        for (const item of top?.arr || []) {
          if (typeof item === 'number') {
            const before = x;
            x -= (item / 1000) * size;
            if (x - before > 0.2 * size || (!fonts.get(font)?.widths?.size && item < -180)) space();
          } else if (item?.str !== undefined) show(item.str);
        }
        break;
      case 'T*': flush(); x = x0; break;
      case 'Td': case 'TD': moveTo(typeof stack[stack.length - 2] === 'number' ? stack[stack.length - 2] : 0, typeof top === 'number' ? top : 0); break;
      case 'Tm': {
        const [a, , , , e, f] = stack.slice(-6);
        if (typeof e !== 'number' || typeof f !== 'number') { flush(); break; }
        // Same baseline and further along it: the line goes on (a font change in mid-sentence).
        const end = tm ? tm.e + x * tm.a : null;
        if (tm && Math.abs(f - tm.f) < 0.5 && end !== null && e >= end - size * Math.abs(a || 1)) { if (e - end > 0.2 * size * Math.abs(a || 1)) space(); } else flush();
        tm = { a: typeof a === 'number' && a ? a : 1, e, f };
        x = 0; x0 = 0;
        break;
      }
      case 'BT': x = 0; x0 = 0; break;
      default: break;
    }
    if (/^[A-Za-z'"*]/.test(tok)) stack.length = 0;
  }
  flush();
  return lines;
}

/** Glyph widths per character code: a simple font's Widths from FirstChar, a CID font's W array. */
function fontWidths(f, get) {
  const widths = new Map();
  if (f?.Subtype?.name === 'Type0') {
    const d = get((get(f.DescendantFonts) || [])[0]) || {};
    const w = get(d.W) || [];
    for (let k = 0; k < w.length;) {
      const first = w[k];
      const next = get(w[k + 1]);
      if (Array.isArray(next)) { next.forEach((v, j) => widths.set(first + j, v)); k += 2; } else { for (let c = first; c <= next; c++) widths.set(c, w[k + 2]); k += 3; }
    }
    return { two: true, widths, dw: typeof d.DW === 'number' ? d.DW : 1000 };
  }
  const first = typeof f?.FirstChar === 'number' ? f.FirstChar : 0;
  (get(f?.Widths) || []).forEach((v, j) => { if (typeof v === 'number') widths.set(first + j, v); });
  return { two: false, widths, dw: 500 };
}

/** A PDF's text, page by page. Encrypted files and scanned pages (images only) give no text. */
async function pdfText(bytes) {
  const s = latin1(bytes);
  if (/\/Encrypt\s/.test(s.slice(-4096)) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(s)) throw new Error('the PDF is encrypted');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const { value } = parsePdfValue(body);
    const si = body.search(/\bstream\r?\n/);
    let stream = null;
    if (si >= 0 && value && typeof value === 'object') {
      const from = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      let len = typeof value.Length === 'number' ? value.Length : -1;
      if (len < 0 || s.slice(from + len, from + len + 12).trim().slice(0, 9) !== 'endstream') {
        // An indirect or wrong /Length: the data runs to "endstream", less the line break before it.
        let e = s.indexOf('endstream', from);
        while (e > from && (s[e - 1] === '\n' || s[e - 1] === '\r')) e--;
        len = e - from;
      }
      stream = bytes.subarray(from, from + Math.max(0, len));
    }
    objs.set(Number(m[1]), { dict: value, stream });
    re.lastIndex = end;
  }
  const get = (v) => (v && v.ref !== undefined ? objs.get(v.ref)?.dict : v);
  const data = async (o) => {
    if (!o?.stream) return '';
    const filters = [].concat(o.dict.Filter || []).map((f) => f.name);
    let b = o.stream;
    for (const f of filters) {
      if (f === 'FlateDecode') b = await inflate(b, 'deflate');
      else return '';
    }
    return latin1(b);
  };
  // Objects packed in object streams (PDF 1.5 and later).
  for (const o of [...objs.values()]) {
    if (o.dict?.Type?.name !== 'ObjStm') continue;
    const text = await data(o).catch(() => '');
    const head = text.slice(0, o.dict.First).trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < head.length; k += 2) {
      if (!objs.has(head[k])) objs.set(head[k], { dict: parsePdfValue(text, o.dict.First + head[k + 1]).value, stream: null });
    }
  }
  // Pages in reading order, from the catalog's page tree.
  const pages = [];
  const walk = (node, seen = new Set()) => {
    const d = get(node);
    if (!d || seen.has(d)) return;
    seen.add(d);
    if (d.Type?.name === 'Page') { pages.push(d); return; }
    for (const kid of d.Kids || []) walk(kid, seen);
  };
  const catalog = [...objs.values()].find((o) => o.dict?.Type?.name === 'Catalog');
  if (catalog) walk(catalog.dict.Pages);
  if (!pages.length) for (const o of objs.values()) if (o.dict?.Type?.name === 'Page') pages.push(o.dict);
  const cmaps = new Map();
  const out = [];
  // Resources may sit on a parent node of the page tree.
  const resourcesOf = (page) => { for (let d = page, k = 0; d && k < 20; d = get(d.Parent), k++) if (d.Resources) return get(d.Resources) || {}; return {}; };
  for (const [n, page] of pages.entries()) {
    const res = resourcesOf(page);
    const fontDict = get(res.Font) || {};
    const fonts = new Map();
    for (const [name, ref] of Object.entries(fontDict)) {
      const f = get(ref);
      const tu = f?.ToUnicode;
      if (tu?.ref !== undefined && !cmaps.has(tu.ref)) cmaps.set(tu.ref, parseCMap(await data(objs.get(tu.ref)).catch(() => '')));
      fonts.set(name, { ...fontWidths(f, get), ...(tu?.ref !== undefined ? { cmap: cmaps.get(tu.ref) } : {}) });
    }
    const c0 = page.Contents;
    const refs = Array.isArray(c0) ? c0 : c0?.ref !== undefined && Array.isArray(objs.get(c0.ref)?.dict) ? objs.get(c0.ref).dict : c0 ? [c0] : [];
    const contents = refs.map((c) => (c?.ref !== undefined ? objs.get(c.ref) : null)).filter(Boolean);
    let stream = '';
    for (const c of contents) stream += `${await data(c).catch(() => '')}\n`;
    const lines = contentText(stream, fonts);
    if (lines.length) out.push(`--- Page ${n + 1} ---`, ...lines, '');
  }
  return { text: out.join('\n').trim(), pages: pages.length };
}

// ------------------------------------------------------------------ entry point

/**
 * The text of a .docx, .xlsx or .pdf file, or null when there is none to read (a scanned PDF,
 * an encrypted file, a damaged archive). `info` says what was found.
 * @param {string} name
 * @param {Uint8Array} bytes
 * @returns {Promise<{ text: string, info: any } | null>}
 */
export async function extractText(name, bytes) {
  const ext = String(name).split('.').pop().toLowerCase();
  try {
    if (ext === 'docx') { const r = await docxText(readZip(bytes)); return r.text ? { text: r.text, info: { from: 'docx', headings: r.headings.slice(0, 40), trackedChanges: r.tracked, comments: r.comments } } : null; }
    if (ext === 'xlsx') { const r = await xlsxText(readZip(bytes)); return r.text ? { text: r.text, info: { from: 'xlsx', sheets: r.sheets } } : null; }
    if (ext === 'pdf') { const r = await pdfText(bytes); return r.text.replace(/--- Page \d+ ---/g, '').trim().length > 20 ? { text: r.text, info: { from: 'pdf', pages: r.pages } } : null; }
  } catch (e) {
    return { text: '', info: { from: ext, error: String(e.message || e) } };
  }
  return null;
}
