import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJob, findQuantities, splitList } from '../../src/decompose/analyze.js';
import { JOBS } from '../fixtures/jobs.js';

const job = (id) => JOBS.find((j) => j.id === id);
const q = (text) => findQuantities(text).map((x) => `${x.n} ${x.unit}`);

test('counts are read with their nearest unit, in digits or words', () => {
  assert.deepEqual(q('Clean up 5,000 product listings'), ['5000 listing']);
  assert.deepEqual(q('the six-question FAQ'), ['6 question']);
  assert.deepEqual(q('our 40-page employee handbook'), ['40 page']);
  assert.deepEqual(q('We have 20 hours of oral history interview recordings'), ['20 hour-media']);
  assert.deepEqual(q('about 120 open-ended tenant survey responses'), ['120 response']);
  assert.deepEqual(q('Analyze 311 call data since 2010'), [], 'service names and years are not counts');
});

test('the kind of job is read from the title, the first sentence and the whole goal', () => {
  const want = { flyer: 'translation', dashboard: 'dataproduct', survey: 'coding', gala: 'event', grant: 'document', app: 'software', listings: 'bulk', podcast: 'media', course: 'course', litreview: 'literature', pantry: 'web', handbook: 'translation', bookkeeping: 'finance', campaign: 'campaign', bullets: 'research' };
  for (const [id, frame] of Object.entries(want)) assert.equal(analyzeJob(job(id)).frame, frame, id);
});

test('each named piece becomes a component with its kind of work and count', () => {
  const gala = analyzeJob(job('gala')).components.map((c) => c.archetype);
  assert.deepEqual(gala, ['research', 'research', 'design', 'web', 'outreach', 'schedule']);
  const flyer = analyzeJob(job('flyer')).components;
  assert.deepEqual(flyer.map((c) => [c.archetype, c.qty?.n, c.qty?.unit]), [['translate', 1, 'page'], ['translate', 6, 'question']]);
  const listings = analyzeJob(job('listings')).components;
  assert.equal(listings.length, 4);
  assert.ok(listings.every((c) => c.qty?.n === 5000));
  assert.deepEqual(listings.map((c) => c.subset), [false, true, true, false]);
  const app = analyzeJob(job('app')).components;
  assert.ok(app.length >= 4 && app.every((c) => c.archetype === 'software'), 'app features are built by developers');
});

test('per-item work is recognized for episodes, lessons and posts', () => {
  const pod = analyzeJob(job('podcast')).components;
  assert.ok(pod.filter((c) => c.perAsset || c.assetUnit).length >= 5);
  assert.ok(!pod.find((c) => /cover art/i.test(c.phrase)).perAsset, 'cover art is made once for the season');
  const course = analyzeJob(job('course')).components;
  assert.ok(course.find((c) => /slides/i.test(c.phrase)).perAsset);
  assert.ok(!course.find((c) => /facilitator/i.test(c.phrase)).perAsset);
});

test('languages, audiences, formats and constraints are picked up', () => {
  const d = analyzeJob(job('dashboard'));
  assert.deepEqual(d.languages.targets, ['es']);
  assert.ok(d.formats.includes('phone'));
  assert.ok(d.audiences.includes('tenants'));
  assert.deepEqual(analyzeJob(job('handbook')).languages.targets, ['es', 'vi']);
  const f = analyzeJob(job('flyer'));
  assert.ok(f.constraints.some((c) => /friendly and plain/i.test(c)));
  assert.ok(f.formats.includes('print'));
  const bi = analyzeJob({ title: 'Bilingual sign', goal: 'We need a bilingual sign for the front desk and a short FAQ.' });
  assert.deepEqual(bi.languages.targets, ['es']);
  assert.ok(bi.assumptions.some((x) => /Bilingual/.test(x)));
});

test('sensitive data is flagged only when the job holds data about people', () => {
  const s = analyzeJob(job('survey'));
  assert.ok(s.sensitive.yes && s.sensitive.redact);
  assert.deepEqual(s.sensitive.fields.sort(), ['addresses', 'names']);
  assert.equal(analyzeJob({ title: 'Policy brief', goal: 'A four-page policy brief comparing property tax relief options for low-income seniors in Arizona.' }).sensitive.yes, false);
  assert.equal(analyzeJob({ title: 'Clinic form', goal: 'Translate our two-page clinic intake form into French for West African patients.' }).sensitive.yes, false);
  assert.equal(analyzeJob({ title: 'Grant report', goal: 'Analyze attendance and outcome data for our after-school program and write the annual grant report. The data has student names.' }).sensitive.redact, true);
});

test('lists split where a new piece starts, not inside fixed phrases', () => {
  assert.deepEqual(splitList('maps and recommendations for the city council'), ['maps for the city council', 'recommendations for the city council']);
  assert.deepEqual(splitList('a profit and loss statement'), ['a profit and loss statement']);
  assert.deepEqual(splitList('fix titles, fill in missing sizes, and categorize everything'), ['fix titles', 'fill in missing sizes', 'categorize everything']);
});

test('a vague job says so and assumes a scoping step', () => {
  const v = analyzeJob(job('vague'));
  assert.equal(v.vague, true);
  assert.ok(v.assumptions.some((x) => /scoping tile/.test(x)));
});

test('reading is deterministic', () => {
  for (const j of JOBS) assert.deepEqual(analyzeJob(j), analyzeJob(j));
});
