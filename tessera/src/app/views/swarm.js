// The agent swarm: hand any job to AI agents and watch them do every step after you
// submit it. The page takes the job; a commission's Swarm tab shows the agents at work.
import { html, useState, useMemo } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, navigate, currentUser, setPersona, act, toast, downloadBytes } from '../state.js';
import { Field, AsyncButton, Empty, StatusBadge, Mosaic, Legend, ago, STATUS_LABEL } from '../ui.js';
import { BREAKDOWN_EXAMPLES } from './breakdown.js';
import { analyzeJob } from '../../decompose/index.js';
import { swarmSettings, spentUsd } from '../../services/swarm.js';
import { MODEL_PRICES, shadowCostUsd } from '../../llm/prices.js';
import { fmtMoney, fmtBytes, truncate, fmtDateTime } from '../../lib/util.js';

/** Who a swarm job is submitted as: you, if you're playing a requester, otherwise the first requester persona. */
export function swarmPoster(T) {
  const me = currentUser(T);
  return me?.isRequester ? me : T.db.find('User', (u) => u.persona && u.isRequester);
}

/** Hands a job to the swarm as the poster, switching to that persona so the job is yours to watch. */
export async function handToSwarm(T, input) {
  const poster = swarmPoster(T);
  if (currentUser(T)?.id !== poster.id) setPersona(T, poster.id);
  const c = await act(() => T.api.runWithAgents(poster.id, input), 'Handed to the swarm. The agents take it from here.');
  if (c) navigate(`#/c/${c.id}/swarm`);
  return c;
}

const modelLabel = (id) => MODEL_PRICES[id]?.label || id;

/** Which model the agents run on and whether they can use the web, or that they're on the mock and hand in placeholders. */
export function SwarmModelNote() {
  const T = useT();
  const s = swarmSettings(T.db);
  const route = T.llm.agent(s.workerModel);
  if (route.providerName === 'mock') {
    return html`<div class="callout warn"><b>No model connected, so the agents run on the mock.</b> They go through every step, including a stand-in for web research, but the files they hand in are placeholders that pass the automatic checks. <a href="#/settings">Connect Claude in Settings</a> to have them do the real work and search the web.</div>`;
  }
  const claude = route.providerName === 'anthropic';
  return html`<div class="callout good">Agents work on <b>${claude ? modelLabel(s.workerModel) : route.label}</b>${claude ? html`, checks run on <b>${modelLabel(s.checkModel)}</b>` : ''}, up to ${s.concurrency} at once. ${claude && s.web ? html`Tiles that need outside facts <b>search the web</b> first (up to ${s.maxSearchesPerTile} searches each). ` : 'Web access is off, so outside facts are marked “(verify)”. '}Each job stops at <b>$${s.spendCapUsd}</b> of model spend. <a href="#/settings">Change in Settings</a>.</div>`;
}

const STATE = {
  RUNNING: ['info', 'Swarm running'],
  PAUSED: ['warn', 'Paused'],
  DONE: ['good', 'Signed off'],
};

export function SwarmStateBadge({ c }) {
  const [kind, label] = STATE[c.autopilot?.state || 'RUNNING'] || STATE.RUNNING;
  return html`<span class=${`badge ${kind}`}>${label}</span>`;
}

/** What the swarm is doing on a job right now, in a few words. */
export function swarmStage(db, c) {
  if (c.autopilot?.state === 'PAUSED') return 'Paused';
  if (c.status === 'SCOPING') {
    if (!c.clarifications.scopedAt) return 'The Scoping agent is reading the job';
    if (!c.clarifications.answeredAt) return 'The autopilot is answering the scoping questions';
    return 'The Decomposer is splitting the job into tiles';
  }
  if (c.status === 'PLANNED') return 'The autopilot is adapting the plan for agents and funding it';
  if (c.status === 'ACTIVE') {
    const n = (statuses) => db.count('Tile', (t) => t.commissionId === c.id && statuses.includes(t.status));
    const busy = n(['CLAIMED', 'REVISION']);
    const parts = [`${busy} tile${busy === 1 ? '' : 's'} being worked on`, `${n(['SUBMITTED', 'IN_REVIEW'])} being checked`];
    const waiting = n(['OPEN', 'OFFERED']);
    if (waiting) parts.push(`${waiting} being handed to an agent`);
    return parts.join(', ');
  }
  if (c.status === 'ASSEMBLING') return 'The Assembler is putting the deliverable together';
  if (c.status === 'DELIVERED') return c.autopilot?.rootCheck?.deliveredAt === c.deliveredAt ? 'The autopilot is signing off' : 'The root supervisor is judging the whole delivery';
  if (c.status === 'ACCEPTED') return 'Done';
  return STATUS_LABEL[c.status] || c.status;
}

