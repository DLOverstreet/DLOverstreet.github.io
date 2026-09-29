// Reading text out of Word, Excel and PDF attachments in the browser: tracked changes and
// comments kept, every sheet as CSV, PDF text in reading order with real word gaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { extractText, readZip, canExtract } from '../../src/lib/extract.js';
import { makeZip, docxBytes } from '../helpers/office.js';

test('a Word document keeps its headings, tracked changes, comments, lists, tables and footnotes', async () => {
  assert.ok(canExtract('Manuscript - REVISED (tracked changes).docx'));
  const r = await extractText('manuscript.docx', docxBytes());
  assert.equal(r.info.from, 'docx');
  assert.deepEqual(r.info.headings, ['Policy Feedback and State Adoption', 'Introduction']);
  assert.equal(r.info.trackedChanges, 2);
  assert.equal(r.info.comments, 1);
  assert.match(r.text, /^# Policy Feedback and State Adoption/m);
  assert.match(r.text, /States adopt policies \[-quickly-\]\{\+gradually\+\} when neighbors do & costs fall\. \[comment 0\]\[1\]/);
  assert.match(r.text, /^- Adoption rose 12\.4 percent\.$/m);
  assert.match(r.text, /^\| State \| Year \|$/m);
  assert.match(r.text, /^\| Arizona \| 2014 \|$/m);
  assert.match(r.text, /## Footnotes\n\n\[1\] Data from the NCSL database\./);
  assert.doesNotMatch(r.text, /----/, 'separator footnotes are left out');
  assert.match(r.text, /\[comment 0\] Spiro Maroulis: Cite the diffusion literature here\./);
});

test('an Excel workbook becomes one CSV per sheet, with shared and inline strings', async () => {
  const bytes = makeZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Reviewer 1" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; plan" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>comment_id</t></si><si><t>comment</t></si><si><t>Engage the policy feedback literature, please</t></si><si><r><t>Soften </t></r><r><t>causal claims</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>done</t></is></c></row><row r="2"><c r="A2"><v>1.1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="b"><v>1</v></c></row><row r="3"><c r="A3"><v>2.1</v></c><c r="C3" t="b"><v>0</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>3</v></c></row></sheetData></worksheet>',
  });
  const r = await extractText('tracker.xlsx', bytes);
  assert.deepEqual(r.info.sheets.map((x) => [x.name, x.rows]), [['Reviewer 1', 2], ['Notes & plan', 0]]);
  assert.match(r.text, /## Sheet: Reviewer 1\n\ncomment_id,comment,done\n1\.1,"Engage the policy feedback literature, please",TRUE\n2\.1,,FALSE/);
  assert.match(r.text, /## Sheet: Notes & plan\n\n,Soften causal claims/);
});

test('a PDF printed by Chromium reads in order, with its fonts’ own character maps and real word gaps', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/files/decision-letter.pdf', import.meta.url)));
  const r = await extractText('decision.pdf', bytes);
  assert.equal(r.info.from, 'pdf');
  assert.equal(r.info.pages, 1);
  const lines = r.text.split('\n');
  assert.ok(lines.includes('Dear Dr. Overstreet: Your manuscript has been reviewed. The reviewers recommend major revisions.'), 'kerning moves don’t split words');
  assert.ok(lines.includes('Comment 1.2: Please report robustness checks with state fixed effects – “naïve” models aren’t enough.'), 'dashes, curly quotes and accents come through');
  assert.ok(lines.indexOf('Reviewer: 1') < lines.indexOf('Reviewer: 2'));
});

test('a plain PDF with no width tables still separates words, and an encrypted or damaged file says so', async () => {
  const content = 'BT /F1 12 Tf 72 720 Td (Reviewer 3:) Tj 60 0 Td (Please add a table of adoption years.) Tj 0 -14 Td [(Second) -300 (line) 20 (s)] TJ ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const zipped = deflateSync(Buffer.from(content, 'latin1'));
  let pdf = '%PDF-1.4\n';
  const chunks = [];
  objs.forEach((o, i) => {
    if (o === null) chunks.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${zipped.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), zipped, Buffer.from('\nendstream\nendobj\n', 'latin1'));
    else chunks.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
  });
  const bytes = new Uint8Array(Buffer.concat([Buffer.from(pdf, 'latin1'), ...chunks, Buffer.from('trailer << /Root 1 0 R >>\n%%EOF', 'latin1')]));
  const r = await extractText('plain.pdf', bytes);
  assert.deepEqual(r.text.split('\n').slice(1), ['Reviewer 3: Please add a table of adoption years.', 'Second lines'], 'resources inherited from the page tree; big TJ gaps are spaces, small ones aren’t');
  pdf = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R >>';
  const enc = await extractText('locked.pdf', new TextEncoder().encode(pdf));
  assert.match(enc.info.error, /encrypted/);
  assert.equal(enc.text, '');
  const bad = await extractText('broken.docx', new TextEncoder().encode('not a zip'));
  assert.match(bad.info.error, /not a zip/);
  assert.throws(() => readZip(new Uint8Array(10)), /not a zip/);
});

test('a Markdown document becomes a Word file that reads back the same, tracked changes and all', async () => {
  const { markdownToDocx } = await import('../../src/lib/docx.js');
  const md = '# Revised manuscript\n\nStates adopt policies [-quickly-]{+gradually+} when **neighbors** do.\nIt continues *here* with `code` and [a link](https://example.org).\n\n## Results\n\n- Adoption rose 12.4 percent.\n\n| State | Year |\n| --- | --- |\n| Arizona | 2014 |\n\n> A quoted comment & <tag>.';
  const bytes = markdownToDocx(md);
  const zip = readZip(bytes);
  assert.ok(zip.has('[Content_Types].xml') && zip.has('word/document.xml') && zip.has('word/styles.xml') && zip.has('_rels/.rels'));
  const back = await extractText('copy.docx', bytes);
  assert.deepEqual(back.info.headings, ['Revised manuscript', 'Results']);
  assert.equal(back.info.trackedChanges, 2, 'the marks became real tracked changes');
  assert.match(back.text, /States adopt policies \[-quickly-\]\{\+gradually\+\} when neighbors do\. It continues here with code and a link \(https:\/\/example\.org\)\./);
  assert.match(back.text, /^• Adoption rose 12\.4 percent\.$/m);
  assert.match(back.text, /^\| State \| Year \|$/m);
  assert.match(back.text, /^\| Arizona \| 2014 \|$/m);
  assert.match(back.text, /A quoted comment & <tag>\./);
});
