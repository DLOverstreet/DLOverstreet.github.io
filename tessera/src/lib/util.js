// Small helpers shared by the domain, services and UI. No DOM or Node APIs here,
// so every module that imports this runs in both the browser and the test runner.

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** FNV-1a 32-bit hash of a string. Used for deterministic sampling and ids. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function prng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [0, 1) derived from a string, stable across runs. */
export function unitHash(str) {
  return hashString(str) / 4294967296;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function sum(values) {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

export function uniq(values) {
  return [...new Set(values)];
}

export function groupBy(items, keyFn) {
  const out = {};
  for (const it of items) {
    const k = keyFn(it);
    (out[k] ||= []).push(it);
  }
  return out;
}

export function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** JSON with object keys sorted at every level, so equal data always serializes identically. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    }
    return out;
  }
  return v;
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tile';
}

/** Integer cents to "$1,234.56". */
export function fmtMoney(cents, { sign = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const c = String(abs % 100).padStart(2, '0');
  const s = `$${dollars}.${c}`;
  if (neg) return `−${s}`;
  return sign ? `+${s}` : s;
}

/** Cents per hour to "$32/h" (drops zero cents). */
export function fmtRate(centsPerHour) {
  const d = centsPerHour / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}/h`;
}

export function fmtMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Milliseconds to a short duration like "2d 4h", "3h 10m", "45m", "20s". */
export function fmtDuration(ms) {
  const neg = ms < 0;
  let s = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  let out;
  if (d) out = `${d}d ${h}h`;
  else if (h) out = `${h}h ${m}m`;
  else if (m) out = `${m}m`;
  else out = `${s}s`;
  return neg ? `-${out}` : out;
}

export function fmtDateTime(ms, opts = {}) {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts,
  });
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function pluralize(n, word, plural = word + 's') {
  return `${n} ${n === 1 ? word : plural}`;
}

export function truncate(text, n) {
  const s = String(text ?? '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function wordCount(text) {
  const m = String(text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function textToBytes(text) {
  return new TextEncoder().encode(text);
}

export function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

const TEXT_EXT = new Set(['csv', 'tsv', 'json', 'md', 'markdown', 'txt', 'py', 'r', 'js', 'ts', 'html', 'css', 'svg', 'sql', 'yaml', 'yml', 'xml', 'geojson', 'ipynb']);
export function isTextFile(name) {
  return TEXT_EXT.has(fileExt(name));
}

export function mimeFor(name) {
  const ext = fileExt(name);
  return ({
    csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', geojson: 'application/geo+json',
    md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', py: 'text/x-python', r: 'text/plain',
    js: 'text/javascript', ts: 'text/plain', html: 'text/html', css: 'text/css', svg: 'image/svg+xml',
    sql: 'text/plain', yaml: 'text/yaml', yml: 'text/yaml', xml: 'application/xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', pdf: 'application/pdf', zip: 'application/zip',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ipynb: 'application/json',
  })[ext] || 'application/octet-stream';
}

/** Pull the first JSON object or array out of model text (tolerates ```json fences and prose). */
export function extractJson(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const open = t[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error('The response did not contain valid JSON.');
}

/**
 * A chat message's text. Content is a string, or text blocks ({ type: 'text', text, cache? })
 * when part of a prompt is marked for the prompt cache.
 * @param {string|{ text: string }[]} content
 */
export function contentText(content) {
  return typeof content === 'string' ? content : (content || []).map((b) => b.text).join('\n\n');
}
