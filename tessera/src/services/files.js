// File storage for uploads, submissions and deliverables, with the summaries and text
// excerpts that go into prompts. Restricted commissions get redacted excerpts only.
import { isTextFile, bytesToText, textToBytes, mimeFor, fileExt, hashString } from '../lib/util.js';
import { canExtract, extractText } from '../lib/extract.js';
import { parseCsv } from '../lib/csv.js';
import { redactText, redactCsv } from '../lib/redact.js';

let uploadSeq = 0;

/**
 * Stores files ({ name, bytes } or { name, text }) under a prefix and returns their refs.
 * @returns {Promise<any[]>}
 */
export async function storeFiles(T, prefix, files) {
  const refs = [];
  const used = new Set();
  for (const f of files) {
    const bytes = f.bytes ? new Uint8Array(f.bytes) : textToBytes(f.text ?? '');
    let name = String(f.name || 'file').replace(/[/\\]/g, '_').slice(0, 120);
    while (used.has(name)) name = name.replace(/(\.[a-z0-9]+)?$/i, (m) => `-2${m}`);
    used.add(name);
    uploadSeq += 1;
    const key = `${prefix}/${(Date.now() + uploadSeq).toString(36)}${hashString(name + uploadSeq).toString(36).slice(0, 4)}/${name}`;
    await T.blobs.put(key, bytes);
    const ref = { name, size: bytes.length, type: f.type || mimeFor(name), key };
    // Word, Excel and PDF files get their text read out and kept beside them, so prompts can show it.
    if (canExtract(name)) {
      const got = await extractText(name, bytes);
      if (got?.text) {
        await T.blobs.put(`${key}.txt`, textToBytes(got.text));
        Object.assign(ref, { textKey: `${key}.txt`, textChars: got.text.length, extracted: got.info });
      } else {
        ref.extracted = { ...(got?.info || { from: fileExt(name) }), none: true };
      }
    }
    refs.push(ref);
  }
  return refs;
}

/** Whether a stored file has text to show: a text format, or text read out of a Word, Excel or PDF file. */
export function hasText(ref) {
  return isTextFile(ref.name) || !!ref.textKey;
}

export async function readFileText(T, ref, { maxChars = 200000 } = {}) {
  if (!hasText(ref)) return null;
  const bytes = await T.blobs.get(isTextFile(ref.name) ? ref.key : ref.textKey);
  if (!bytes) return null;
  return bytesToText(bytes).slice(0, maxChars);
}

/** Loads refs as { name, size, text } for AUTO checks and prompts. */
export async function loadFileTexts(T, refs, opts) {
  const out = [];
  for (const r of refs || []) out.push({ name: r.name, size: r.size, text: await readFileText(T, r, opts) });
  return out;
}

export function summarizeText(name, text, { restricted = false, sensitiveColumns = [] } = {}) {
  const ext = fileExt(name);
  if (ext === 'csv' || ext === 'tsv') {
    const src = restricted ? redactCsv(text, sensitiveColumns).text : text;
    const { columns, rows } = parseCsv(src);
    return { kind: 'table', columns, rowCount: rows.length, sample: rows.slice(0, 3), redacted: restricted };
  }
  const t = restricted ? redactText(text) : text;
  return { kind: 'text', excerpt: t.slice(0, 600), words: (t.match(/\S+/g) || []).length, redacted: restricted };
}

export function summarizeUpload(name, bytes, opts) {
  if (isTextFile(name)) return summarizeText(name, bytesToText(bytes), opts);
  return { kind: 'binary', type: mimeFor(name), size: bytes.length };
}

/**
 * A stored file's summary for prompts. A Word, Excel or PDF file whose text was read out is a
 * "document": its length, headings or sheets, tracked changes and comments, and the opening text.
 */
export async function summarizeStored(T, ref, bytes, { restricted = false } = {}) {
  if (!ref.textKey) {
    const base = summarizeUpload(ref.name, bytes, { restricted });
    return ref.extracted?.none ? { ...base, note: ref.extracted.error ? `Its text couldn't be read (${ref.extracted.error}).` : 'No text found in it (a scanned or image-only file?).' } : base;
  }
  const raw = (await readFileText(T, ref)) || '';
  const text = restricted ? redactText(raw) : raw;
  const x = ref.extracted || {};
  return {
    kind: 'document', from: x.from, type: mimeFor(ref.name), words: (text.match(/\S+/g) || []).length, excerpt: text.slice(0, 1200),
    ...(x.headings?.length ? { headings: x.headings } : {}), ...(x.sheets ? { sheets: x.sheets } : {}), ...(x.pages ? { pages: x.pages } : {}),
    ...(x.trackedChanges ? { trackedChanges: x.trackedChanges } : {}), ...(x.comments ? { comments: x.comments } : {}), redacted: restricted,
  };
}

/** A short excerpt of a file for a prompt, redacted when the commission is restricted. */
export function excerptFor(file, { restricted = false, max = 6000 } = {}) {
  if (typeof file.text !== 'string') return `(${fileExt(file.name) || 'binary'} file, ${file.size} bytes, not shown)`;
  const t = restricted ? (/\.(csv|tsv)$/i.test(file.name) ? redactCsv(file.text).text : redactText(file.text)) : file.text;
  return t.length > max ? `${t.slice(0, max)}\n… (${t.length - max} more characters)` : t;
}
