// A worker revising its own draft may hand back edits (find a passage, replace it) instead of
// rewriting whole files: a revision that changes three paragraphs of a long document then costs a
// few hundred output tokens instead of the whole document again. The swarm applies the edits here,
// in order, to the prior draft it gave the worker, and cleans up the notes a worker posts to the
// wire. Pure functions, no model.

/** How often `find` occurs in `text` (non-overlapping). */
function occurrences(text, find) {
  let n = 0;
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + find.length)) n++;
  return n;
}

/**
 * Applies edits to files. An edit whose passage isn't found, or is found more than once, is a
 * problem; the edits before it still apply.
 * @param {{ name: string, content: string }[]} files
 * @param {{ file: string, find: string, replace: string }[]} edits
 * @returns {{ files: { name: string, content: string }[], problems: string[], applied: number }}
 */
export function applyEdits(files, edits) {
  const out = files.map((f) => ({ ...f }));
  const problems = [];
  let applied = 0;
  for (const [i, e] of edits.entries()) {
    const f = out.find((x) => x.name === e.file);
    const where = `edit ${i + 1} (${e.file})`;
    if (!f) { problems.push(`${where}: there is no file ${e.file} in your prior draft; hand it in full in files instead`); continue; }
    const n = occurrences(f.content, e.find);
    if (n === 0) { problems.push(`${where}: the passage to find isn't in your prior draft word for word ("${e.find.slice(0, 60)}${e.find.length > 60 ? '…' : ''}"); copy it exactly`); continue; }
    if (n > 1) { problems.push(`${where}: the passage to find occurs ${n} times; include more of the text around it so it occurs once`); continue; }
    f.content = f.content.replace(e.find, () => e.replace);
    applied++;
  }
  return { files: out, problems, applied };
}

const KINDS = new Set(['tip', 'warning', 'question', 'answer']);

/** A worker's wire notes as the swarm keeps them: at most three, each under 400 characters, with a known audience and kind. */
export function cleanMessages(messages = []) {
  return messages
    .map((m) => ({
      to: String(m.to || '').toLowerCase().startsWith('riv') ? 'rivals' : 'team',
      kind: KINDS.has(String(m.kind || '').toLowerCase()) ? String(m.kind).toLowerCase() : 'tip',
      text: String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      ...(m.replyTo ? { replyTo: String(m.replyTo).slice(0, 40) } : {}),
    }))
    .filter((m) => m.text.length >= 10)
    .slice(0, 3);
}

/**
 * A worker's reply with its edits applied: the files it hands in are its prior draft with the
 * edits made, plus any files it wrote in full (which replace the prior version). Without a prior
 * draft, edits are a problem and the files stand as written.
 * @returns {{ output: any, problems: string[] }}
 */
export function materializeWork(out, input) {
  const prior = input?.agent?.priorDraft?.files || null;
  const messages = cleanMessages(out.messages || []);
  const usedMessages = [...new Set((out.usedMessages || []).map(String))].slice(0, 20);
  const edits = out.edits || [];
  if (!edits.length && !prior) return { output: { ...out, edits: [], messages, usedMessages }, problems: [] };
  if (!prior) return { output: { ...out, edits: [], messages, usedMessages }, problems: ['edits are only for revising your own prior draft; hand in every file in full in files'] };
  // Files written in full replace their prior version; the rest of the prior draft carries over.
  const written = new Set(out.files.map((f) => f.name));
  const base = [...prior.filter((f) => !written.has(f.name)).map((f) => ({ name: f.name, content: f.content })), ...out.files];
  const r = applyEdits(base, edits);
  return { output: { ...out, files: r.files, edits: [], messages, usedMessages, edited: r.applied }, problems: r.problems };
}
