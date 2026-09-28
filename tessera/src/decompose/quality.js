// How well a plan splits a job into pieces separate people can do. It measures parallelism,
// tile sizes, whether every tile's inputs and outputs line up, whether the job's
// requirements are all covered, and how checkable the criteria are, then lists each
// problem with a fix the editor can apply in one click.
import { scheduleGraph } from './schedule.js';
import { inferIO, ancestors } from './ops.js';
import { SWEET, LIMITS } from './rates.js';

const SKILL_FAMILY = {
  python: 'code', r: 'code', sql: 'code', javascript: 'code', 'web-dev': 'code', 'html-css': 'code', 'mobile-dev': 'code', 'web-scraping': 'code', testing: 'code',
  'data-cleaning': 'data', 'data-entry': 'data', excel: 'data', geocoding: 'data', gis: 'data', bookkeeping: 'data',
  statistics: 'analysis', econometrics: 'analysis', 'survey-coding': 'analysis', methodology: 'analysis', research: 'analysis', 'literature-review': 'analysis', 'legal-research': 'analysis', 'citation-management': 'analysis',
  'data-viz': 'design', figma: 'design', svg: 'design', 'graphic-design': 'design', 'ux-design': 'design',
  'technical-writing': 'writing', copywriting: 'writing', editing: 'writing', 'grant-writing': 'writing', 'instructional-design': 'writing', transcription: 'writing',
  'audio-editing': 'media', 'video-editing': 'media',
  outreach: 'people', 'event-planning': 'people', 'project-management': 'people', 'project-integration': 'people', 'qa-review': 'people', accessibility: 'people',
};
const family = (tag) => SKILL_FAMILY[tag] || (tag.startsWith('translation-') ? 'language' : tag);
const REQUESTER_FILE = /requester|attached|source file|you attach/i;

/**
 * @param {any[]} input tiles with key, kind, title, spec, estMinutes, dependsOn, acceptanceCriteria, skillTags and, when known, inputs, outputs, covers
 * @param {{ requirements?: {id:string, text:string, kind:string}[] }} [analysis]
 */
