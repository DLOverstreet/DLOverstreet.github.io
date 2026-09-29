// Mock worker agent: with no model connected, a swarm agent hands in sample files that
// meet the tile's automatic checks (the same generator the crowd simulation uses), and
// says plainly that the content is a placeholder. Offered a split of a long tile, it splits
// by rows or sections into as many parts as allowed; doing one part, it writes only its share.
import { generateSampleWork } from './sample-work.js';
import { parseCsv, toCsv } from '../../lib/csv.js';

const JOINABLE = /\.(csv|md|markdown|txt|json)$/i;

function splitPlan(d) {
  const k = d.maxParts;
  const shared = d.files.filter((f) => (d.by === 'rows' ? /\.csv$/i.test(f) : /\.(md|markdown|txt)$/i.test(f)));
  const own = d.files.filter((f) => !shared.includes(f));
  const parts = Array.from({ length: k }, (_, i) => {
    const n = d.rows ? d.rows.to - d.rows.from + 1 : 0;
    const rows = d.by === 'rows' && d.rows ? { from: d.rows.from + Math.floor((i * n) / k), to: d.rows.from + Math.floor(((i + 1) * n) / k) - 1 } : undefined;
    const files = [...shared, ...(i === 0 ? own : [])];
    return { brief: d.by === 'rows' ? `Do rows ${rows ? `${rows.from}–${rows.to}` : `part ${i + 1}`} of the table, with the columns the tile asks for.` : `Write section ${i + 1} of ${k} of the document.`, files: files.length ? files : [d.files[0]], ...(rows ? { rows } : {}) };
  });
  return { reason: `Mock lead agent: the ${d.by} divide evenly, so ${k} agents can each take a share.`, parts };
}

/** Renumbers the id column so part rows follow on from the parts before (ids stay unique when joined). */
function offsetIds(text, from) {
  const { columns, rows } = parseCsv(text);
  const id = columns.findIndex((c) => /(^|_)id$/i.test(c));
  if (id < 0) return text;
  return toCsv(columns, rows.map((r, i) => r.map((v, j) => (j === id ? String(v).replace(/-\d+$/, `-${1000 + from - 1 + i}`) : v))));
}

export function mockWorker(input) {
  const t = input.tile || {};
  const d = input.delegation;
  if (d && ((d.by === 'rows' && d.rows && d.rows.to - d.rows.from >= 7) || d.by === 'sections') && d.files.some((f) => JOINABLE.test(f))) {
    return {
      approach: ['Read the tile and the split offer.', 'Divided the work into independent parts of similar size.'],
      files: [], notes: 'Split for speed.', checklist: [], handoff: '', split: splitPlan(d),
    };
  }
  const part = input.part;
  let tile = { ...t, id: t.key };
  if (part?.rows) {
    const n = part.rows.to - part.rows.from + 1;
    tile = { ...tile, acceptanceCriteria: (t.acceptanceCriteria || []).map((c) => (/^csv_(min|max)_rows/.test(c.rule || '') ? { ...c, rule: `csv_min_rows(${n})` } : c)) };
  }
  const seed = `agent:${t.key}:${input.revision?.round || 0}${part ? `:part${part.index}` : ''}`;
  const work = generateSampleWork(tile, { seed, upstreamFiles: (input.inputs || []).map((f) => f.name) });
  const pre = new Set((input.precomputedFiles || []).map((f) => f.name));
  let files = work.files.filter((f) => !pre.has(f.name)).map((f) => ({ name: f.name, content: f.text || '' }));
  if (part) {
    files = files.filter((f) => part.files.includes(f.name)).map((f) => (part.rows && /\.csv$/i.test(f.name) ? { ...f, content: offsetIds(f.content, part.rows.from) } : f));
    for (const name of part.files) if (!files.some((f) => f.name === name)) files.push({ name, content: `## Part ${part.index}\n\nThis part's share of ${name}.\n` });
  }
  if (!files.length) files.push({ name: 'notes.md', content: `# ${t.title}\n\nThe merged files were computed from the accepted batches.\n` });
  return {
    approach: [
      'Read the spec, the acceptance criteria and the input files.',
      ...(part ? [`Did part ${part.index} of ${part.of}: ${part.brief}`] : []),
      ...(input.revision ? [`Fixed what round ${input.revision.round} failed: ${(input.revision.failed || []).map((f) => f.criterion).join('; ') || 'see notes'}.`] : []),
      'Produced the files the spec names and checked them against every criterion.',
    ],
    files,
    notes: 'Mock agent: these files are placeholders that meet the automatic checks. Connect Claude in Settings for real work.',
    checklist: (t.acceptanceCriteria || []).map((c) => ({ criterionId: c.id, done: true, note: 'Checked.' })),
    handoff: t.handoff || '',
  };
}
