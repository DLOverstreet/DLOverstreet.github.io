// Mock worker agent: with no model connected, a swarm agent hands in sample files that
// meet the tile's automatic checks (the same generator the crowd simulation uses), and
// says plainly that the content is a placeholder. Offered a split of a long tile, it splits
// by rows or sections into as many parts as allowed; doing one part, it writes only its share.
import { generateSampleWork } from './sample-work.js';
import { parseCsv, toCsv } from '../../lib/csv.js';

const JOINABLE = /\.(csv|md|markdown|txt|json)$/i;

/** An even split of a task's rows (or sections) among as many parts as allowed. */
export function splitPlan(d) {
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

/** This part's share of a document: the i-th of k runs of its lines, so the joined parts are as long as the whole. */
function section(text, i, k) {
  const lines = String(text).split('\n');
  const n = lines.length;
  const own = lines.slice(Math.floor(((i - 1) * n) / k), Math.floor((i * n) / k)).join('\n').trim();
  return `${own || `Part ${i} of ${k}.`}\n`;
}

/** A short placeholder for an owed text file the sample generator doesn't make (tables and JSON are left to it). */
function stubFile(name, title) {
  const ext = String(name).split('.').pop().toLowerCase();
  const line = `Mock agent: ${name} for “${title}”.`;
  if (['md', 'markdown', 'txt'].includes(ext)) return `# ${title}\n\n${line}\n`;
  if (['css', 'js', 'ts'].includes(ext)) return `/* ${line} */\n`;
  if (['py', 'r', 'yaml', 'yml'].includes(ext)) return `# ${line}\n`;
  if (ext === 'sql') return `-- ${line}\n`;
  if (['html', 'svg', 'xml'].includes(ext)) return `<!-- ${line} -->\n`;
  return null;
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
  if (d?.decideOnly) {
    return { approach: ['Read the tile and the split offer.', 'The work doesn’t divide into independent parts, so it stays whole.'], files: [], notes: 'Kept whole.', checklist: [], handoff: '' };
  }
  const part = input.part;
  let tile = { ...t, id: t.key };
  if (part?.rows) {
    const n = part.rows.to - part.rows.from + 1;
    tile = { ...tile, acceptanceCriteria: (t.acceptanceCriteria || []).map((c) => (/^csv_(min|max)_rows/.test(c.rule || '') ? { ...c, rule: `csv_min_rows(${n})` } : c)) };
  }
  // Competing configs write different drafts (the mock varies the sample by config and round).
  const who = input.agent ? `:${input.agent.config}:${input.agent.mode}:${input.agent.cycle || 1}` : '';
  const seed = `agent:${t.key}:${input.revision?.round || 0}${part ? `:part${part.index}` : ''}${who}`;
  const work = generateSampleWork(tile, { seed, upstreamFiles: (input.inputs || []).map((f) => f.name) });
  const pre = new Set((input.precomputedFiles || []).map((f) => f.name));
  let files = work.files.filter((f) => !pre.has(f.name)).map((f) => ({ name: f.name, content: f.text || '' }));
  if (part) {
    files = files.filter((f) => part.files.includes(f.name)).map((f) => (part.rows && /\.csv$/i.test(f.name) ? { ...f, content: offsetIds(f.content, part.rows.from) }
      : /\.(md|markdown|txt)$/i.test(f.name) && part.of > 1 ? { ...f, content: section(f.content, part.index, part.of) } : f));
    for (const name of part.files) if (!files.some((f) => f.name === name)) files.push({ name, content: `## Part ${part.index}\n\nThis part's share of ${name}.\n` });
  }
  // Every file the tile owes is handed in (the supervisor's hard checks look for each one).
  if (!part) for (const name of t.outputs || []) if (!pre.has(name) && !files.some((f) => f.name === name)) { const stub = stubFile(name, t.title); if (stub) files.push({ name, content: stub }); }
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