function SwarmJobCard({ c }) {
  const T = useT();
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id && t.status !== 'CANCELLED');
  const planned = tiles.filter((t) => !t.dynamic);
  const accepted = planned.filter((t) => t.status === 'ACCEPTED').length;
  return html`<a class="card card-link" href=${`#/c/${c.id}/swarm`}>
    <div class="row-between"><h3 style=${{ margin: 0 }}>${c.title}</h3><${SwarmStateBadge} c=${c} /></div>
    <div class="small muted" style=${{ margin: '.3rem 0 .6rem' }}>${swarmStage(T.db, c)}</div>
    ${planned.length ? html`<${Mosaic} tiles=${tiles} /><div class="small" style=${{ marginTop: '.5rem' }}>${accepted} of ${planned.length} tiles accepted${c.autopilot?.note ? html` · <span class="muted">${truncate(c.autopilot.note, 90)}</span>` : ''}</div>` : ''}
  </a>`;
}

export function SwarmPage() {
  const T = useT();
  useDbVersion();
  const [form, setForm] = useState({ title: '', goal: '', sensitive: false });
  const [files, setFiles] = useState([]);
  const poster = swarmPoster(T);
  const jobs = T.db.filter('Commission', (c) => c.workforce === 'agents').sort((a, b) => b.createdAt - a.createdAt);
  const reading = useMemo(() => (form.goal.trim().length >= 20 ? analyzeJob({ title: form.title, goal: form.goal }) : null), [form.title, form.goal]);
  // A job that works on the requester's own material (their export, handbook, recordings) needs it attached.
  const needsMaterial = reading && !files.length && (reading.provided || /\b(translate|transcribe|clean up|categori[sz]e|code|proofread|edit|digiti[sz]e|reconcile|summari[sz]e)\b[^.]*\bour\b/i.test(form.goal));

  const onFiles = async (e) => {
    const list = [...e.target.files];
    const read = await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    setFiles([...files, ...read]);
    e.target.value = '';
  };
  const submit = async () => {
    const goal = form.goal.trim();
    if (goal.length < 20) { toast('Describe the job in a sentence or two (20+ characters).', 'err'); return; }
    const title = (form.title.trim() || reading?.title || goal.split(/[.:\n]/)[0]).slice(0, 120);
    await handToSwarm(T, { title: title.length >= 5 ? title : `${title} job`.padEnd(5, '.'), goal, files, privacy: form.sensitive ? 'RESTRICTED' : 'PUBLIC' });
  };

  return html`<div class="stack">
    <div class="page-head"><div>
      <h1>Hand a job to the agent swarm</h1>
      <p class="muted" style=${{ maxWidth: '62rem' }}>Describe any job and submit it. That’s your only step. A swarm of AI agents answers the scoping questions, splits the job into tiles, takes the tiles, does the work, checks each other, revises what fails, assembles the deliverable and signs it off.</p>
    </div></div>
    <${SwarmModelNote} />
    <div class="card">
      <div class="stack" style=${{ gap: '.8rem' }}>
        <${Field} label="What’s the job?" id="sw-goal" hint="Say what should exist when it’s done, with counts where you know them. The job text is treated as data, never as instructions to the agents.">
          <textarea id="sw-goal" rows="5" value=${form.goal} onInput=${(e) => setForm({ ...form, goal: e.target.value })} placeholder="Write a federal grant proposal for our after-school STEM program: needs statement, program design, evaluation plan, budget and budget narrative…"></textarea>
        <//>
        <div class="inline-fields">
          <${Field} label="Short title (optional)" id="sw-title"><input id="sw-title" type="text" maxlength="120" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.target.value })} placeholder="STEM grant proposal" /><//>
          <${Field} label="Files the agents work from (optional)" id="sw-files" hint="Text, CSV, Markdown or JSON. Batch tiles get only their rows."><input id="sw-files" type="file" multiple onChange=${onFiles} /><//>
        </div>
        ${files.length ? html`<ul class="filelist">${files.map((f, i) => html`<li><span class="name">${f.name}</span><span class="muted small">${fmtBytes(f.bytes.length)}</span><button type="button" class="btn small ghost" aria-label=${`Remove ${f.name}`} onClick=${() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></li>`)}</ul>` : ''}
        <label class="choice"><input type="checkbox" checked=${form.sensitive} onChange=${(e) => setForm({ ...form, sensitive: e.target.checked })} /> <span>The material includes personal or confidential information (it’s redacted before any agent sees it)</span></label>
        ${needsMaterial ? html`<div class="callout warn">This job works on your own material${reading.sources?.length ? ` (${reading.sources.slice(0, 2).join(', ')})` : ''}. Attach it, or the agents will build the method and run it on a labeled sample, and tell you how to run it on the real thing.</div>` : ''}
        <div class="row">
          <${AsyncButton} class="primary" onClick=${submit}>Hand it to the swarm<//>
          <span class="small muted">${poster ? html`You’ll submit as <b>${poster.name}</b>${currentUser(T)?.id !== poster.id ? ' (a requester persona)' : ''}.` : ''}</span>
        </div>
      </div>
      <div class="row" style=${{ marginTop: '.9rem', gap: '.35rem' }}><span class="small muted">Try:</span>${BREAKDOWN_EXAMPLES.map((e) => html`<button type="button" class="btn small ghost-line" onClick=${() => setForm({ title: e.title, goal: e.goal, sensitive: !!e.sensitive })}>${e.label}</button>`)}</div>
    </div>
    <h2 class="section-title">Jobs the swarm has run</h2>
    ${jobs.length ? html`<div class="grid-2">${jobs.map((c) => html`<${SwarmJobCard} c=${c} key=${c.id} />`)}</div><${Legend} />` : html`<div class="card"><${Empty} title="No swarm jobs yet">Submit one above, or pick an example to see the whole run.</${Empty}></div>`}
    <div class="grid-3">
      <div class="card"><h3>Every step after yours</h3><p class="small">The autopilot answers the scoping questions from your text and marks what it assumed. Agents take tiles through the same offers, checks, peer reviews and revisions people use, and every call is logged under the job’s Agent runs.</p></div>
      <div class="card"><h3>Honest about the real world</h3><p class="small">Agents can search and read the web and cite what they found, but can’t call, record or visit. Tiles that need that become the kit a person needs (scripts, guides, outreach messages), unconfirmed facts are marked (verify), and missing data is a labeled SAMPLE. The deliverable lists what a person still has to do.</p></div>
      <div class="card"><h3>Competed, then checked</h3><p class="small">Several worker configs do each tile blind, and a supervisor on a different model scores their drafts after the automatic checks, on criteria written before the work. It accepts the best, sends weak rounds back, re-splits what keeps failing, and brings what it can’t judge to you on the <a href="#/supervision">Supervision</a> page. Batch files are merged by code, so a 5,000-row merge is exact, and a long tile can be split among agents working at once.</p></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- the Swarm tab on a commission

function activityText(db, t, now) {
  const a = t.agentActivity;
  if (t.supervision?.state === 'escalated' && ['CLAIMED', 'REVISION'].includes(t.status)) return html`<a href="#/supervision" class="bad-text" title=${t.supervision.reason}>Needs you: ${truncate(t.supervision.reason, 60)}</a>`;
  if (a?.error && ['CLAIMED', 'REVISION', 'OPEN'].includes(t.status)) return html`<span class="bad-text" title=${a.error}>Failed: ${truncate(a.error, 70)}</span>`;
  if (a?.doing && ['CLAIMED', 'REVISION'].includes(t.status)) return html`<span><span class="spinner" style=${{ width: '12px', height: '12px' }}></span> ${a.doing} · ${ago(a.since, now)}</span>`;
  if (t.status === 'CLAIMED' || t.status === 'REVISION') return t.status === 'REVISION' ? 'Waiting to revise' : 'Waiting for a slot';
  if (t.status === 'IN_REVIEW' || t.status === 'SUBMITTED') return t.pendingReviewTileId ? 'Waiting for a peer review' : 'Being checked';
  if (t.status === 'ACCEPTED') {
    const subs = db.count('Submission', (s) => s.tileId === t.id);
    return subs > 1 ? `Accepted on round ${subs}` : 'Accepted';
  }
  if (t.status === 'LOCKED') return 'Waiting on upstream tiles';
  return STATUS_LABEL[t.status] || t.status;
}

const secsText = (n) => (n < 90 ? `${n} s` : `${Math.round(n / 60)} min`);

/** The one-line note under a tile: what's special about how an agent does it. */
function tileNote(db, t) {
  const notes = [];
  const sub = t.acceptedSubmissionId ? db.get('Submission', t.acceptedSubmissionId) : null;
  const sv = sub?.supervised;
  if (sv?.by === 'requester') notes.push('Settled by you from an escalation');
  else if (sv?.winner) notes.push(`${sv.winner.configName} won the competition with ${sv.score.toFixed(2)}${sv.flagged ? ' · flagged: the workers disagreed' : ''}`);
  else if (sv) notes.push(`Parts competed; joined parts scored ${sv.score.toFixed(2)}${sv.flagged ? ' · flagged' : ''}`);
  if (t.agentTiming?.parts) notes.push(`Split among ${t.agentTiming.parts} agents working at once`);
  else if (t.splitHint && t.status !== 'ACCEPTED') notes.push(`May split among up to ${t.splitHint.parts} agents`);
  if (t.agentTiming?.seconds) notes.push(`Took ${secsText(t.agentTiming.seconds)} (expected ${secsText(t.agentTiming.estSeconds)})`);
  else if (t.agentEstimate && t.status !== 'ACCEPTED') notes.push(`About ${secsText(t.agentEstimate)} for one agent`);
  const mode = { prepare: 'Prepares a kit for a person', 'sample-data': 'Works on a labeled sample', verify: 'A person confirms the result', researched: 'Facts looked up on the web, with sources' }[t.agentMode];
  if (mode) notes.push(mode);
  if (t.webResearch && !t.agentMode) notes.push('Researches on the web first');
  if (t.research?.unavailable) notes.push('No web access: outside facts marked “(verify)”');
  else if (t.research) notes.push(`${t.research.searches || 0} searches, ${(t.research.sources || []).filter((x) => x.kind !== 'searched').length} sources`);
  if (t.independentCheck) notes.push('Checked on a different model');
  return notes.join(' · ');
}

const ORDER = ['CLAIMED', 'REVISION', 'SUBMITTED', 'IN_REVIEW', 'OFFERED', 'OPEN', 'LOCKED', 'ACCEPTED', 'CANCELLED', 'DRAFT'];

export function SwarmTab({ c, owner }) {
  const T = useT();
  const now = useNow(1000);
  const me = currentUser(T);
  const steward = owner || me?.isAdmin;
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id && t.status !== 'CANCELLED');
  const planned = tiles.filter((t) => !t.dynamic);
  const accepted = planned.filter((t) => t.status === 'ACCEPTED').length;
  const agents = new Set(tiles.map((t) => t.claimedById).filter((id) => id && T.db.get('User', id)?.isAgent));
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === c.id);
  const spent = spentUsd(T.db, c.id);
  const shadow = runs.reduce((n, r) => n + shadowCostUsd(r), 0);
  const mock = runs.length > 0 && runs.every((r) => r.provider === 'mock');
  const peoplePay = planned.reduce((n, t) => n + (t.payCents || 0), 0);
  const handoffs = handoffList(T.db, c, planned);
  const feed = T.db.filter('StatusChange', (x) => x.commissionId === c.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  const sorted = [...tiles].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.dynamic - b.dynamic));
  const withResearch = planned.filter((t) => t.research && !t.research.unavailable);
  const sources = [];
  const seenUrls = new Set();
  for (const t of withResearch) for (const x of t.research.sources || []) if (x.kind !== 'searched' && !seenUrls.has(x.url)) { seenUrls.add(x.url); sources.push({ ...x, tileTitle: t.title }); }
  const searches = withResearch.reduce((n, t) => n + (t.research.searches || 0), 0);
  const reads = withResearch.reduce((n, t) => n + (t.research.reads || 0), 0);
  const researched = withResearch.length;
  const zip = async () => {
    const bytes = await act(() => T.api.buildDeliverableZip(c.id));
    if (bytes) downloadBytes(bytes, `${c.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.zip`, 'application/zip');
  };
  const paused = c.autopilot?.state === 'PAUSED';
  const finished = ['ACCEPTED', 'CANCELLED'].includes(c.status);

  return html`<div class="stack">
    ${!finished ? html`<${SwarmModelNote} />` : ''}
    <div class="card">
      <div class="row-between">
        <div><h2 style=${{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>The swarm <${SwarmStateBadge} c=${c} /></h2>
          <p class="small" role="status">${!finished && !paused ? html`<span class="spinner" style=${{ width: '12px', height: '12px' }}></span> ` : ''}${swarmStage(T.db, c)}${c.autopilot?.note ? html` · <span class="muted">${c.autopilot.note}</span>` : ''}</p></div>
        <div class="row">
          ${steward && !finished ? (paused
            ? html`<${AsyncButton} class="primary" onClick=${() => act(() => T.api.resumeSwarmJob(me.id, c.id), 'Resumed. The agents pick up where they left off.')}>Resume<//>`
            : html`<${AsyncButton} onClick=${() => act(() => T.api.pauseSwarmJob(me.id, c.id), 'Paused. Work in flight finishes; nothing new starts.')}>Pause<//>`) : ''}
          ${c.deliverableKey ? html`<button class="btn" onClick=${zip}>Download the deliverable</button>` : ''}
        </div>
      </div>
      <div class="stats" style=${{ marginTop: '.8rem' }}>
        <div class="stat"><span class="v">${accepted} / ${planned.length || '—'}</span><span class="l">Tiles accepted</span></div>
        <div class="stat"><span class="v">${agents.size}</span><span class="l">Agents on it</span></div>
        <div class="stat"><span class="v">${runs.length}</span><span class="l">Model calls</span></div>
        ${c.autopilot?.estimate?.seconds ? html`<div class="stat"><span class="v">~${Math.max(1, Math.round(c.autopilot.estimate.seconds / 60))} min</span><span class="l">Expected agent time, longest chain</span></div>` : ''}
        <div class="stat"><span class="v">${mock ? '$0' : `$${spent.toFixed(2)}`}</span><span class="l">${mock ? html`Model spend (about $${shadow.toFixed(2)} on Claude)` : 'Model spend'}</span></div>
        <div class="stat"><span class="v">${peoplePay ? fmtMoney(peoplePay) : '—'}</span><span class="l">The same tiles paid to people</span></div>
      </div>
      ${planned.length ? html`<div style=${{ marginTop: '.8rem' }}><${Mosaic} tiles=${tiles} onPick=${(t) => navigate(`#/t/${t.id}`)} /></div>` : ''}
    </div>
    ${(c.autopilot?.changes || []).length ? html`<div class="card"><h2>How the plan was adapted for agents</h2><ul class="small" style=${{ marginTop: '.4rem', paddingLeft: '1.1rem' }}>${c.autopilot.changes.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
    <div class="split">
      <div class="card">
        <h2>Agents at work</h2>
        ${sorted.length ? html`<div class="table-wrap"><table>
          <thead><tr><th>Tile</th><th>Agent</th><th>Status</th><th>Now</th></tr></thead>
          <tbody>${sorted.map((t) => html`<tr class="clickable" tabindex="0" onClick=${() => navigate(`#/t/${t.id}`)} onKeyDown=${(e) => e.key === 'Enter' && navigate(`#/t/${t.id}`)}>
            <td><b>${truncate(t.title, 70)}</b>${tileNote(T.db, t) ? html`<div class="tiny muted">${tileNote(T.db, t)}</div>` : ''}</td>
            <td class="small nowrap">${t.claimedById ? T.db.get('User', t.claimedById)?.name : '—'}</td>
            <td><${StatusBadge} status=${t.status} /></td>
            <td class="small">${activityText(T.db, t, now)}</td>
          </tr>`)}</tbody></table></div>` : html`<${Empty} title="No tiles yet">${swarmStage(T.db, c)}.</${Empty}>`}
      </div>
      <div class="stack">
        <div class="card">
          <h2>What a person still needs to do</h2>
          ${handoffs.length ? html`<ul class="small" style=${{ marginTop: '.4rem', paddingLeft: '1.1rem' }}>${handoffs.map((h) => html`<li><b>${h.title}</b>: ${h.handoff}</li>`)}</ul>` : html`<p class="small muted" style=${{ marginTop: '.4rem' }}>Nothing so far: the agents can do every tile of this job themselves.</p>`}
        </div>
        ${sources.length ? html`<div class="card"><h2>Sources the agents used</h2>
          <ol class="small" style=${{ marginTop: '.4rem', paddingLeft: '1.3rem' }}>${sources.slice(0, 40).map((x) => html`<li style=${{ overflowWrap: 'anywhere' }}><a href=${/^https?:\/\//i.test(x.url) ? x.url : undefined} target="_blank" rel="noopener noreferrer">${truncate(x.title || x.url, 80)}</a> <span class="tiny muted">· ${x.tileTitle}</span></li>`)}</ol>
          <p class="tiny muted" style=${{ marginTop: '.4rem' }}>${searches} web search${searches === 1 ? '' : 'es'} and ${reads} page${reads === 1 ? '' : 's'} read across ${researched} tile${researched === 1 ? '' : 's'}.</p></div>` : ''}
        <div class="card"><h2>Activity</h2><ul class="feed">${feed.map((ch) => html`<li><time title=${fmtDateTime(ch.createdAt)}>${ago(ch.createdAt, now)}</time><span>${changeText(T.db, ch)}</span></li>`)}</ul></div>
      </div>
    </div>
  </div>`;
}

function handoffList(db, c, planned) {
  const out = [];
  const seen = new Set();
  for (const t of planned) {
    const sub = t.acceptedSubmissionId ? db.get('Submission', t.acceptedSubmissionId) : null;
    const text = [t.handoff, sub?.handoff].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' ');
    if (text && !seen.has(t.key)) { seen.add(t.key); out.push({ title: t.title, handoff: text }); }
  }
  return out;
}

function changeText(db, ch) {
  const actor = db.get('User', ch.actor);
  const who = actor ? actor.name : ch.actor;
  if (ch.entity === 'Commission') return html`Job <b>${STATUS_LABEL[ch.from] || ch.from} → ${STATUS_LABEL[ch.to] || ch.to}</b> <span class="muted">by ${who}${ch.note ? ` · ${ch.note}` : ''}</span>`;
  const t = db.get('Tile', ch.entityId);
  return html`<a href=${`#/t/${ch.entityId}`}>${t ? truncate(t.title, 50) : 'a tile'}</a>: <b>${STATUS_LABEL[ch.from] || ch.from} → ${STATUS_LABEL[ch.to] || ch.to}</b> <span class="muted">by ${who}${ch.note ? ` · ${ch.note}` : ''}</span>`;
}
