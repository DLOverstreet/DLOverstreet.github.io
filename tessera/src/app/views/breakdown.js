// The breakdown tool: describe any job and see it split into tiles that separate people
// can do at the same time, with how the job was read, what each tile takes and makes, who
// works when, a separability grade with one-click fixes, and a way to post it as a commission.
// The same insight panels appear on a commission's Plan tab.
import { html, useState, useEffect, useMemo, useRef } from '../../../vendor/preact.js';
import { useT, useDbVersion, navigate, currentUser, setPersona, act, toast, downloadBytes } from '../state.js';
import { Modal, Field, AsyncButton, Empty } from '../ui.js';
import { handToSwarm } from './swarm.js';
import { GraphView } from './graph.js';
import { disaggregate, applyFix, assessQuality, groupTitle, FRAME_LABELS, OpError } from '../../decompose/index.js';
import { priceGraph, tilePayCents } from '../../domain/pricing.js';
import { LANGUAGE_NAMES } from '../../decompose/lexicon.js';
import { fmtMoney, fmtMinutes, DAY } from '../../lib/util.js';

export const BREAKDOWN_EXAMPLES = [
  { id: 'gala', label: 'Spring gala', title: 'Spring gala for 200 guests', goal: 'Plan our annual spring gala for 200 guests: find a venue, get catering quotes, design invitations, set up online registration, recruit 30 volunteers, and write the run-of-show.' },
  { id: 'listings', label: '5,000 product listings', title: 'Clean up 5,000 product listings', goal: 'Clean up 5,000 product listings from our store export: fix titles, fill in missing sizes, write descriptions for the ones that have none, and categorize everything into our taxonomy.' },
  { id: 'podcast', label: 'Podcast season', title: 'Local history podcast season', goal: 'Produce a 6-episode podcast season about local history: research, interview guests, record, edit, write show notes, and create cover art.' },
  { id: 'app', label: 'Volunteer app', title: 'Volunteer shift app for the food bank', goal: 'Build a simple iOS and Android app for our food bank volunteers to sign up for shifts, get push reminders, and check in with a QR code. Staff need an admin screen to create shifts and see who is coming.' },
  { id: 'grant', label: 'Grant proposal', title: 'Federal grant proposal for our after-school STEM program', goal: 'Write a federal grant proposal for our after-school STEM program: needs statement, program design, evaluation plan, budget and budget narrative, and letters of support from 3 partners.' },
  { id: 'course', label: 'Online course', title: 'Financial literacy course for teens', goal: 'Create a 4-week online course on financial literacy for teens: 8 lessons with slides, quizzes, and a facilitator guide.' },
  { id: 'dashboard', label: 'Data dashboard', title: 'Eviction filings dashboard for Maricopa County', goal: 'Build a public dashboard of eviction filings in Maricopa County from the justice courts’ public calendar: monthly trends, a map by census tract, and a breakdown by case type, with a plain-language methodology note. The page should be in English and Spanish and work on a phone, because tenants and reporters will read it there.' },
  { id: 'survey', label: 'Survey coding', title: 'Code 120 open-ended tenant survey responses', goal: 'We ran a tenant survey with an open-ended question about housing problems and have about 120 responses. We need a codebook, every response coded, a check that coders agree, and a short memo on the main themes for our board. Responses include some names and addresses, so contributors should only see redacted text.', sensitive: true },
  { id: 'handbook', label: 'Handbook translation', title: 'Translate our employee handbook', goal: 'Translate our 40-page employee handbook into Spanish and Vietnamese. Terms must be consistent across both versions.' },
  { id: 'books', label: 'Bookkeeping', title: 'Catch up our bookkeeping', goal: 'Our nonprofit is behind on bookkeeping. We need 12 months of transactions categorized, bank accounts reconciled, and a profit and loss statement for the board.' },
  { id: 'oral', label: 'Oral histories', title: 'Transcribe oral history interviews', goal: 'We have 20 hours of oral history interview recordings. Transcribe them, add timestamps, and write a one-paragraph summary of each interview.' },
  { id: 'market', label: 'Market research', title: 'Market research for a coffee cart', goal: 'We want to open a coffee cart downtown.\n- competitor list with prices\n- foot traffic counts from public data\n- a survey of 50 office workers\n- a short summary with a go/no-go recommendation' },
];

/* ------------------------------------------------------------------ colors */

const STREAM_VARS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const OTHER = 'var(--s-other)';

/** Stream → color in fixed order of first appearance; a ninth stream and beyond fold into Other. */
export function streamColors(tiles) {
  const order = [];
  for (const t of tiles) { const s = t.stream || 'Work'; if (!order.includes(s)) order.push(s); }
  const map = new Map();
  order.forEach((s, i) => map.set(s, i < 8 ? STREAM_VARS[i] : OTHER));
  return { map, order, folded: order.slice(8) };
}

