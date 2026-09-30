// The Supervision page: how the swarm's competition and supervisors are doing. Tasks the
// supervisors escalated wait here for you; below are the leaderboard of worker configs by task
// type, the lessons with their measured lift, the supervisors' reliability with a sample of
// accepted tasks for your review, the wire (the notes agents post each other, and who used them),
// the configs' lineage, and the supervisors' latest actions.
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, currentUser, setPersona, act } from '../state.js';
import { AsyncButton, Empty, Field, ago } from '../ui.js';
import { StoredFile } from './tile.js';
import { leaderboard, lessonLift, supervisorReliability } from '../../domain/supervision.js';
import { swarmSettings } from '../../services/swarm.js';
import { truncate, fmtDateTime } from '../../lib/util.js';
import { MODEL_PRICES } from '../../llm/prices.js';

const ACTION = {
  accept: ['good', 'Accepted'],
  accept_flag: ['warn', 'Accepted, flagged'],
  send_back: ['info', 'Sent back'],
  reveal: ['', 'Second round'],
  resplit: ['info', 'Re-split'],
  split: ['', 'Split for speed'],
  escalate: ['bad', 'Escalated'],
  single: ['', 'One agent'],
};

export function ActionBadge({ action }) {
  const [kind, label] = ACTION[action] || ['', action];
  return html`<span class=${`badge ${kind}`}>${label}</span>`;
}

