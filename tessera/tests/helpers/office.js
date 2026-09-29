// Word and Excel files built in tests: zip archives of XML with deflated entries, as Office writes them.
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../src/lib/zip.js';

/** A zip archive with deflated entries, as Word and Excel write them. */
export function makeZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = enc.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 8, true);
    dv.setUint32(14, crc32(raw), true); dv.setUint32(18, data.length, true); dv.setUint32(22, raw.length, true); dv.setUint16(26, n.length, true);
    local.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(raw), true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    c.set(n, 46);
    parts.push(local, data);
    central.push(c);
    offset += local.length + data.length;
  }
  const size = central.reduce((k, c) => k + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((k, p) => k + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
export const docxBytes = () => makeZip({
  'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run('Policy Feedback and State Adoption')}</w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run('Introduction')}</w:p>
    <w:p>${run('States adopt policies ')}<w:del w:id="1" w:author="D"><w:r><w:delText>quickly</w:delText></w:r></w:del><w:ins w:id="2" w:author="D">${run('gradually')}</w:ins>${run(' when neighbors do &amp; costs fall.')}<w:r><w:commentReference w:id="0"/></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>${run('Adoption rose 12.4 percent.')}</w:p>
    <w:tbl><w:tr><w:tc><w:p>${run('State')}</w:p></w:tc><w:tc><w:p>${run('Year')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('Arizona')}</w:p></w:tc><w:tc><w:p>${run('2014')}</w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`,
  'word/comments.xml': `<w:comments ${W}><w:comment w:id="0" w:author="Spiro Maroulis"><w:p>${run('Cite the diffusion literature here.')}</w:p></w:comment></w:comments>`,
  'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p>${run('----')}</w:p></w:footnote><w:footnote w:id="1"><w:p>${run('Data from the NCSL database.')}</w:p></w:footnote></w:footnotes>`,
});