const hrs = (m) => (m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`);

/* ------------------------------------------------------------------ page */

/** The last breakdown on this page, kept while the app is open so switching persona or tab doesn't lose it. */
let last = { form: null, result: null };

export function BreakdownPage({ example }) {
  const T = useT();
  useDbVersion();
  const start = BREAKDOWN_EXAMPLES.find((e) => e.id === example) || null;
  const keep = !start && last.result && last.form;
  const [form, setFormState] = useState(keep ? last.form : { title: start?.title || '', goal: start?.goal || '', budget: '', sensitive: !!start?.sensitive });
  const [result, setResultState] = useState(keep ? last.result : null);
  const setForm = (f) => { last = { ...last, form: f }; setFormState(f); };
  const setResult = (r) => { last = { ...last, result: r }; setResultState(r); };
  const [busy, setBusy] = useState(false);
  const [useModel, setUseModel] = useState(false);
  const modelOn = T.llm.platform('heavy').providerName !== 'mock';
  const resultRef = useRef(null);

  const run = async (f = form, scroll = true) => {
    if ((f.goal || '').trim().length < 12) { toast('Describe the job in a sentence or two first.', 'err'); return; }
    setBusy(true);
    const job = { title: f.title.trim(), goal: f.goal.trim(), privacy: f.sensitive ? 'RESTRICTED' : 'PUBLIC', language: 'en' };
    const budgetCents = Number(f.budget) > 0 ? Math.round(Number(f.budget) * 100) : null;
    const r = await act(() => (useModel && modelOn ? T.api.breakdown(job, { useModel: true, budgetCents }) : Promise.resolve(disaggregate(job, { maxTotalCents: budgetCents }))));
    setBusy(false);
    if (!r) return;
    last = { ...last, form: f };
    setResult({ ...r, job, budgetCents, source: r.source || 'engine' });
    if (scroll) setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  useEffect(() => { if (start) run(form, false); }, []);

  const pick = (e) => {
    const f = { title: e.title, goal: e.goal, budget: '', sensitive: !!e.sensitive };
    setForm(f);
    run(f);
  };

  return html`<div class="stack">
    <div class="page-head"><div>
      <h1 tabindex="-1">Break down any job</h1>
      <p class="muted" style=${{ maxWidth: '62rem' }}>Describe a job the way you’d tell a colleague. Tessera reads it, finds the separate pieces of work, and splits them into tiles that different people can do at the same time. Each tile says exactly what it receives, what it delivers and how it will be checked.</p>
    </div></div>
    <div class="card">
      <form onSubmit=${(e) => { e.preventDefault(); run(); }} class="stack" style=${{ gap: '.8rem' }}>
        <${Field} label="What’s the job?" id="bd-goal" hint="List the pieces you need, with counts where you know them: “8 lessons with slides and quizzes”, “5,000 listings”, “in English and Spanish”, “works on a phone”.">
          <textarea id="bd-goal" rows="5" value=${form.goal} onInput=${(e) => setForm({ ...form, goal: e.target.value })} placeholder="Plan our annual spring gala for 200 guests: find a venue, get catering quotes, design invitations, set up online registration…"></textarea>
        <//>
        <div class="inline-fields">
          <${Field} label="Short title (optional)" id="bd-title"><input id="bd-title" type="text" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.target.value })} placeholder="Spring gala" /><//>
          <${Field} label="Budget in USD (optional)" id="bd-budget" hint="If set, the plan is fitted to it and the rest waits for a second phase."><input id="bd-budget" type="number" min="50" step="50" value=${form.budget} onInput=${(e) => setForm({ ...form, budget: e.target.value })} /><//>
        </div>
        <label class="choice"><input type="checkbox" checked=${form.sensitive} onChange=${(e) => setForm({ ...form, sensitive: e.target.checked })} /> <span>The material includes personal or confidential information</span></label>
        ${modelOn ? html`<label class="choice"><input type="checkbox" checked=${useModel} onChange=${(e) => setUseModel(e.target.checked)} /> <span>Ask Claude to refine the split (it starts from the engine’s reading and plan)</span></label>` : ''}
        <div class="row">
          <button class="btn primary" type="submit" disabled=${busy}>${busy ? 'Breaking it down…' : 'Break it down'}</button>
          <span class="small muted">Runs in your browser in a fraction of a second. Nothing is posted until you choose to.</span>
        </div>
      </form>
      <div class="row" style=${{ marginTop: '.9rem', gap: '.35rem' }}><span class="small muted">Try:</span>${BREAKDOWN_EXAMPLES.map((e) => html`<button type="button" class="btn small ghost-line" onClick=${() => pick(e)}>${e.label}</button>`)}</div>
    </div>
    <div ref=${resultRef}>${result ? html`<${BreakdownResult} result=${result} onChange=${setResult} />` : html`<${Empty} title="Your breakdown appears here">Pick an example above or describe your own job.<//>`}</div>
  </div>`;
}

/* ------------------------------------------------------------------ result */

export function BreakdownResult({ result, onChange }) {
  const T = useT();
  const me = currentUser(T);
  const [posting, setPosting] = useState(false);
  const { analysis, tiles } = result;
  const quality = useMemo(() => assessQuality(tiles, analysis), [tiles, analysis]);
  const pricing = useMemo(() => priceGraph(tiles, { rush: false }), [tiles]);
  const priced = useMemo(() => tiles.map((t) => ({ ...t, payCents: tilePayCents(t) })), [tiles]);

  const edit = (fix, done) => {
    try {
      const next = applyFix(tiles, fix);
      onChange({ ...result, tiles: next, edited: true });
      if (done) toast(done, 'ok');
    } catch (e) {
      toast(e instanceof OpError ? e.message : String(e.message || e), 'err', 6000);
    }
  };
  const download = () => {
    const blob = JSON.stringify({ job: result.job, analysis: { kind: analysis.frame, requirements: analysis.requirements, assumptions: analysis.assumptions }, rationale: result.rationale, tiles }, null, 2);
    downloadBytes(new TextEncoder().encode(blob), `${(analysis.title || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-breakdown.json`, 'application/json');
  };

  return html`<div class="stack">
    <${PlanSummary} quality=${quality} pricing=${pricing} rationale=${result.rationale} source=${result.source} model=${result.model} deferred=${result.deferred} edited=${result.edited} />
    <div class="split">
      <${JobReading} analysis=${analysis} />
      <div class="stack">
        <${Coverage} analysis=${analysis} tiles=${tiles} onFix=${(f) => edit(f, 'The final assembly now checks for it.')} />
        <${Issues} quality=${quality} onFix=${(f) => edit(f, 'Fixed.')} onRepair=${() => edit({ op: 'repair' }, 'Repaired what a machine can.')} />
      </div>
    </div>
    <${Timeline} tiles=${priced} quality=${quality} />
    <${TilesPanel} tiles=${priced} quality=${quality} editable=${true}
      onSplit=${(k) => edit({ op: 'split', key: k }, 'Split into two tiles that run side by side.')}
      onMerge=${(keys) => edit({ op: 'merge', keys }, 'Merged into one tile.')}
      onDrop=${(k) => edit({ op: 'drop', key: k }, 'Removed. Tiles that waited on it now wait on its inputs.')} />
    <div class="card row-between">
      <div><h2>Use this plan</h2><p class="small muted">Hand it to the agent swarm to have AI agents do every tile, post it as a commission to run it with people, or download it as JSON.</p></div>
      <div class="row">
        <${AsyncButton} class="primary" onClick=${() => handToSwarm(T, { title: (result.job.title || result.analysis.title || 'Untitled job').slice(0, 120).padEnd(5, '.'), goal: result.job.goal.padEnd(20, ' ').slice(0, 6000), privacy: result.job.privacy, plan: { tiles: result.tiles, rationale: result.rationale, source: result.source, pricing } })}>Run it with agents<//>
        <button class="btn" onClick=${() => setPosting(true)}>Post as a commission</button>
        <button class="btn" onClick=${download}>Download JSON</button>
      </div>
    </div>
    ${posting && html`<${PostPlanModal} me=${me} result=${result} pricing=${pricing} onClose=${() => setPosting(false)} />`}
  </div>`;
}

function PostPlanModal({ me, result, pricing, onClose }) {
  const T = useT();
  const suggested = Math.ceil(pricing.total / 100 / 50) * 50;
  const [budget, setBudget] = useState(String(Math.max(50, result.budgetCents ? Math.round(result.budgetCents / 100) : suggested)));
  const [days, setDays] = useState('14');
  if (!me?.isRequester) {
    return html`<${Modal} title="Post as a commission" onClose=${onClose}>
      <p class="small">Posting needs a requester. Switch to one of them and come back; your breakdown stays on this page.</p>
      <div class="row" style=${{ marginTop: '.8rem' }}>${T.db.filter('User', (u) => u.persona && u.isRequester).map((u) => html`<button class="btn" onClick=${() => { setPersona(T, u.id); onClose(); toast(`You are now ${u.name}. Post the plan when you’re ready.`, 'ok'); }}>Be ${u.name.split(' ')[0]}</button>`)}</div>
    <//>`;
  }
  const post = async () => {
    const c = await act(() => T.api.postCommission(me.id, {
      title: (result.job.title || result.analysis.title || 'Untitled job').slice(0, 120).padEnd(5, '.'), goal: result.job.goal.padEnd(20, ' ').slice(0, 6000),
      budgetCents: Math.round(Number(budget) * 100), deadline: T.clock.now() + Number(days) * DAY, privacy: result.job.privacy, language: 'en',
      plan: { tiles: result.tiles, rationale: result.rationale, source: result.source },
    }), 'Posted with your plan. Review the price and fund it when ready.');
    if (c) { onClose(); navigate(`#/c/${c.id}/plan`); }
  };
  return html`<${Modal} title="Post as a commission" onClose=${onClose}>
    <p class="small">You’ll post as <b>${me.name}</b>. The plan skips scoping and goes straight to the approval step, where you can still edit any tile before funding.</p>
    <div class="inline-fields" style=${{ marginTop: '.8rem' }}>
      <${Field} label="Budget (USD)" id="pp-budget" hint=${`This plan prices at ${fmtMoney(pricing.total)} with fees and the review reserve.`}><input id="pp-budget" type="number" min="50" value=${budget} onInput=${(e) => setBudget(e.target.value)} /><//>
      <${Field} label="Deadline in days" id="pp-days"><input id="pp-days" type="number" min="1" max="120" value=${days} onInput=${(e) => setDays(e.target.value)} /><//>
    </div>
    <div class="row" style=${{ marginTop: '.9rem' }}><${AsyncButton} class="primary" onClick=${post}>Post with this plan<//><button class="btn" onClick=${onClose}>Cancel</button></div>
  <//>`;
}

