import { test } from 'node:test';
import assert from 'node:assert/strict';
import { s } from '../../src/lib/schema.js';
import { parseCsv, toCsv } from '../../src/lib/csv.js';
import { createZip, crc32 } from '../../src/lib/zip.js';
import { renderMarkdown } from '../../src/lib/markdown.js';
import { redactText, redactCsv } from '../../src/lib/redact.js';
import { extractJson, canonicalJson, fmtMoney } from '../../src/lib/util.js';
import { generateSigningKeyPair, signPayload, verifySignedRecord } from '../../src/lib/crypto.js';
import { calibrationRatios, calibrateEstimate } from '../../src/domain/estimates.js';
import { nextAvailableAt } from '../../src/domain/availability.js';
import { peerReviewDecision } from '../../src/domain/review-policy.js';
import { checkFileLimits, rateLimitCheck } from '../../src/domain/limits.js';

test('schema: parses, applies defaults, drops unknown keys and reports paths', () => {
  const S = s.object({ a: s.int().min(1), b: s.array(s.string()).default([]), c: s.enum(['X', 'Y']).optional() });
  assert.deepEqual(S.parse({ a: 2, extra: 1 }), { a: 2, b: [] });
  const r = S.safeParse({ a: 0, b: [1] });
  assert.equal(r.success, false);
  assert.match(r.error.message, /a: must be at least 1/);
  assert.match(r.error.message, /b\.0: expected a string/);
  assert.deepEqual(S.jsonSchema().required, ['a']);
  assert.equal(S.jsonSchema().additionalProperties, false);
});

test('csv round trip with quotes', () => {
  const text = toCsv(['a', 'b'], [['1', 'x, "y"'], ['2', 'z']]);
  assert.deepEqual(parseCsv(text), { columns: ['a', 'b'], rows: [['1', 'x, "y"'], ['2', 'z']] });
});

test('zip writes a valid archive header and CRC', () => {
  const z = createZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
});

test('markdown escapes HTML', () => {
  const html = renderMarkdown('# Hi <script>\n\n- **a** <img src=x>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>a</strong>'));
});

test('redaction masks contact details and sensitive columns', () => {
  assert.equal(redactText('Call 602-555-0142 or mail a@b.org'), 'Call [phone] or mail [email]');
  const r = redactCsv('tenant_name,zip,note\nAna Ruiz,85001,call 602-555-0142\n');
  assert.deepEqual(r.redactedColumns, ['tenant_name']);
  assert.ok(!r.text.includes('Ana Ruiz'));
  assert.ok(r.text.includes('[phone]'));
});

test('extractJson tolerates fences and prose', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('ok {"a":{"b":"}"}} done'), { a: { b: '}' } });
  assert.throws(() => extractJson('nope'));
});

test('canonical JSON and money formatting', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
  assert.equal(fmtMoney(123456), '$1,234.56');
  assert.equal(fmtMoney(-50), '−$0.50');
});

test('Ed25519: a signed record verifies, and any change breaks it', async () => {
  const k = await generateSigningKeyPair();
  const payload = { subject: 'u', skills: [{ tag: 'python', score: 0.6 }] };
  const record = { ...payload, signature: await signPayload(k.privateKey, payload) };
  assert.equal((await verifySignedRecord(record, k.publicKeyB64)).valid, true);
  const tampered = { ...record, skills: [{ tag: 'python', score: 0.9 }] };
  assert.equal((await verifySignedRecord(tampered, k.publicKeyB64)).valid, false);
  const other = await generateSigningKeyPair();
  assert.equal((await verifySignedRecord(record, other.publicKeyB64)).valid, false);
});

test('estimates calibrate from the median actual/estimate ratio per tag', () => {
  const samples = [60, 66, 72, 90].map((m) => ({ tags: ['python'], estMinutes: 60, minutesSpent: m }));
  const r = calibrationRatios(samples);
  assert.equal(r.python.ratio, 1.15);
  assert.equal(calibrateEstimate(60, ['python'], r).estMinutes, 70);
  assert.equal(calibrateEstimate(60, ['r'], r).estMinutes, 60);
  assert.deepEqual(calibrationRatios(samples.slice(0, 2)), {}); // too few samples
});

test('availability respects time zones', () => {
  const now = Date.UTC(2026, 9, 1, 16, 0); // Thu 09:00 in Phoenix (UTC-7)
  const w = [{ day: 4, start: '09:00', end: '12:00' }];
  assert.equal(nextAvailableAt(now, w, 'America/Phoenix'), now);
  assert.equal(nextAvailableAt(now, w, 'UTC'), now + 7 * 86400000 - 7 * 3600000);
});

test('peer review policy', () => {
  const tile = { id: 't', kind: 'WORK', acceptanceCriteria: [{ check: 'AUTO' }] };
  assert.equal(peerReviewDecision({ tile, priorAcceptedWork: 2, round: 1 }).required, true);
  assert.equal(peerReviewDecision({ tile: { ...tile, highStakes: true }, priorAcceptedWork: 50, round: 1 }).required, true);
  assert.equal(peerReviewDecision({ tile: { ...tile, acceptanceCriteria: [{ check: 'PEER' }] }, priorAcceptedWork: 50, round: 1 }).required, true);
  assert.equal(peerReviewDecision({ tile: { ...tile, kind: 'REVIEW' }, priorAcceptedWork: 0, round: 1 }).required, false);
  let sampled = 0;
  for (let i = 0; i < 2000; i++) if (peerReviewDecision({ tile: { ...tile, id: `t${i}` }, priorAcceptedWork: 9, round: 1 }).required) sampled++;
  assert.ok(sampled > 320 && sampled < 480, `sampled ${sampled} of 2000`);
});

test('file and rate limits', () => {
  assert.deepEqual(checkFileLimits([{ name: 'a.csv', size: 10 }]), []);
  assert.equal(checkFileLimits([{ name: 'a.exe', size: 10 }]).length, 1);
  assert.equal(checkFileLimits([{ name: 'a.csv', size: 6 * 1024 * 1024 }]).length, 1);
  assert.equal(rateLimitCheck([1, 2, 3], 3, 100, 50).ok, false);
  assert.equal(rateLimitCheck([1, 2, 3], 3, 100, 150).ok, true);
});
