// Writes a Word (.docx) copy of a Markdown document, with no library: headings, paragraphs,
// lists, quotes, tables, bold, italic, code and links. Text marked {+inserted+} or [-deleted-]
// (the marks the text reader uses for Word's tracked changes) becomes real tracked changes, so
// a marked-up revision opens in Word ready to accept or reject.
import { createZip } from './zip.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = new TextEncoder();

let changeId = 0;
const STAMP = '2026-01-01T00:00:00Z';

/** Runs for one line of inline Markdown: **bold**, *italic*, `code`, [links](url), {+ins+}, [-del-]. */
function runs(text, { author = 'Tessera' } = {}) {
  const out = [];
  const re = /\{\+([\s\S]*?)\+\}|\[-([\s\S]*?)-\]|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m;
  const run = (t, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(run(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push(`<w:ins w:id="${++changeId}" w:author="${esc(author)}" w:date="${STAMP}">${run(m[1])}</w:ins>`);
    else if (m[2] !== undefined) out.push(`<w:del w:id="${++changeId}" w:author="${esc(author)}" w:date="${STAMP}"><w:r><w:delText xml:space="preserve">${esc(m[2])}</w:delText></w:r></w:del>`);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(run(m[3] ?? m[4], '<w:b/>'));
    else if (m[5] !== undefined || m[6] !== undefined) out.push(run(m[5] ?? m[6], '<w:i/>'));
    else if (m[7] !== undefined) out.push(run(m[7], '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'));
    else out.push(run(`${m[8]} (${m[9]})`));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(run(text.slice(last)));
  return out.join('');
}

const para = (inner, style = null) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;

function table(rows) {
  const cells = rows.map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
  const width = Math.max(...cells.map((r) => r.length));
  const border = '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${border}</w:tblPr>${cells.map((r, i) => `<w:tr>${Array.from({ length: width }, (_, j) => `<w:tc>${para(i === 0 && r[j] ? runs(`**${r[j]}**`) : runs(r[j] ?? ''))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}

/** The body XML for a Markdown document. */
export function markdownBody(md, opts = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) { out.push(para(runs(buf.join(' '), opts))); buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(para(runs(h[2].replace(/\s+#+\s*$/, ''), opts), `Heading${Math.min(3, h[1].length)}`)); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i]); i++; }
      i--;
      if (rows.length) out.push(table(rows));
      continue;
    }
    const li = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) { flush(); out.push(para(runs(`${li[1] ? `${li[1]}. ` : '• '}${li[2]}`, opts), 'ListParagraph')); continue; }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { flush(); out.push(para(runs(q[1], opts), 'Quote')); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); continue; }
    if (!line.trim()) { flush(); continue; }
    buf.push(line.trim());
  }
  flush();
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;

/**
 * A .docx file for a Markdown document.
 * @param {string} md
 * @param {{ author?: string }} [opts] author: whose name tracked changes carry
 * @returns {Uint8Array}
 */
export function markdownToDocx(md, opts = {}) {
  const body = markdownBody(md, opts);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return createZip([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(doc) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'word/styles.xml', data: enc.encode(STYLES) },
  ]);
}