/* ------------------------------------------------------------------ panels */

export function PlanSummary({ quality, pricing, rationale, source, model, deferred = [], edited }) {
  const m = quality.metrics;
  const tone = { A: 'good', B: 'good', C: 'warn', D: 'bad', F: 'bad' }[quality.grade];
  return html`<div class="card">
    <div class="card-head">
      <h2>The split</h2>
      <span class="row small muted" style=${{ gap: '.4rem' }}>
        <span class=${`badge ${tone}`} title="How cleanly the job separates into independent pieces, from the quality report">Separability ${quality.grade} · ${quality.score}</span>
        ${source === 'model' ? html`<span class="badge info">Refined by ${model || 'the model'}</span>` : html`<span class="badge">Rule-based engine</span>`}
        ${edited ? html`<span class="badge">Edited</span>` : ''}
      </span>
    </div>
    <div class="stats">
      <div class="stat"><span class="v">${m.tiles}</span><span class="l">tiles</span></div>
      <div class="stat"><span class="v">${m.width}</span><span class="l">people can work at once</span></div>
      <div class="stat"><span class="v">${hrs(m.totalMinutes)}</span><span class="l">of work in total</span></div>
      <div class="stat"><span class="v">${hrs(m.spanMinutes)}</span><span class="l">longest chain of hand-offs</span></div>
      <div class="stat"><span class="v">${m.speedup.toFixed(1)}×</span><span class="l">faster than one person</span></div>
      <div class="stat"><span class="v">${pricing ? fmtMoney(pricing.total) : '—'}</span><span class="l">escrow incl. fee and review reserve</span></div>
    </div>
    ${rationale ? html`<p class="small" style=${{ marginTop: '.8rem' }}>${rationale}</p>` : ''}
    ${deferred.length ? html`<div class="callout warn" style=${{ marginTop: '.7rem' }}><b>Phase two.</b> ${deferred.map((d) => `${d.what} for ${d.noun ? `${d.noun.trim()} ` : ''}${d.from.toLocaleString('en-US')}–${d.to.toLocaleString('en-US')}`).join('; ')} ${deferred.some((d) => d.reason === 'budget') ? 'wait for more budget' : 'are left for a second plan with the same tiles'}.</div>` : ''}
  </div>`;
}