const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${Math.round(x * 100)}%`);
const usd = (micro) => (micro ? `$${(micro / 1e6).toFixed(micro < 10000 ? 4 : 2)}` : '$0');

/** One attempt at an escalated task: who made it, how it scored, what failed, its files, and a button to accept it. */
function AttemptRow({ a, canAct, onAccept }) {
  const T = useT();
  const score = T.db.find('Score', (x) => x.attemptId === a.id);
  const fails = (a.hardResults || []).filter((r) => !r.pass);
  return html`<li class="card flat" style=${{ padding: '.6rem .8rem' }}>
    <div class="row-between">
      <div><b>${a.label}</b> · ${a.configName} <span class="tiny muted">· ${a.round} round${a.cycle > 1 ? `, try ${a.cycle}` : ''}${a.control ? ' · control (no playbook)' : ''}</span></div>
      <div class="row">
        <span class=${`badge ${a.hardPass ? 'good' : 'bad'}`}>${a.hardPass ? 'Checks pass' : 'Fails a check'}</span>
        ${score ? html`<span class="badge">${score.score.toFixed(2)}</span>` : ''}
        ${canAct && a.files?.length ? html`<${AsyncButton} class="small primary" onClick=${() => onAccept(a)}>Accept this one<//>` : ''}
      </div>
    </div>
    ${a.error ? html`<p class="small bad-text">The worker failed: ${a.error}</p>` : ''}
    ${fails.length ? html`<ul class="tiny bad-text" style=${{ margin: '.3rem 0 0', paddingLeft: '1.1rem' }}>${fails.map((r) => html`<li>${r.reason}</li>`)}</ul>` : ''}
    ${score?.summary ? html`<p class="tiny muted" style=${{ margin: '.3rem 0 0' }}>Supervisor: ${score.summary}</p>` : ''}
    ${a.files?.length ? html`<ul class="filelist" style=${{ marginTop: '.4rem' }}>${a.files.map((f) => html`<${StoredFile} file=${f} />`)}</ul>` : ''}
  </li>`;
}

/** A task the supervisor escalated: why, every attempt it has, and what you can do about it. */
function Escalation({ t }) {
  const T = useT();
  const me = currentUser(T);
  const c = T.db.get('Commission', t.commissionId);
  const owner = me && (me.id === c.requesterId || me.isAdmin);
  const [feedback, setFeedback] = useState('');
  const [all, setAll] = useState(false);
  const spec = T.db.get('TaskSpec', t.supervision.specId);
  const specIds = new Set([spec?.id, ...T.db.filter('TaskSpec', (x) => x.parentSpecId === spec?.id).map((x) => x.id)]);
  // Latest round first, and within a round A, B, C.
  const RANK = { blind: 0, notes: 1, reveal: 1, revise: 2, merge: 3 };
  const attempts = T.db.filter('Attempt', (a) => specIds.has(a.specId)).sort((a, b) => b.cycle - a.cycle || RANK[b.round] - RANK[a.round] || a.label.localeCompare(b.label));
  const latest = attempts.filter((a) => a.specId === spec?.id && a.round === attempts.find((x) => x.specId === spec?.id)?.round && a.cycle === attempts.find((x) => x.specId === spec?.id)?.cycle);
  const shown = all ? attempts.filter((a) => a.specId === spec?.id) : latest;
  const requester = T.db.get('User', c.requesterId);
  return html`<div class="card stack-sm">
    <div class="row-between">
      <div><h3 style=${{ margin: 0 }}><a href=${`#/t/${t.id}`}>${t.title}</a></h3>
        <div class="small muted">${c.title} · escalated ${ago(t.supervision.at, T.clock.now())}</div></div>
      <${ActionBadge} action="escalate" />
    </div>
    <div class="callout warn">${t.supervision.reason}</div>
    ${shown.length ? html`<ul class="stack-sm" style=${{ listStyle: 'none', padding: 0, margin: 0 }}>${shown.map((a) => html`<${AttemptRow} a=${a} canAct=${owner} key=${a.id} onAccept=${(x) => act(() => T.api.resolveEscalation(me.id, t.id, { action: 'accept', attemptId: x.id }), `Accepted attempt ${x.label}. It goes to the checks, then the merge.`)} />`)}</ul>` : html`<p class="small muted">No attempt handed in files.</p>`}
    ${attempts.filter((a) => a.specId === spec?.id).length > latest.length ? html`<button class="btn small ghost-line" onClick=${() => setAll(!all)}>${all ? 'Show the last round only' : 'Show every round'}</button>` : ''}
    ${owner ? html`<${Field} label="Or send it back with what to change" id=${`fb-${t.id}`} hint="Every competitor gets your note with the task, and the supervisor scores the new round as usual.">
        <textarea id=${`fb-${t.id}`} rows="2" value=${feedback} onInput=${(e) => setFeedback(e.target.value)} placeholder="Use the budget figures from the style sheet; don’t add new line items."></textarea>
      <//>
      <div class="row">
        <${AsyncButton} onClick=${() => act(() => T.api.resolveEscalation(me.id, t.id, { action: 'send_back', feedback }), 'Sent back. The workers compete again with your note.')}>Send it back<//>
        <${AsyncButton} class="ghost-line" onClick=${() => act(() => T.api.resolveEscalation(me.id, t.id, { action: 'single' }), 'One agent will do it, checked by the Reviewer.')}>Give it to one agent<//>
      </div>` : html`<p class="small">Only the job’s requester can settle it. <button class="btn small" onClick=${() => setPersona(T, requester.id)}>Switch to ${requester.name}</button></p>`}
  </div>`;
}

/** The headline numbers: how tasks ended, how often workers herd, and how well the cache is used. */
function Overview() {
  const T = useT();
  const specs = T.db.filter('TaskSpec', (x) => !x.parentSpecId);
  const acts = T.db.all('SupervisorAction');
  const count = (a) => acts.filter((x) => x.action === a).length;
  const firstTry = specs.filter((x) => x.status === 'accepted' && !acts.some((a) => a.specId === x.id && ['send_back', 'resplit'].includes(a.action))).length;
  const herd = specs.filter((x) => x.herding).reduce((n, x) => ({ rev: n.rev + x.herding.revisions, worst: n.worst + x.herding.towardWorst }), { rev: 0, worst: 0 });
  const runs = T.db.filter('AgentRun', (r) => (r.agent === 'worker' || r.agent === 'supervisor') && !r.error && r.competitor);
  const read = runs.reduce((n, r) => n + (r.tokensCacheRead || 0), 0);
  const total = runs.reduce((n, r) => n + (r.tokensIn || 0) + (r.tokensCacheWrite || 0) + (r.tokensCacheRead || 0), 0);
  const spend = specs.reduce((n, x) => n + (x.costMicroUsd || 0), 0);
  const notes = T.db.count('AgentMessage');
  const winners = new Set(specs.map((x) => x.winnerAttemptId).filter(Boolean));
  const usedByWinners = new Set(T.db.filter('Attempt', (a) => winners.has(a.id)).flatMap((a) => a.usedMessageIds || []));
  const revisions = T.db.filter('Attempt', (a) => ['notes', 'reveal', 'revise'].includes(a.round) && !a.error);
  const byEdit = revisions.filter((a) => a.edited > 0).length;
  return html`<div class="card">
    <h2>How tasks end</h2>
    <div class="stats" style=${{ marginTop: '.6rem' }}>
      <div class="stat"><span class="v">${specs.length}</span><span class="l">Tasks competed</span></div>
      <div class="stat"><span class="v">${specs.length ? pct(firstTry / specs.length) : '—'}</span><span class="l">Accepted on the first round</span></div>
      <div class="stat"><span class="v">${count('accept_flag')}</span><span class="l">Accepted with a flag</span></div>
      <div class="stat"><span class="v">${count('send_back')}</span><span class="l">Sent back</span></div>
      <div class="stat"><span class="v">${count('resplit')}</span><span class="l">Re-split</span></div>
      <div class="stat"><span class="v">${count('escalate')}</span><span class="l">Escalated to you</span></div>
      <div class="stat"><span class="v">${count('reveal')}</span><span class="l">Second rounds</span></div>
      <div class="stat" title="Second-round revisions that moved toward the blind draft that scored worst. High means workers copy instead of checking."><span class="v">${herd.rev ? pct(herd.worst / herd.rev) : '—'}</span><span class="l">Herding (${herd.worst} of ${herd.rev} revisions)</span></div>
      <div class="stat" title="Notes agents posted on the wire, and how many of them accepted work relied on."><span class="v">${notes}</span><span class="l">Notes on the wire (${usedByWinners.size} used by winners)</span></div>
      <div class="stat" title="Revisions handed back as edits to the worker’s own draft instead of a full rewrite: far fewer output tokens."><span class="v">${revisions.length ? pct(byEdit / revisions.length) : '—'}</span><span class="l">Revisions by edit</span></div>
      <div class="stat" title="Share of the input tokens on competing calls read from the prompt cache. A falling rate means something dynamic slipped into a cached layer."><span class="v">${total ? pct(read / total) : '—'}</span><span class="l">Input read from the cache</span></div>
      <div class="stat"><span class="v">${usd(spend)}</span><span class="l">Model spend on competition</span></div>
    </div>
  </div>`;
}

function Leaderboard() {
  const T = useT();
  const rows = leaderboard(T.db.all('WorkerStats'), T.db.all('WorkerConfig'));
  return html`<div class="card">
    <h2>Leaderboard by task type</h2>
    <p class="small muted">Wins, average rubric score and cost per worker config. A config that wins most tasks of a type gets fewer rivals on it (routing), and on “auto” may work alone. Configs that score about the same are ranked cheapest first. Assists count the notes a config posted that other configs’ winning work relied on; they earn a small bonus in the ranking.</p>
    ${rows.length ? html`<div class="table-wrap" style=${{ marginTop: '.6rem' }}><table>
      <thead><tr><th>Task type</th><th>Config</th><th>Model</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Avg score</th><th class="num">Avg cost</th><th class="num">Notes / assists</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td>${r.taskType}</td><td>${r.name}${r.status === 'retired' ? html` <span class="badge">retired</span>` : ''}</td><td class="small">${modelName(r.model)}</td>
        <td class="num">${r.wins} / ${r.attempts}</td><td class="num">${pct(r.winRate)}</td><td class="num">${r.avgScore.toFixed(2)}</td><td class="num">${r.avgCostUsd ? `$${r.avgCostUsd.toFixed(4)}` : '$0'}</td><td class="num">${r.notes} / ${r.assists}</td>
      </tr>`)}</tbody></table></div>` : html`<${Empty} title="No tasks scored yet">Hand a job to the swarm and the configs start competing.<//>`}
  </div>`;
}

/** A config's model as a reader knows it: the worker model from Settings, a named Claude model, or the free models. */
function modelName(model) {
  if (!model) return 'Worker model';
  if (model === 'free') return 'Free models';
  return MODEL_PRICES[model]?.label || model;
}

const KIND = { tip: 'info', warning: 'warn', question: '', answer: 'good' };

/** The wire: the notes agents post each other, newest first, with who relied on each. */
function Wire() {
  const T = useT();
  const now = useNow(10000);
  const [all, setAll] = useState(false);
  const notes = T.db.all('AgentMessage').sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const usedBy = new Map();
  const winners = new Set(T.db.all('TaskSpec').map((x) => x.winnerAttemptId).filter(Boolean));
  for (const a of T.db.filter('Attempt', (x) => x.usedMessageIds?.length)) {
    for (const id of a.usedMessageIds) {
      const u = usedBy.get(id) || { n: 0, won: 0 };
      u.n++;
      if (winners.has(a.id)) u.won++;
      usedBy.set(id, u);
    }
  }
  const shown = all ? notes.slice(0, 200) : notes.slice(0, 12);
  return html`<div class="card">
    <h2>The wire</h2>
    <p class="small muted">Short notes the agents post each other while they work: to the agents on the other tiles of the job (team), or to their rivals on the same task, who read them in the next round. Each agent says which notes it used; a note that accepted work relied on earns its author an assist.</p>
    ${notes.length ? html`<ul class="feed" style=${{ marginTop: '.6rem' }}>${shown.map((m) => {
      const u = usedBy.get(m.id);
      return html`<li><time title=${fmtDateTime(m.createdAt)}>${ago(m.createdAt, now)}</time><span>
        <span class=${`badge ${KIND[m.kind] || ''}`}>${m.kind}</span> <span class="tiny muted">${m.to === 'rivals' ? 'to rivals' : 'to the team'} · ${m.fromName}${m.label ? ` (${m.label})` : ''} on <a href=${`#/t/${m.tileId}`}>${truncate(m.taskTitle || 'a tile', 40)}</a></span>
        <div class="small">${m.text}</div>
        ${u ? html`<div class="tiny muted">Used by ${u.n} attempt${u.n > 1 ? 's' : ''}${u.won ? html`, <b>${u.won} of them accepted</b>` : ''}.</div>` : ''}
      </span></li>`;
    })}</ul>
    ${notes.length > 12 ? html`<button class="btn small ghost-line" onClick=${() => setAll(!all)}>${all ? 'Show the latest only' : `Show all ${Math.min(notes.length, 200)}`}</button>` : ''}` : html`<${Empty} title="No notes yet">Agents post notes when they find something the others should know.<//>`}
  </div>`;
}

function Lessons() {
  const T = useT();
  const configs = new Map(T.db.all('WorkerConfig').map((c) => [c.id, c]));
  const lessons = T.db.all('Lesson').sort((a, b) => ({ active: 0, candidate: 1, retired: 2 }[a.status] - { active: 0, candidate: 1, retired: 2 }[b.status]) || b.createdAt - a.createdAt);
  const trials = swarmSettings(T.db).lessonTrials;
  const kind = { active: 'good', candidate: 'info', retired: '' };
  return html`<div class="card">
    <h2>Lessons</h2>
    <p class="small muted">Written by the reflection agent after each scored task. Shared lessons go into the playbook every worker on the task type reads, except one control worker per task; personal ones go to one config. After ${trials} trials a candidate is kept if it raised scores and retired if it didn’t.</p>
    ${lessons.length ? html`<div class="table-wrap" style=${{ marginTop: '.6rem' }}><table>
      <thead><tr><th>Lesson</th><th>For</th><th class="num">Trials with / without</th><th class="num">Lift</th><th>Status</th></tr></thead>
      <tbody>${lessons.map((l) => {
        const lift = lessonLift(l);
        return html`<tr>
          <td class="small" title=${l.evidence}>${l.text}</td>
          <td class="small nowrap">${l.taskType}<div class="tiny muted">${l.scope === 'shared' ? 'playbook' : configs.get(l.configId)?.name || 'one config'}</div></td>
          <td class="num small">${l.trialsWith} / ${l.trialsWithout}</td>
          <td class="num small">${lift === null ? '—' : `${lift >= 0 ? '+' : ''}${lift.toFixed(3)}`}</td>
          <td><span class=${`badge ${kind[l.status]}`}>${l.status}</span></td>
        </tr>`;
      })}</tbody></table></div>` : html`<${Empty} title="No lessons yet">They appear after the first tasks are scored.<//>`}
  </div>`;
}

function Supervisors() {
  const T = useT();
  const me = currentUser(T);
  const audits = T.db.all('SupervisorAudit');
  const threshold = swarmSettings(T.db).threshold;
  const groups = new Map();
  for (const a of audits) (groups.get(a.supervisorId) || groups.set(a.supervisorId, []).get(a.supervisorId)).push(a);
  const queue = audits.filter((a) => a.sampled && !a.yourReview).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  return html`<div class="card stack-sm">
    <h2>Supervisors</h2>
    <p class="small muted">A supervisor scores each attempt without seeing the automatic checks, so its verdicts can be compared with them. A share of accepted tasks comes to you below: your verdicts are the other half of its record.</p>
    ${groups.size ? html`<div class="table-wrap"><table>
      <thead><tr><th>Supervisor</th><th class="num">Attempts scored</th><th class="num">Agrees with the checks</th><th class="num">You reviewed</th><th class="num">You agree</th></tr></thead>
      <tbody>${[...groups.entries()].map(([id, list]) => {
        const r = supervisorReliability(list, threshold);
        return html`<tr><td class="small">${id}</td><td class="num">${r.scored}</td><td class="num">${pct(r.checkAgreement)}</td><td class="num">${r.reviewed}</td><td class="num">${pct(r.reviewAgreement)}</td></tr>`;
      })}</tbody></table></div>` : html`<p class="small muted">No supervisor has scored anything yet.</p>`}
    <h3>Accepted tasks for your review</h3>
    ${queue.length ? html`<ul class="stack-sm" style=${{ listStyle: 'none', padding: 0, margin: 0 }}>${queue.map((a) => {
      const spec = T.db.get('TaskSpec', a.specId);
      const att = T.db.get('Attempt', a.attemptId);
      const c = T.db.get('Commission', a.commissionId);
      const owner = me && (me.id === c?.requesterId || me.isAdmin);
      return html`<li class="card flat" style=${{ padding: '.6rem .8rem' }}>
        <div class="row-between"><div><a href=${`#/t/${spec?.tileId}`}><b>${truncate(spec?.title || 'A task', 70)}</b></a> <span class="tiny muted">· ${att?.configName} won with ${a.supervisorScore.toFixed(2)}</span></div>
        ${owner ? html`<div class="row"><${AsyncButton} class="small" onClick=${() => act(() => T.api.reviewAudit(me.id, a.id, 'agree'), 'Noted: you agree with the supervisor.')}>Agree<//><${AsyncButton} class="small ghost-line" onClick=${() => act(() => T.api.reviewAudit(me.id, a.id, 'disagree'), 'Noted: you disagree with the supervisor.')}>Disagree<//></div>` : html`<span class="tiny muted">For ${T.db.get('User', c?.requesterId)?.name || 'the requester'} to review</span>`}</div>
        ${att?.files?.length ? html`<ul class="filelist" style=${{ marginTop: '.4rem' }}>${att.files.map((f) => html`<${StoredFile} file=${f} />`)}</ul>` : ''}
      </li>`;
    })}</ul>` : html`<p class="small muted">Nothing waiting. ${swarmSettings(T.db).reviewSamplePct}% of accepted tasks are sampled (Settings).</p>`}
  </div>`;
}

function Configs() {
  const T = useT();
  const me = currentUser(T);
  const configs = T.db.all('WorkerConfig').sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.createdAt - b.createdAt);
  const name = (id) => T.db.get('WorkerConfig', id)?.name;
  const canAct = me?.isRequester || me?.isAdmin;
  return html`<div class="card">
    <h2>Worker configs</h2>
    <p class="small muted">A config is a model plus a strategy hint and its lessons. Configs that keep losing are retired. A winning config is cloned onto the next cheaper model first (if the clone keeps up, it gets the work for less), then with one change of strategy, so the swarm keeps searching.</p>
    ${configs.length ? html`<div class="table-wrap" style=${{ marginTop: '.6rem' }}><table>
      <thead><tr><th>Config</th><th>Model</th><th>Strategy hint</th><th>Lineage</th><th>Status</th>${canAct ? html`<th></th>` : ''}</tr></thead>
      <tbody>${configs.map((c) => html`<tr>
        <td><b>${c.name}</b>${c.challenger ? html` <span class="badge info">challenger</span>` : ''}</td>
        <td class="small">${modelName(c.model)}</td>
        <td class="small">${c.strategyHint}</td>
        <td class="small">${c.parentConfigId ? html`Clone of ${name(c.parentConfigId)} (generation ${c.generation})` : 'Original'}${c.why ? html`<div class="tiny muted">${c.why}</div>` : ''}</td>
        <td><span class=${`badge ${c.status === 'active' ? 'good' : ''}`}>${c.status}</span></td>
        ${canAct ? html`<td><${AsyncButton} class="small ghost-line" onClick=${() => act(() => T.api.setWorkerConfigStatus(me.id, c.id, c.status === 'active' ? 'retired' : 'active'), c.status === 'active' ? `Retired ${c.name}.` : `${c.name} competes again.`)}>${c.status === 'active' ? 'Retire' : 'Bring back'}<//></td>` : ''}
      </tr>`)}</tbody></table></div>` : html`<p class="small muted">The first three configs are created when the swarm first competes.</p>`}
  </div>`;
}

function Actions() {
  const T = useT();
  const now = useNow(5000);
  const list = T.db.all('SupervisorAction').filter((a) => a.action !== 'reveal').sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
  return html`<div class="card">
    <h2>Latest supervisor actions</h2>
    ${list.length ? html`<ul class="feed">${list.map((a) => {
      const t = T.db.get('Tile', a.tileId);
      return html`<li><time title=${fmtDateTime(a.createdAt)}>${ago(a.createdAt, now)}</time><span><${ActionBadge} action=${a.action} /> <a href=${`#/t/${a.tileId}`}>${truncate(t?.title || 'a task', 50)}</a>${a.depth ? html` <span class="tiny muted">(part)</span>` : ''} <span class="muted small">${a.by === 'requester' ? 'by you: ' : ''}${truncate(a.reason, 160)}</span></span></li>`;
    })}</ul>` : html`<p class="small muted">Nothing yet.</p>`}
  </div>`;
}

export function SupervisionPage() {
  const T = useT();
  useDbVersion();
  const s = swarmSettings(T.db);
  const escalated = T.db.filter('Tile', (t) => t.supervision?.state === 'escalated' && ['CLAIMED', 'REVISION'].includes(t.status)).sort((a, b) => b.supervision.at - a.supervision.at);
  return html`<div class="stack">
    <div class="page-head"><div>
      <h1>Supervision</h1>
      <p class="muted" style=${{ maxWidth: '62rem' }}>On a swarm job, ${s.competition === 'off' ? 'competition is off, so one agent does each tile' : `each tile goes to ${s.competitors} competing worker configs`}. They work blind first, posting notes to each other on the wire; a supervisor on a different model scores the drafts after the automatic checks, on a rubric written before the work. When the blind round isn’t a clean win, ${s.finalists ? `the best ${s.finalists}` : 'the workers'} ${s.exchange === 'drafts' ? 'see each other’s drafts' : 'read the scores and each other’s notes'} and revise their own drafts. Then the supervisor accepts, flags, sends back, re-splits, or brings the task to you here. <a href="#/settings">Change in Settings</a>.</p>
    </div></div>
    <h2 class="section-title">Needs you${escalated.length ? ` (${escalated.length})` : ''}</h2>
    ${escalated.length ? html`<div class="grid-2">${escalated.map((t) => html`<${Escalation} t=${t} key=${t.id} />`)}</div>` : html`<div class="card"><${Empty} title="Nothing escalated">When a supervisor can’t judge a task, or a task fails after a re-split, it waits here for you.<//></div>`}
    <${Overview} />
    <${Leaderboard} />
    <${Wire} />
    <div class="split"><${Lessons} /><${Supervisors} /></div>
    <div class="split"><${Configs} /><${Actions} /></div>
  </div>`;
}

/** The competition behind one tile, for its page: every task spec, round and score, and the supervisor's actions. */
export function CompetitionCard({ t }) {
  const T = useT();
  const specs = T.db.filter('TaskSpec', (x) => x.tileId === t.id && !x.parentSpecId).sort((a, b) => b.createdAt - a.createdAt);
  if (!specs.length) return null;
  const spec = specs[0];
  const scores = new Map(T.db.filter('Score', (x) => x.specId === spec.id).map((x) => [x.attemptId, x]));
  const attempts = T.db.filter('Attempt', (a) => a.specId === spec.id).sort((a, b) => a.createdAt - b.createdAt || a.label.localeCompare(b.label));
  const rounds = [...new Set(attempts.map((a) => `${a.cycle}:${a.round}`))];
  const acts = T.db.filter('SupervisorAction', (a) => a.specId === spec.id).sort((a, b) => a.createdAt - b.createdAt);
  const kids = T.db.filter('TaskSpec', (x) => x.parentSpecId === spec.id);
  return html`<div class="card stack-sm">
    <div class="row-between"><h2>Competition</h2>${acts.length ? html`<${ActionBadge} action=${acts.at(-1).action} />` : html`<span class="badge info">In progress</span>`}</div>
    <p class="small muted">${spec.routing || ''} Threshold ${spec.threshold}; hard checks: ${spec.hardChecks.map((h) => h.id).join(', ')}.${specs.length > 1 ? ` ${specs.length} competitions on this tile; the latest is shown.` : ''}</p>
    ${rounds.map((key) => {
      const [cycle, round] = key.split(':');
      const list = attempts.filter((a) => `${a.cycle}:${a.round}` === key);
      const name = { merge: 'Joined parts', notes: 'Notes round', reveal: 'Reveal round', revise: 'Revise round', blind: 'Blind round' }[round] || `${round} round`;
      return html`<div><div class="small"><b>${name}</b>${Number(cycle) > 1 ? ` · try ${cycle}` : ''}</div>
        <div class="table-wrap" style=${{ marginTop: '.3rem' }}><table><tbody>${list.map((a) => {
          const sc = scores.get(a.id);
          return html`<tr class=${a.id === spec.winnerAttemptId ? 'win' : ''}><td class="nowrap"><b>${a.label}</b> ${a.configName}${a.control ? html` <span class="tiny muted">control</span>` : ''}</td>
            <td><span class=${`badge ${a.hardPass ? 'good' : 'bad'}`}>${a.hardPass ? 'checks pass' : 'fails a check'}</span></td>
            <td class="num">${sc ? sc.score.toFixed(2) : '—'}</td>
            <td class="tiny muted">${a.id === spec.winnerAttemptId ? 'Winner. ' : ''}${truncate(sc?.summary || a.error || '', 110)}${a.edited ? ` Revised by ${a.edited} edit${a.edited > 1 ? 's' : ''}.` : ''}${a.usedMessageIds?.length ? ` Used ${a.usedMessageIds.length} note${a.usedMessageIds.length > 1 ? 's' : ''}.` : ''}</td></tr>`;
        })}</tbody></table></div></div>`;
    })}
    ${notesOf(T, spec).length ? html`<div class="small"><b>Notes the workers posted</b><ul class="tiny" style=${{ margin: '.2rem 0 0', paddingLeft: '1.1rem' }}>${notesOf(T, spec).map((m) => html`<li><b>${m.label || m.fromName}</b> ${m.to === 'rivals' ? 'to rivals' : 'to the team'} (${m.kind}): ${m.text}</li>`)}</ul></div>` : ''}
    ${kids.length ? html`<p class="small">Split into ${kids.length} parts, each competed on its own: ${kids.map((k) => `${truncate(k.title, 40)} (${k.status}${typeof k.score === 'number' ? `, ${k.score.toFixed(2)}` : ''})`).join('; ')}.</p>` : ''}
    ${spec.herding ? html`<p class="tiny muted">Second round: ${spec.herding.towardWorst} of ${spec.herding.revisions} revisions moved toward the weakest blind draft.</p>` : ''}
    ${spec.flagged && spec.disagreements?.length ? html`<div class="callout warn small"><b>Flagged:</b> ${spec.disagreements.join(' ')}</div>` : ''}
    ${acts.length ? html`<ul class="small" style=${{ margin: 0, paddingLeft: '1.1rem' }}>${acts.map((a) => html`<li><${ActionBadge} action=${a.action} /> ${a.reason}</li>`)}</ul>` : ''}
    ${t.supervision?.state === 'escalated' ? html`<div class="callout warn small">This task is waiting for you on the <a href="#/supervision">Supervision page</a>.</div>` : ''}
  </div>`;
}

/** The notes posted during one competition, oldest first. */
function notesOf(T, spec) {
  return T.db.filter('AgentMessage', (m) => m.specId === spec.id).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