export function assessQuality(input, analysis = null) {
  const tiles = inferIO(input.filter((t) => t.status !== 'CANCELLED'));
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const sched = scheduleGraph(tiles);
  const issues = [];
  const add = (code, severity, message, fix = null, keys = []) => issues.push({ code, severity, message, fix, keys });
  const work = tiles.filter((t) => t.kind !== 'INTEGRATION');

  // Parallelism, judged on the core work: setup, checks and assembly are serial by design.
  const n = tiles.length;
  const phaseOf = (t) => t.phase || (t.kind === 'INTEGRATION' ? 'integrate' : t.kind === 'REVIEW' ? 'check' : 'work');
  const core = tiles.filter((t) => ['work', 'layer'].includes(phaseOf(t)));
  const coreKeys = new Set(core.map((t) => t.key));
  const coreSched = scheduleGraph(core.map((t) => ({ ...t, dependsOn: (t.dependsOn || []).filter((d) => coreKeys.has(d)) })));
  if (core.length >= 4 && coreSched.speedup < 1.5) add('serial', 'high', `The core work is mostly one long chain: ${fmtH(coreSched.span)} of its ${fmtH(coreSched.total)} happen one after another, so adding people barely helps.`, { op: 'explain', text: 'Look for tiles that wait on something they don’t read, and remove that wait, or split the longest tile on the chain.' });

  // Sizes.
  const inSweet = tiles.filter((t) => t.estMinutes >= SWEET.min && t.estMinutes <= SWEET.max).length;
  for (const t of tiles) {
    if (t.estMinutes > LIMITS.max) add('too-big', 'high', `“${t.title}” is ${t.estMinutes} minutes, over the ${LIMITS.max}-minute limit.`, { op: 'split', key: t.key }, [t.key]);
    else if (t.estMinutes >= 120 && t.kind === 'WORK' && sched.critical.has(t.key) && n > 3) add('long-on-path', 'low', `“${t.title}” is a full two hours on the critical path. Splitting it would finish the job sooner.`, { op: 'split', key: t.key }, [t.key]);
  }
  // Tiny tiles in the same stream with the same upstream could be one person's job.
  const small = tiles.filter((t) => t.estMinutes < SWEET.min && t.kind === 'WORK');
  const grouped = new Map();
  for (const t of small) {
    const g = `${t.stream || ''}|${[...(t.dependsOn || [])].sort().join(',')}`;
    (grouped.get(g) || grouped.set(g, []).get(g)).push(t);
  }
  for (const list of grouped.values()) {
    if (list.length >= 2 && list.reduce((s, t) => s + t.estMinutes, 0) <= 105) add('too-small', 'low', `${list.map((t) => `“${t.title}”`).join(' and ')} are each under ${SWEET.min} minutes. One person could do them together.`, { op: 'merge', keys: list.map((t) => t.key) }, list.map((t) => t.key));
  }

  // Interfaces: every tile says what it takes and what it makes, and they line up.
  const maker = new Map();
  const dupes = new Map();
  for (const t of tiles) for (const f of t.outputs) { if (maker.has(f)) (dupes.get(f) || dupes.set(f, [maker.get(f)]).get(f)).push(t.key); else maker.set(f, t.key); }
  for (const [f, keys] of dupes) add('duplicate-output', 'medium', `${keys.length} tiles all deliver ${f}. Each file should have one maker, or the assembler has to guess which is right.`, { op: 'explain', text: `Rename ${f} in all but one of these tiles.` }, keys);
  const noOutputs = tiles.filter((t) => !t.outputs.length);
  if (noOutputs.length) add('unnamed-outputs', noOutputs.length > n / 2 ? 'medium' : 'low', `${noOutputs.length} tile${noOutputs.length > 1 ? 's don’t' : ' doesn’t'} name the files ${noOutputs.length > 1 ? 'they deliver' : 'it delivers'}, so the next person can’t know what to expect.`, null, noOutputs.map((t) => t.key));
  let wired = 0;
  let wiredOf = 0;
  for (const t of tiles) {
    const anc = ancestors(tiles, t.key);
    for (const f of t.inputs) {
      if (REQUESTER_FILE.test(f)) continue;
      wiredOf += 1;
      const m = maker.get(f);
      if (!m) { add('missing-input', 'medium', `“${t.title}” needs ${f}, but no tile makes it. Either the requester supplies it or a tile is missing.`, null, [t.key]); continue; }
      if (m === t.key) continue;
      if (anc.has(m)) { wired += 1; continue; }
      add('hidden-dependency', 'high', `“${t.title}” reads ${f} from “${byKey.get(m).title}” but doesn’t wait for it, so it could start before its input exists.`, { op: 'addEdge', from: m, to: t.key }, [t.key, m]);
    }
  }
  // Outputs nobody downstream uses, from tiles that have downstream tiles.
  const consumers = new Map();
  for (const t of tiles) for (const d of t.dependsOn || []) (consumers.get(d) || consumers.set(d, []).get(d)).push(t);
  for (const t of tiles) {
    const down = consumers.get(t.key) || [];
    if (!down.length || !t.outputs.length || down.some((d) => d.kind === 'INTEGRATION')) continue;
    const used = t.outputs.some((f) => down.some((d) => d.inputs.includes(f)));
    if (!used) add('unused-dependency', 'low', `Tiles wait on “${t.title}” but none of them lists its files as an input. Either the wait isn’t needed or their specs should name the file.`, { op: 'explain', text: 'Check the tiles that wait on it.' }, [t.key]);
  }

  // Specs and criteria.
  for (const t of tiles) {
    if ((t.spec || '').length < 160) add('thin-spec', 'medium', `“${t.title}” has a short spec. A stranger needs the inputs, the steps and the exact files to deliver.`, null, [t.key]);
  }
  const criteria = tiles.flatMap((t) => t.acceptanceCriteria || []);
  const autoShare = criteria.length ? criteria.filter((c) => c.check === 'AUTO').length / criteria.length : 0;
  for (const t of tiles) {
    const c = t.acceptanceCriteria || [];
    if (c.length && !c.some((x) => x.check === 'AUTO') && t.outputs.length) add('no-auto-check', 'low', `“${t.title}” has no machine check. A file-type, column or word-count rule catches wrong or empty deliveries before anyone reads them.`, null, [t.key]);
  }
  // Skills: one tile shouldn't need three kinds of expert.
  for (const t of work) {
    const fams = new Set((t.skillTags || []).map(family));
    if (fams.size >= 3) add('mixed-skills', 'medium', `“${t.title}” asks for ${[...fams].join(', ')} skills at once. Few people have all three; split it by skill.`, { op: 'split', key: t.key }, [t.key]);
  }

  // Coverage of what the requester asked for.
  const reqs = analysis?.requirements || [];
  const covered = new Set(tiles.flatMap((t) => t.covers || []));
  const text = tiles.map((t) => `${t.title} ${t.spec} ${(t.acceptanceCriteria || []).map((c) => c.text).join(' ')}`).join(' ').toLowerCase();
  const uncovered = reqs.filter((r) => !covered.has(r.id) && !mentions(text, r.text));
  for (const r of uncovered) add('uncovered', r.kind === 'component' ? 'high' : 'medium', `Nothing in the plan clearly covers “${r.text}”.`, { op: 'cover', requirement: r.id, text: r.text }, []);

  // A plan with several loose ends needs someone to bring them together.
  const sinks = tiles.filter((t) => !(consumers.get(t.key) || []).length);
  if (sinks.length >= 3 && !tiles.some((t) => t.kind === 'INTEGRATION')) add('no-integration', 'high', `${sinks.length} pieces end the plan with nobody to put them together.`, { op: 'addIntegration' }, sinks.map((t) => t.key));

  // Many problems of one kind read as one problem.
  const byCode = new Map();
  for (const i of issues) (byCode.get(i.code) || byCode.set(i.code, []).get(i.code)).push(i);
  issues.length = 0;
  for (const [code, list] of byCode) {
    issues.push(...list.slice(0, 3));
    if (list.length > 3) issues.push({ code, severity: list[0].severity, message: `…and ${list.length - 3} more like this.`, fix: null, keys: list.slice(3).flatMap((i) => i.keys), count: list.length - 3 });
  }

  // Score.
  const weights = { high: 12, medium: 5, low: 1.5 };
  let score = 100 - [...byCode.values()].reduce((s, list) => s + weights[list[0].severity] * Math.min(list.length, 4), 0);
  const sweetShare = n ? inSweet / n : 0;
  if (sweetShare < 0.5) score -= 8;
  if (autoShare < 0.25) score -= 6;
  if (n >= 5 && sched.speedup >= 2.5) score += 3;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  issues.sort((a, b) => weights[b.severity] - weights[a.severity]);
  return {
    score, grade, issues,
    metrics: {
      tiles: n, workTiles: work.length, totalMinutes: sched.total, spanMinutes: sched.span, speedup: sched.speedup, width: sched.width, coreSpeedup: coreSched.speedup,
      sweetShare, autoShare, interfaceShare: wiredOf ? wired / wiredOf : 1,
      requirements: reqs.length, covered: reqs.length - uncovered.length, criticalPath: sched.criticalPath,
      distinctSkills: new Set(tiles.flatMap((t) => t.skillTags || [])).size,
    },
    schedule: sched,
  };
}

function mentions(text, req) {
  const ws = String(req).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  const content = ws.filter((w) => !/^(?:the|and|with|that|this|from|into|should|must|will|have|every|each|keep|make|sure|final|version|work|works|ready)$/.test(w));
  if (!content.length) return true;
  const hit = content.filter((w) => text.includes(w.replace(/s$/, ''))).length;
  return hit / content.length >= 0.6;
}

const fmtH = (m) => `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