export function JobReading({ analysis: a }) {
  if (!a) return '';
  const kind = FRAME_LABELS[a.frame || a.kind] || 'general';
  const pieces = a.components || a.pieces || [];
  const langs = (a.languages?.targets || []).map((t) => LANGUAGE_NAMES[t] || t);
  const sensitive = a.sensitive?.yes ?? !!a.sensitive;
  return html`<div class="card">
    <div class="card-head"><h2>How the job reads</h2><span class="badge info">${kind} job</span></div>
    ${pieces.length ? html`<ol class="reading">
      ${pieces.map((c) => html`<li><span>${c.phrase}</span>
        <span class="tags">
          ${c.qty ? html`<span class="tag">${c.qty.n.toLocaleString('en-US')} ${c.qty.noun}</span>` : c.count ? html`<span class="tag">${c.count}</span>` : ''}
          ${c.perAsset || c.assetUnit ? html`<span class="tag">per item</span>` : ''}
          ${c.role && c.role !== 'work' ? html`<span class="tag">${c.role === 'conventions' ? 'shared rules' : 'check'}</span>` : ''}
        </span></li>`)}
    </ol>` : html`<p class="small muted">No separate pieces named. The plan starts by scoping them.</p>`}
    <dl class="kv" style=${{ marginTop: '.7rem' }}>
      ${langs.length ? html`<dt>Languages</dt><dd>${(LANGUAGE_NAMES[a.languages.source] || 'English')} → ${langs.join(', ')}</dd>` : ''}
      ${a.audiences?.length ? html`<dt>For</dt><dd>${a.audiences.join(', ')}</dd>` : ''}
      ${a.formats?.length ? html`<dt>Formats</dt><dd>${a.formats.join(', ')}</dd>` : ''}
      ${a.constraints?.length ? html`<dt>Constraints</dt><dd>${a.constraints.join('; ')}</dd>` : ''}
      ${sensitive ? html`<dt>Sensitive</dt><dd>${a.sensitive.fields?.length ? a.sensitive.fields.join(', ') : 'yes'}${a.sensitive.redact || a.sensitive.deidentify ? ' · de-identified before anyone else sees it' : ''}</dd>` : ''}
    </dl>
    ${a.assumptions?.length ? html`<div class="callout" style=${{ marginTop: '.7rem' }}><b>Assumed:</b> ${a.assumptions.join(' ')}</div>` : ''}
    ${a.suggestions?.length ? html`<p class="small muted" style=${{ marginTop: '.6rem' }}>Jobs like this often also need: ${a.suggestions.join(', ')}. Add them to the description to include them.</p>` : ''}
  </div>`;
}

