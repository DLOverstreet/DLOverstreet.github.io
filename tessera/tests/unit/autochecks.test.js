import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoChecks, parseRule } from '../../src/domain/autochecks.js';

const f = (name, text) => ({ name, size: text.length, text });
const crit = (rule, id = 'c1') => [{ id, text: 't', check: 'AUTO', rule }];
const one = (rule, files) => runAutoChecks(crit(rule), files).results[0];

test('parses rules with quoted and piped arguments', () => {
  assert.deepEqual(parseRule('file_ext(csv|xlsx)'), { name: 'file_ext', args: ['csv', 'xlsx'] });
  assert.deepEqual(parseRule('contains("a, b")'), { name: 'contains', args: ['a, b'] });
  assert.equal(parseRule('made_up(1)'), null);
});

test('file type, columns, rows, blanks and uniqueness', () => {
  const csv = f('a.csv', 'case_id,zip\n1,85001\n2,\n2,85003\n');
  assert.equal(one('file_ext(csv)', [csv]).pass, true);
  assert.equal(one('file_ext(json)', [csv]).pass, false);
  assert.equal(one('csv_columns(case_id, zip)', [csv]).pass, true);
  assert.equal(one('csv_columns(case_id, tract)', [csv]).reason, 'Missing column(s): tract.');
  assert.equal(one('csv_min_rows(3)', [csv]).pass, true);
  assert.equal(one('csv_min_rows(4)', [csv]).pass, false);
  assert.equal(one('csv_no_blank(zip)', [csv]).pass, false);
  assert.equal(one('csv_unique(case_id)', [csv]).pass, false);
});

test('JSON, word counts, headings and phrases', () => {
  assert.equal(one('json_valid()', [f('a.json', '{"a":1}')]).pass, true);
  assert.equal(one('json_valid()', [f('a.json', '{a:1}')]).pass, false);
  assert.equal(one('json_keys(title, series)', [f('a.json', '{"title":1,"series":[]}')]).pass, true);
  const md = f('n.md', '# Note\n\n## Sources\n\none two three four five');
  assert.equal(one('word_count(5, 20)', [md]).pass, true);
  assert.equal(one('word_count(50)', [md]).pass, false);
  assert.equal(one('has_heading("sources")', [md]).pass, true);
  assert.equal(one('contains("FOUR")', [md]).pass, true);
});

test('unknown rules are deferred to the LLM Reviewer, never silently passed', () => {
  const r = runAutoChecks(crit('run_tests()'), [f('a.py', 'x')]);
  assert.equal(r.results.length, 0);
  assert.equal(r.deferred.length, 1);
});