const same = (a, b) => a.toLowerCase().replace(/\b(?:a|an|the|our)\b/g, '').replace(/\W+/g, '') === b.toLowerCase().replace(/\b(?:a|an|the|our)\b/g, '').replace(/\W+/g, '');

function groupRange(tiles) {
  const a = tiles[0].part;
  const b = tiles[tiles.length - 1].part;
  if (!a || !b) return '';
  const noun = (a.label || '').replace(/[\d,–\s-]+$/, '').replace(/^(\w+?)s?$/, '$1s');
  return `${noun} ${a.from.toLocaleString('en-US')}–${b.to.toLocaleString('en-US')}`;
}

export function Coverage({ analysis, tiles, onFix }) {
  const reqs = analysis?.requirements || [];
  if (!reqs.length) return '';
  const text = (t) => `${t.title} ${t.spec} ${(t.acceptanceCriteria || []).map((c) => c.text).join(' ')}`.toLowerCase();
  const rows = reqs.map((r) => {
    const by = tiles.filter((t) => (t.covers || []).includes(r.id));
    const words = (r.text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((w) => !/^(?:the|and|with|that|this|from|into|should|must|will|have|every|each|keep|make|sure|final|version|ready)$/.test(w));
    const loose = !by.length && words.length && tiles.some((t) => words.filter((w) => text(t).includes(w.replace(/s$/, ''))).length / words.length >= 0.6);
    return { r, by, ok: by.length > 0 || loose };
  });
  return html`<div class="card">
    <div class="card-head"><h2>What you asked for</h2><span class="small muted">${rows.filter((x) => x.ok).length} of ${rows.length} covered</span></div>
    <ul class="coverage">${rows.map(({ r, by, ok }) => html`<li class=${ok ? 'ok' : 'miss'}>
      <span class="mark" aria-hidden="true">${ok ? '✓' : '!'}</span>
      <span><span class="sr-only">${ok ? 'Covered: ' : 'Not covered: '}</span>${r.text}
        ${by.length && !(by.length === 1 && same(by[0].title, r.text)) ? html`<span class="tiny muted" style=${{ display: 'block' }}>${by.length > 3 ? `${by.length} tiles, from “${by[0].title}”` : by.map((t) => t.title).join(' · ')}</span>` : ''}
        ${!ok && onFix ? html`<button class="btn small" style=${{ marginTop: '.3rem' }} onClick=${() => onFix({ op: 'cover', requirement: r.id, text: r.text })}>Make the final check cover it</button>` : ''}
      </span></li>`)}</ul>
  </div>`;
}

export function Issues({ quality, onFix, onRepair }) {
  const list = quality.issues;
  return html`<div class="card">
    <div class="card-head"><h2>Separability check</h2>${onRepair && list.some((i) => i.fix && ['addEdge', 'addIntegration'].includes(i.fix.op)) ? html`<button class="btn small" onClick=${onRepair}>Repair all</button>` : ''}</div>
    ${list.length ? html`<ul class="issues">${list.map((i) => html`<li>
      <span class=${`badge ${i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : ''}`}>${i.severity}</span>
      <span class="small">${i.message}${i.fix?.op === 'explain' ? html`<span class="muted"> ${i.fix.text}</span>` : ''}</span>
      ${onFix && i.fix && !['explain', 'cover'].includes(i.fix.op) ? html`<button class="btn small" onClick=${() => onFix(i.fix)}>${{ split: 'Split it', merge: 'Merge them', addEdge: 'Add the wait', addIntegration: 'Add assembly' }[i.fix.op] || 'Fix'}</button>` : ''}
    </li>`)}</ul>` : html`<p class="small">No problems found: every tile names its inputs and outputs, waits only for what it reads, fits in a sitting, and has a checkable finish line.</p>`}
    <p class="tiny muted" style=${{ marginTop: '.6rem' }}>${Math.round(quality.metrics.sweetShare * 100)}% of tiles are 30–90 minutes · ${Math.round(quality.metrics.autoShare * 100)}% of criteria are checked automatically · ${Math.round(quality.metrics.interfaceShare * 100)}% of inputs come from an upstream tile the plan waits for.</p>
  </div>`;
}

/* ------------------------------------------------------------------ timeline */

/**
 * Who works when: each bar is a tile at its earliest start if everyone begins the moment
 * their inputs exist. Identical batches share one bar with a count. Outlined bars are the
 * longest chain.
 */
export function Timeline({ tiles, quality }) {
  const [view, setView] = useState('chart');
  const [tip, setTip] = useState(null);
  const [boxW, setBoxW] = useState(900);
  const wrapRef = useRef(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const s = quality.schedule;
  if (!tiles.length || !s.span) return '';
  const colors = streamColors(tiles);
  // Rows: per stream, identical (start, length) tiles share one bar; overlapping bars stack into lanes.
  const rows = [];
  for (const stream of colors.order) {
    const bars = new Map();
    for (const t of tiles.filter((x) => (x.stream || 'Work') === stream)) {
      const k = `${s.start.get(t.key)}|${s.finish.get(t.key)}`;
      if (!bars.has(k)) bars.set(k, []);
      bars.get(k).push(t);
    }
    const lanes = [];
    for (const group of [...bars.values()].sort((a, b) => s.start.get(a[0].key) - s.start.get(b[0].key))) {
      const st = s.start.get(group[0].key);
      let lane = lanes.find((l) => l.end <= st);
      if (!lane) { lane = { end: 0, bars: [] }; lanes.push(lane); }
      lane.bars.push(group);
      lane.end = s.finish.get(group[0].key);
    }
    lanes.forEach((l, i) => rows.push({ stream, first: i === 0, bars: l.bars }));
  }
  const W = Math.max(300, Math.min(1400, boxW - 2));
  const narrow = W < 600;
  const labelW = narrow ? 92 : 150;
  const maxLabel = narrow ? 12 : 20;
  const rowH = 28;
  const barH = 18;
  const top = 26;
  const H = top + rows.length * rowH + 8;
  const px = (W - labelW - 24) / s.span;
  const step = [30, 60, 120, 240, 480, 960, 1920, 3840].find((m) => s.span / m <= (narrow ? 4 : 8)) || 7680;
  const ticks = [];
  for (let m = 0; m <= s.span; m += step) ticks.push(m);
  const show = (e, group) => {
    const t = group[0];
    const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({
      x: r.left - box.left + r.width / 2, y: r.top - box.top,
      title: group.length > 1 ? `${group.length} tiles side by side` : t.title,
      lines: [
        group.length > 1 ? `${groupTitle(t.title)} · ${groupRange(group)}` : t.stream,
        `Starts after ${hrs(s.start.get(t.key))} · takes ${fmtMinutes(t.estMinutes)}${group.length > 1 ? ' each' : ''}`,
        s.critical.has(t.key) ? 'On the longest chain' : `Waits on ${(t.dependsOn || []).length || 'nothing'}`,
      ],
    });
  };
  return html`<div class="card">
    <div class="card-head"><h2>Who works when</h2>
      <div class="tabs" role="tablist" aria-label="Timeline view" style=${{ margin: 0, border: 0 }}>
        <button role="tab" aria-selected=${view === 'chart'} onClick=${() => setView('chart')}>Chart</button>
        <button role="tab" aria-selected=${view === 'table'} onClick=${() => setView('table')}>Table</button>
      </div>
    </div>
    <p class="small muted" style=${{ marginBottom: '.6rem' }}>Each bar is a tile at its earliest start, if everyone begins as soon as their inputs exist. Bars marked ×N are N people working side by side. Outlined bars form the longest chain: ${hrs(s.span)} of hand-offs for ${hrs(s.total)} of work.</p>
    ${colors.order.length > 1 ? html`<div class="legend" aria-label="Workstreams">${colors.order.slice(0, 8).map((st) => html`<span><span class="sw" style=${{ background: colors.map.get(st) }}></span>${st}</span>`)}${colors.folded.length ? html`<span><span class="sw" style=${{ background: OTHER }}></span>Other (${colors.folded.join(', ')})</span>` : ''}<span><span class="sw outline"></span>Longest chain</span></div>` : ''}
    ${view === 'chart' ? html`<div class="graph-wrap timeline rel" ref=${wrapRef}>
      <svg width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} role="group" aria-label=${`Timeline of ${tiles.length} tiles over ${hrs(s.span)}`}>
        ${ticks.map((m) => html`<g><line class="tl-grid" x1=${labelW + m * px} x2=${labelW + m * px} y1=${top - 6} y2=${H - 4} /><text class="tl-axis" x=${labelW + m * px} y=${top - 10} text-anchor="middle">${m === 0 ? '0' : hrs(m)}</text></g>`)}
        ${rows.map((row, i) => html`<g transform=${`translate(0, ${top + i * rowH})`}>
          ${row.first ? html`<text class="tl-label" x=${labelW - 10} y=${rowH / 2 + 4} text-anchor="end">${row.stream.length > maxLabel ? `${row.stream.slice(0, maxLabel - 1)}…` : row.stream}</text>` : ''}
          ${row.bars.map((group) => {
            const t = group[0];
            const x = labelW + s.start.get(t.key) * px;
            const w = Math.max(3, t.estMinutes * px - 2);
            const crit = group.some((g) => s.critical.has(g.key));
            const label = `${group.length > 1 ? `${group.length} tiles: ` : ''}${t.title}. Starts after ${hrs(s.start.get(t.key))}, takes ${fmtMinutes(t.estMinutes)}${crit ? ', on the longest chain' : ''}.`;
            return html`<g class="tl-bar" tabindex="0" role="img" aria-label=${label}
              onMouseEnter=${(e) => show(e, group)} onFocus=${(e) => show(e, group)} onMouseLeave=${() => setTip(null)} onBlur=${() => setTip(null)}>
              <rect x=${x} y=${(rowH - barH) / 2} width=${w} height=${barH} rx="4" fill=${colors.map.get(t.stream || 'Work')} class=${crit ? 'crit' : ''} />
              <rect x=${x} y="0" width=${Math.max(w, 10)} height=${rowH} fill="transparent" />
              ${group.length > 1 ? html`<text class="tl-count" x=${x + w + 4} y=${rowH / 2 + 4}>×${group.length}</text>` : ''}
            </g>`;
          })}
        </g>`)}
      </svg>
      ${tip ? html`<div class="tl-tip" style=${{ left: `${Math.min(Math.max(tip.x, 110), W - 110)}px`, top: `${Math.max(tip.y, 70)}px` }} role="status"><b>${tip.title}</b>${tip.lines.map((l) => html`<div>${l}</div>`)}</div>` : ''}
    </div>` : html`<div class="table-wrap"><table>
      <thead><tr><th>Tile</th><th>Stream</th><th class="right">Starts after</th><th class="right">Takes</th><th>Longest chain</th></tr></thead>
      <tbody>${[...tiles].sort((a, b) => s.start.get(a.key) - s.start.get(b.key)).map((t) => html`<tr><td>${t.title}</td><td class="small">${t.stream || '—'}</td><td class="money">${hrs(s.start.get(t.key))}</td><td class="money">${fmtMinutes(t.estMinutes)}</td><td class="small">${s.critical.has(t.key) ? 'yes' : ''}</td></tr>`)}</tbody>
    </table></div>`}
  </div>`;
}

/* ------------------------------------------------------------------ tiles */

/** Collapses batch groups into one node each, so a 100-tile plan reads as a graph. */
export function collapseGroups(tiles) {
  const groupOf = new Map();
  for (const t of tiles) if (t.partOf && tiles.filter((x) => x.partOf === t.partOf).length > 1) groupOf.set(t.key, `grp-${t.partOf}`);
  const out = [];
  const seen = new Set();
  for (const t of tiles) {
    const g = groupOf.get(t.key);
    if (!g) { out.push({ ...t, dependsOn: [...new Set((t.dependsOn || []).map((d) => groupOf.get(d) || d))] }); continue; }
    if (seen.has(g)) continue;
    seen.add(g);
    const members = tiles.filter((x) => groupOf.get(x.key) === g);
    out.push({
      ...t, key: g, title: `${groupTitle(t.title)} ×${members.length}`,
      dependsOn: [...new Set(members.flatMap((m) => (m.dependsOn || []).map((d) => groupOf.get(d) || d)))].filter((d) => d !== g),
      payCents: members.reduce((n, m) => n + (m.payCents || 0), 0), estMinutes: t.estMinutes,
    });
  }
  return out;
}

export function TilesPanel({ tiles, quality, editable, onSplit, onMerge, onDrop, onOpen }) {
  const [view, setView] = useState('streams');
  const [picked, setPicked] = useState([]);
  const pick = (k) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  const collapsed = collapseGroups(tiles);
  return html`<div class="card">
    <div class="card-head"><h2>The tiles</h2>
      <div class="row">
        ${editable && picked.length >= 2 ? html`<button class="btn small primary" onClick=${() => { onMerge(picked); setPicked([]); }}>Merge ${picked.length} selected</button>` : ''}
        <div class="tabs" role="tablist" aria-label="Tile view" style=${{ margin: 0, border: 0 }}>
          <button role="tab" aria-selected=${view === 'streams'} onClick=${() => setView('streams')}>By workstream</button>
          <button role="tab" aria-selected=${view === 'graph'} onClick=${() => setView('graph')}>Graph</button>
        </div>
      </div>
    </div>
    ${view === 'graph' ? html`<${GraphView} tiles=${collapsed} colorBy="kind" onSelect=${onOpen ? (k) => onOpen(k) : undefined} />
      <p class="tiny muted" style=${{ marginTop: '.4rem' }}>Batch groups are shown once with their count (×N). Arrows point from a tile to the tiles that read its files.</p>`
      : html`<${StreamList} tiles=${tiles} quality=${quality} editable=${editable} picked=${picked} onPick=${pick} onSplit=${onSplit} onDrop=${onDrop} onOpen=${onOpen} />`}
  </div>`;
}

/** Tiles grouped by workstream, with batch groups folded into one expandable line. */
export function StreamList({ tiles, quality, editable = false, picked = [], onPick = () => {}, onSplit = () => {}, onDrop = () => {}, onOpen = null }) {
  const [open, setOpen] = useState(() => new Set());
  const colors = streamColors(tiles);
  const s = quality.schedule;
  const toggle = (k) => { const n = new Set(open); if (n.has(k)) n.delete(k); else n.add(k); setOpen(n); };
  const pick = onPick;
  return html`<div class="streams">${colors.order.map((stream) => {
        const list = tiles.filter((t) => (t.stream || 'Work') === stream);
        const groups = [];
        for (const t of list) {
          const g = t.partOf && list.filter((x) => x.partOf === t.partOf).length > 1 ? t.partOf : t.key;
          const found = groups.find((x) => x.id === g);
          if (found) found.tiles.push(t); else groups.push({ id: g, tiles: [t] });
        }
        return html`<section class="stream">
          <h3><span class="sw" style=${{ background: colors.map.get(stream) }}></span>${stream}<span class="tiny muted"> · ${list.length} tile${list.length > 1 ? 's' : ''} · ${hrs(list.reduce((n, t) => n + t.estMinutes, 0))}</span></h3>
          ${groups.map((g) => (g.tiles.length > 1
            ? html`<div class="tile-group">
                <button class="linklike" aria-expanded=${open.has(g.id)} onClick=${() => toggle(g.id)}>${open.has(g.id) ? '▾' : '▸'} <b>${groupTitle(g.tiles[0].title)}</b> — ${g.tiles.length} batches of about ${fmtMinutes(g.tiles[0].estMinutes)} covering ${groupRange(g.tiles)}, all at the same time</button>
                ${open.has(g.id) ? g.tiles.map((t) => html`<${TileRow} t=${t} s=${s} open=${open} toggle=${toggle} editable=${editable} picked=${picked.includes(t.key)} onPick=${pick} onSplit=${onSplit} onDrop=${onDrop} onOpen=${onOpen} />`) : ''}
              </div>`
            : html`<${TileRow} t=${g.tiles[0]} s=${s} open=${open} toggle=${toggle} editable=${editable} picked=${picked.includes(g.tiles[0].key)} onPick=${pick} onSplit=${onSplit} onDrop=${onDrop} onOpen=${onOpen} />`))}
        </section>`;
      })}</div>`;
}

function TileRow({ t, s, open, toggle, editable, picked, onPick, onSplit, onDrop, onOpen }) {
  const crit = t.acceptanceCriteria || [];
  const auto = crit.filter((c) => c.check === 'AUTO').length;
  const isOpen = open.has(t.key);
  return html`<div class=${`tile-row ${isOpen ? 'open' : ''}`}>
    <div class="tile-row-main">
      ${editable ? html`<input type="checkbox" aria-label=${`Select “${t.title}” to merge`} checked=${picked} onChange=${() => onPick(t.key)} />` : ''}
      <button class="linklike tile-title" aria-expanded=${isOpen} onClick=${() => (onOpen ? onOpen(t.key) : toggle(t.key))}>${t.title}</button>
      <span class="tile-meta small muted">
        ${t.kind !== 'WORK' ? html`<span class="badge">${t.kind.toLowerCase()}</span>` : ''}
        ${s.critical.has(t.key) ? html`<span class="badge warn" title="On the longest chain">chain</span>` : ''}
        ${(t.priority || 1) > 1 ? html`<span class="badge" title="Cut first when the budget is tight">${t.priority === 2 ? 'important' : 'nice to have'}</span>` : ''}
        <span class="num">${fmtMinutes(t.estMinutes)} · T${t.tier}${t.payCents ? ` · ${fmtMoney(t.payCents)}` : ''}</span>
      </span>
    </div>
    <div class="tile-io tiny">
      <span class="tags">${t.skillTags.map((x) => html`<span class="tag">${x}</span>`)}</span>
      <span class="muted">${(t.inputs || []).length ? `Reads ${(t.inputs || []).slice(0, 3).join(', ')}${t.inputs.length > 3 ? ` +${t.inputs.length - 3}` : ''}` : 'Starts from the brief'} → makes ${(t.outputs || []).join(', ') || t.deliverableFormat}</span>
      <span class="muted">${crit.length} check${crit.length === 1 ? '' : 's'}${auto ? `, ${auto} automatic` : ''}</span>
    </div>
    ${isOpen ? html`<div class="tile-detail">
      <pre class="spec">${t.spec}</pre>
      <p class="small"><b>Delivers:</b> ${t.deliverableFormat}</p>
      <ul class="crit-list">${crit.map((c) => html`<li><span class=${`badge ${c.check === 'AUTO' ? 'good' : c.check === 'PEER' ? 'warn' : 'info'}`}>${c.check}</span> ${c.text}${c.rule ? html` <code class="tiny">${c.rule}</code>` : ''}</li>`)}</ul>
      ${editable ? html`<div class="row" style=${{ marginTop: '.5rem' }}>
        <button class="btn small" onClick=${() => onSplit(t.key)} disabled=${t.kind === 'INTEGRATION' || t.estMinutes < 30}>Split in two</button>
        <button class="btn small ghost" onClick=${() => onDrop(t.key)}>Remove</button>
      </div>` : ''}
    </div>` : ''}
  </div>`;
}
