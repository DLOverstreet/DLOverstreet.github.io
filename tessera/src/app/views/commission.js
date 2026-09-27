// A commission: scoping, the plan and its price, funding, progress, delivery, the ledger
// and the agent runs behind it.
import { html, useState, useEffect } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, navigate, currentUser, act, toast, downloadBytes } from '../state.js';
import { StatusBadge, Mosaic, Legend, Money, Tabs, Modal, AsyncButton, Field, Empty, Countdown, Pipeline, Markdown, UserName, ago, STATUS_LABEL } from '../ui.js';
import { GraphView, TileEditor } from './graph.js';
import { COMMISSION_STEPS, requesterTodos } from './home.js';
import { draftGraph, quote } from '../../services/commissions.js';
import { commissionBalance } from '../../domain/ledger.js';
import { runCostUsd, shadowCostUsd } from '../../llm/prices.js';
import { fmtMoney, fmtDateTime, fmtMinutes, truncate } from '../../lib/util.js';
import { isRush } from '../../domain/pricing.js';

function defaultTab(c) {
  if (['DRAFT', 'SCOPING', 'PLANNED'].includes(c.status)) return 'plan';
  if (['DELIVERED', 'DISPUTED', 'ACCEPTED'].includes(c.status)) return 'delivery';
  return 'progress';
}

export function CommissionView({ id, tab }) {
  const T = useT();
  useDbVersion();
  const now = useNow(1000);
  const c = T.db.get('Commission', id);
  if (!c) return html`<div class="card"><${Empty} title="Commission not found"><a href="#/">Go home</a><//></div>`;
  const me = currentUser(T);
  const owner = me && me.id === c.requesterId;
  const privileged = owner || me?.isAdmin;
  const requester = T.db.get('User', c.requesterId);
  if (!privileged && c.privacy !== 'PUBLIC') {
    return html`<div class="card"><h1>Need-to-know commission</h1><p class="small" style=${{ marginTop: '.5rem' }}>Contributors on a need-to-know commission see only their own tile’s spec and inputs. <a href="#/work">Back to your tiles</a></p></div>`;
  }
  const active = tab || defaultTab(c);
  const setTab = (t) => navigate(`#/c/${id}/${t}`);
  const balance = commissionBalance(T.db.all('LedgerEntry'), id);
  const todos = owner ? requesterTodos(T.db, c) : [];
  const runs = T.db.filter('AgentRun', (r) => r.commissionId === id);
  const steps = c.status === 'DISPUTED' ? ['SCOPING', 'PLANNED', 'ACTIVE', 'DELIVERED', 'DISPUTED', 'ACCEPTED'] : c.status === 'CANCELLED' ? ['SCOPING', 'PLANNED', 'CANCELLED'] : COMMISSION_STEPS;
  return html`<div>
    <div class="page-head">
      <div style=${{ minWidth: 0 }}>
        <h1>${c.title}</h1>
        <p class="sub"><${UserName} user=${requester} /> · budget ${fmtMoney(c.budgetCents)} · due ${fmtDateTime(c.deadline)}${isRush(c.deadline, now) && ['SCOPING', 'PLANNED'].includes(c.status) ? ' (rush)' : ''} · ${c.privacy.replace(/_/g, '-').toLowerCase()}</p>
        <div style=${{ marginTop: '.5rem' }}><${Pipeline} steps=${steps} current=${c.status === 'FUNDED' ? 'ACTIVE' : c.status} /></div>
      </div>
      <div class="stat right"><span class="v">${fmtMoney(balance)}</span><span class="l">in escrow</span></div>
    </div>
    ${todos.map((t) => html`<div class=${`callout ${t.bad ? 'bad' : 'warn'}`} style=${{ marginBottom: '.5rem' }}>${t.text} ${t.href ? html`<a href=${t.href}>Open →</a>` : html`<a href=${`#/c/${id}/${t.tab}`}>Open →</a>`}</div>`)}
    <${Tabs} value=${active} onChange=${setTab} label="Commission sections" tabs=${[
      { id: 'plan', label: c.status === 'SCOPING' ? 'Scoping' : 'Plan' },
      { id: 'progress', label: 'Progress' },
      { id: 'delivery', label: 'Delivery' },
      { id: 'ledger', label: 'Ledger' },
      { id: 'runs', label: `Agent runs (${runs.length})` },
    ]} />
    ${active === 'plan' && html`<${PlanTab} c=${c} owner=${owner} />`}
    ${active === 'progress' && html`<${ProgressTab} c=${c} owner=${owner} now=${now} />`}
    ${active === 'delivery' && html`<${DeliveryTab} c=${c} owner=${owner} now=${now} />`}
    ${active === 'ledger' && html`<${LedgerTab} c=${c} />`}
    ${active === 'runs' && html`<${RunsTab} runs=${runs} />`}
  </div>`;
}

// ---------------------------------------------------------------- plan

function JobStatus({ type, commissionId }) {
  const T = useT();
  const job = T.db.filter('Job', (j) => j.type === type && j.payload.commissionId === commissionId).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!job) return null;
  if (job.status === 'FAILED') {
    return html`<div class="callout bad">The ${type} job failed after its retries: ${job.lastError}
      <div class="row" style=${{ marginTop: '.4rem' }}><button class="btn small" onClick=${() => { T.worker.retry(job.id); toast('Retrying.', 'ok'); }}>Retry</button><a class="btn small ghost" href="#/admin/jobs">See jobs</a></div></div>`;
  }
  return html`<p class="small muted" role="status"><span class="spinner"></span> ${job.status === 'RUNNING' ? 'Working' : 'Queued'}${job.attempts > 1 ? ` (attempt ${job.attempts})` : ''}…</p>`;
}

function ScopingForm({ c, owner }) {
  const T = useT();
  const qs = c.clarifications.questions;
  const [answers, setAnswers] = useState(() => ({ ...Object.fromEntries(qs.map((q) => [q.id, ''])), ...c.clarifications.answers }));
  const submit = () => act(() => T.api.answerScoping(c.requesterId, c.id, answers), 'Answers saved. The Decomposer is building the plan.');
  return html`<div class="card stack">
    <div class="card-head"><h2>Scoping questions</h2>${owner ? html`<button class="btn small" onClick=${() => setAnswers(Object.fromEntries(qs.map((q) => [q.id, q.suggestedAnswer])))}>Use all suggested answers</button>` : ''}</div>
    <p class="small muted">The Scoping agent asks only what would change how the work is split, specified or checked.</p>
    ${qs.map((q, i) => html`<div class="field">
      <label for=${`q-${q.id}`}>${i + 1}. ${q.question}</label>
      <div class="hint">${q.why}</div>
      <textarea id=${`q-${q.id}`} rows="2" value=${answers[q.id] || ''} disabled=${!owner} onInput=${(e) => setAnswers({ ...answers, [q.id]: e.target.value })}></textarea>
      ${owner && q.suggestedAnswer ? html`<button class="btn small ghost" style=${{ alignSelf: 'flex-start' }} onClick=${() => setAnswers({ ...answers, [q.id]: q.suggestedAnswer })}>Suggested: “${truncate(q.suggestedAnswer, 90)}”</button>` : ''}
    </div>`)}
    ${owner ? html`<div><${AsyncButton} class="primary" onClick=${submit}>Send answers and build the plan<//></div>` : ''}
  </div>`;
}

function PlanTab({ c, owner }) {
  const T = useT();
  const now = T.clock.now();
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('graph');
  const [confirm, setConfirm] = useState(false);
  const [rethink, setRethink] = useState(false);
  const [instruction, setInstruction] = useState('');

  if (c.status === 'SCOPING' || c.status === 'DRAFT') {
    if (!c.clarifications.scopedAt) return html`<div class="card"><h2>Reading your commission</h2><p class="small">The Scoping agent is deciding what to ask before anything is decomposed.</p><${JobStatus} type="scope" commissionId=${c.id} /></div>`;
    if (c.planState === 'DECOMPOSING' || c.clarifications.answeredAt) {
      return html`<div class="card"><h2>Building the tile graph</h2><p class="small">The Decomposer is splitting the job into tiles of 15 to 120 minutes, each with checkable acceptance criteria. The platform then prices them; if the total is over budget, the Decomposer is asked for a smaller scope.</p>
        <${JobStatus} type="decompose" commissionId=${c.id} /></div>`;
    }
    return html`<${ScopingForm} c=${c} owner=${owner} />`;
  }
  const tiles = draftGraph(T.db, c.id).filter((t) => t.status !== 'CANCELLED');
  if (!tiles.length) return html`<div class="card"><${Empty} title="No plan yet" /></div>`;
  const editable = owner && c.status === 'PLANNED';
  const q = quote(T.db, c.id, now);
  const sel = tiles.find((t) => t.key === selected);
  const over = q.total > c.budgetCents;
  const pct = Math.min(100, Math.round((q.total / c.budgetCents) * 100));

  const fund = async () => {
    const r = await act(() => T.api.fundCommission(c.requesterId, c.id, { acceptOverBudget: over }), 'Escrow funded. Tiles with no upstream work are open now.');
    if (r) { setConfirm(false); navigate(`#/c/${c.id}/progress`); }
  };

  return html`<div class="stack">
    <div class="split">
      <div class="card">
        <div class="card-head"><h2>${editable ? 'Proposed plan' : 'Plan'}</h2><span class="small muted">${tiles.length} tiles${c.plan?.attempts > 1 ? ` · ${c.plan.attempts} Decomposer passes` : ''}</span></div>
        <p class="small">${c.plan?.rationale}</p>
        ${c.plan?.instruction ? html`<p class="small muted" style=${{ marginTop: '.4rem' }}>Your instruction: “${c.plan.instruction}”</p>` : ''}
      </div>
      <div class="card">
        <h2>Price</h2>
        <dl class="kv">
          <dt>Tile pay</dt><dd class="num">${fmtMoney(q.payTotal)}${q.rush ? ' (includes 25% rush)' : ''}</dd>
          <dt>Platform fee (10%)</dt><dd class="num">${fmtMoney(q.feeTotal)}</dd>
          <dt>Peer-review reserve</dt><dd class="num">${fmtMoney(q.reserveTotal)} <span class="muted small">refunded if unused</span></dd>
          <dt><b>Escrow to fund</b></dt><dd class="num"><b>${fmtMoney(q.total)}</b> of ${fmtMoney(c.budgetCents)}</dd>
        </dl>
        <div class=${`meter ${over ? 'over' : ''}`} style=${{ marginTop: '.6rem' }} role="meter" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100" aria-label="Share of budget"><div style=${{ width: `${pct}%` }}></div></div>
        ${over ? html`<p class="small" style=${{ color: 'var(--bad)', marginTop: '.4rem' }}>Over budget by ${fmtMoney(q.total - c.budgetCents)}. Cut tiles, or ask for a smaller plan; rates don’t go down.</p>` : ''}
        ${editable ? html`<div class="row" style=${{ marginTop: '.8rem' }}>
          <button class="btn primary" onClick=${() => setConfirm(true)} disabled=${q.issues.some((i) => ['cycle', 'missing-dependency'].includes(i.code))}>Approve and fund ${fmtMoney(q.total)}</button>
          <button class="btn" onClick=${() => setRethink(true)}>Ask for a new plan</button>
        </div>` : ''}
      </div>
    </div>
    ${q.issues.length ? html`<div class="callout warn">${q.issues.map((i) => html`<div>${i.message}</div>`)}</div>` : ''}
    <div class=${sel && editable ? 'split' : ''}>
      <div class="card">
        <div class="card-head"><h2>Tiles</h2><div class="row">
          <div class="tabs" role="tablist" aria-label="Plan view" style=${{ margin: 0, border: 0 }}>
            <button role="tab" aria-selected=${view === 'graph'} onClick=${() => setView('graph')}>Graph</button>
            <button role="tab" aria-selected=${view === 'list'} onClick=${() => setView('list')}>List</button>
          </div>
          ${editable ? html`<button class="btn small" onClick=${() => act(async () => { const t = T.api.addDraftTile(c.requesterId, c.id); setSelected(t.key); }, 'Added a tile. Fill it in on the right.')}>Add tile</button>` : ''}
        </div></div>
        ${view === 'graph'
          ? html`<${GraphView} tiles=${tiles} selected=${selected} onSelect=${(k) => (editable ? setSelected(k === selected ? null : k) : navigate(`#/t/${tiles.find((t) => t.key === k).id}`))} colorBy=${editable ? 'kind' : 'status'} />
            <p class="tiny muted" style=${{ marginTop: '.4rem' }}>${editable ? 'Select a tile to edit it. Bar color shows the kind: blue work, purple review, amber integration.' : 'Select a tile to open it.'}</p>`
          : html`<${TileTable} tiles=${tiles} onSelect=${(t) => (editable ? setSelected(t.key) : navigate(`#/t/${t.id}`))} />`}
      </div>
      ${sel && editable ? html`<${TileEditor} key=${sel.id} tile=${sel} allTiles=${tiles} rush=${q.rush}
        onClose=${() => setSelected(null)}
        onSave=${(patch) => act(() => { const t = T.api.updateDraftTile(c.requesterId, sel.id, patch); setSelected(t.key); }, 'Tile saved and re-priced.')}
        onDelete=${() => act(() => { T.api.deleteDraftTile(c.requesterId, sel.id); setSelected(null); }, 'Tile removed. Its dependents now depend on its upstream tiles.')} />` : ''}
    </div>
    ${confirm && html`<${Modal} title="Approve and fund" onClose=${() => setConfirm(false)}>
      <p class="small">This moves ${fmtMoney(q.total)} of simulated money into escrow. Tiles with no upstream work open for matching right away; others open as their inputs are accepted. Pay for each tile is released the moment it’s accepted.</p>
      <div class="table-wrap" style=${{ margin: '.8rem 0' }}><table><thead><tr><th>Tile</th><th class="right">Pay</th><th class="right">Fee</th><th class="right">Review reserve</th></tr></thead><tbody>
        ${q.lines.map((l) => html`<tr><td>${l.title}</td><td class="money">${fmtMoney(l.pay)}</td><td class="money">${fmtMoney(l.fee)}</td><td class="money">${l.reserve ? fmtMoney(l.reserve + l.reserveFee) : '—'}</td></tr>`)}
        <tr><td><b>Total</b></td><td class="money"><b>${fmtMoney(q.payTotal)}</b></td><td class="money"><b>${fmtMoney(q.feeTotal)}</b></td><td class="money"><b>${fmtMoney(q.reserveTotal)}</b></td></tr>
      </tbody></table></div>
      ${over ? html`<div class="callout bad" style=${{ marginBottom: '.8rem' }}>This is ${fmtMoney(q.total - c.budgetCents)} over your budget. Funding it anyway is your call.</div>` : ''}
      <div class="row"><${AsyncButton} class="primary" onClick=${fund}>Fund ${fmtMoney(q.total)}${over ? ' anyway' : ''}<//><button class="btn" onClick=${() => setConfirm(false)}>Cancel</button></div>
    <//>`}
    ${rethink && html`<${Modal} title="Ask for a new plan" onClose=${() => setRethink(false)}>
      <${Field} label="What should change?" id="rethink" hint="For example: “Drop the translation”, or “Split the scraper into two smaller tiles.” The Decomposer sees this with your original goal."><textarea id="rethink" value=${instruction} onInput=${(e) => setInstruction(e.target.value)}></textarea><//>
      <div class="row" style=${{ marginTop: '.8rem' }}><${AsyncButton} class="primary" onClick=${async () => { await act(() => T.api.redecompose(c.requesterId, c.id, instruction), 'Asked for a new plan.'); setRethink(false); }}>Rebuild the plan<//></div>
    <//>`}
  </div>`;
}

function TileTable({ tiles, onSelect, showStatus }) {
  const T = useT();
  return html`<div class="table-wrap"><table>
    <thead><tr><th>Tile</th><th>Kind</th><th>Skills</th><th class="right">Time</th><th class="right">Pay</th>${showStatus ? html`<th>Status</th><th>Held by</th>` : ''}</tr></thead>
    <tbody>${tiles.map((t) => html`<tr class="clickable" tabindex="0" onClick=${() => onSelect(t)} onKeyDown=${(e) => e.key === 'Enter' && onSelect(t)}>
      <td><b>${t.title}</b><div class="tiny muted">${t.acceptanceCriteria.length} criteria${t.highStakes ? ' · high stakes' : ''}${t.calibration ? ` · estimate ×${t.calibration.ratio} from history` : ''}</div></td>
      <td class="small">${t.kind.toLowerCase()} · T${t.tier}</td>
      <td><div class="tags">${t.skillTags.map((s) => html`<span class="tag">${s}</span>`)}</div></td>
      <td class="money">${fmtMinutes(t.estMinutes)}</td>
      <td class="money">${fmtMoney(t.payCents)}</td>
      ${showStatus ? html`<td><${StatusBadge} status=${t.status} /></td><td class="small">${t.claimedById ? T.db.get('User', t.claimedById)?.name : '—'}</td>` : ''}
    </tr>`)}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------- progress

function describeChange(db, ch) {
  const actor = db.get('User', ch.actor);
  const who = actor ? actor.name : ch.actor;
  if (ch.entity === 'Commission') return html`<span>Commission <b>${STATUS_LABEL[ch.from]} → ${STATUS_LABEL[ch.to]}</b> <span class="muted">by ${who}${ch.note ? ` · ${ch.note}` : ''}</span></span>`;
  const t = db.get('Tile', ch.entityId);
  return html`<span><a href=${`#/t/${ch.entityId}`}>${t ? truncate(t.title, 60) : 'a tile'}</a>: <b>${STATUS_LABEL[ch.from]} → ${STATUS_LABEL[ch.to]}</b> <span class="muted">by ${who}${ch.note ? ` · ${ch.note}` : ''}</span></span>`;
}

function ProgressTab({ c, owner, now }) {
  const T = useT();
  const all = T.db.filter('Tile', (t) => t.commissionId === c.id);
  if (['DRAFT', 'SCOPING', 'PLANNED'].includes(c.status)) return html`<div class="card"><${Empty} title="Not started">Progress shows here once the plan is funded.</${Empty}></div>`;
  const planned = draftGraph(T.db, c.id);
  const reviews = all.filter((t) => t.dynamic);
  const feed = T.db.filter('StatusChange', (x) => x.commissionId === c.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
  const count = (s) => planned.filter((t) => t.status === s).length;
  return html`<div class="stack">
    <div class="card">
      <div class="card-head"><h2>The mosaic</h2><span class="small muted">${count('ACCEPTED')} of ${planned.filter((t) => t.status !== 'CANCELLED').length} tiles accepted · ${reviews.length} peer review${reviews.length === 1 ? '' : 's'}</span></div>
      <${Mosaic} big tiles=${[...planned, ...reviews]} onPick=${(t) => navigate(`#/t/${t.id}`)} />
      <${Legend} />
    </div>
    <div class="card"><div class="card-head"><h2>Tile graph</h2><span class="small muted">Colored by status</span></div>
      <${GraphView} tiles=${planned} onSelect=${(k) => navigate(`#/t/${planned.find((t) => t.key === k).id}`)} />
    </div>
    <div class="split">
      <div class="card"><h2>Tiles</h2><${TileTable} tiles=${planned} showStatus onSelect=${(t) => navigate(`#/t/${t.id}`)} />
        ${reviews.length ? html`<h3 style=${{ marginTop: '1rem' }}>Peer reviews</h3><${TileTable} tiles=${reviews} showStatus onSelect=${(t) => navigate(`#/t/${t.id}`)} />` : ''}
      </div>
      <div class="card"><h2>Activity</h2><ul class="feed">${feed.map((ch) => html`<li><time title=${fmtDateTime(ch.createdAt)}>${ago(ch.createdAt, now)}</time>${describeChange(T.db, ch)}</li>`)}</ul></div>
    </div>
    ${owner && c.status === 'ACTIVE' ? html`<div><button class="btn danger small" onClick=${() => { if (confirm('Cancel this commission? Open tiles are cancelled and unspent escrow is refunded.')) act(() => T.api.cancelCommission(c.requesterId, c.id), 'Commission cancelled; unspent escrow refunded.'); }}>Cancel commission</button></div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- delivery

function DeliveryTab({ c, owner, now }) {
  const T = useT();
  const [dispute, setDispute] = useState(false);
  const [picked, setPicked] = useState([]);
  const [reason, setReason] = useState('');
  const [report, setReport] = useState(null);
  useEffect(() => {
    let live = true;
    if (c.deliverableKey) T.blobs.get(c.deliverableKey).then((bytes) => { if (live) setReport(bytes ? new TextDecoder().decode(bytes) : 'The report file is missing.'); });
    return () => { live = false; };
  }, [c.deliverableKey]);
  const d = c.delivery;
  if (!d) {
    return html`<div class="card"><${Empty} title=${c.status === 'ASSEMBLING' ? 'Assembling the deliverable…' : 'Nothing delivered yet'}>
      ${c.status === 'ASSEMBLING' ? html`<${JobStatus} type="assemble" commissionId=${c.id} />` : 'Once every tile is accepted, the Assembler merges the outputs and writes the credits manifest.'}</${Empty}></div>`;
  }
  const disputes = T.db.filter('Dispute', (x) => x.commissionId === c.id).sort((a, b) => b.createdAt - a.createdAt);
  const accepted = T.db.filter('Tile', (t) => t.commissionId === c.id && t.status === 'ACCEPTED' && !t.dynamic);
  const zip = async () => {
    const bytes = await act(() => T.api.buildDeliverableZip(c.id));
    if (bytes) downloadBytes(bytes, `${c.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.zip`, 'application/zip');
  };
  return html`<div class="stack">
    ${c.status === 'DELIVERED' ? html`<div class="card accent">
      <div class="row-between"><div><h2>Delivered ${ago(c.deliveredAt, now)}</h2><p class="small">Accept it, or dispute specific tiles. If you do nothing, it’s accepted automatically in <b><${Countdown} until=${c.autoAcceptAt} now=${now} /></b>.</p></div>
      ${owner ? html`<div class="row"><${AsyncButton} class="good" onClick=${() => act(() => T.api.acceptDelivery(c.requesterId, c.id), 'Accepted. Unspent escrow has been refunded.')}>Accept delivery<//><button class="btn" onClick=${() => setDispute(true)}>Dispute tiles</button></div>` : ''}</div>
    </div>` : ''}
    ${c.status === 'ACCEPTED' ? html`<div class="callout good">Accepted ${c.acceptedAt ? ago(c.acceptedAt, now) : ''}. Every contributor was paid when their tile was accepted, and unspent escrow was refunded.</div>` : ''}
    ${disputes.map((x) => html`<div class=${`card ${x.status === 'OPEN' ? 'warn' : ''}`}>
      <h3>Dispute ${x.status === 'OPEN' ? '(panel voting)' : `· ${x.outcome === 'UPHOLD' ? 'delivery upheld' : 'tiles reopened as rework'}`}</h3>
      <p class="small">“${x.reason}”</p>
      <p class="small muted">Tiles: ${x.tileIds.map((id) => T.db.get('Tile', id)?.title).join('; ')}</p>
      <div class="row" style=${{ marginTop: '.4rem' }}>${x.panel.map((p) => html`<span class="badge ${x.votes[p] ? (x.votes[p].vote === 'UPHOLD' ? 'good' : 'bad') : ''}">${T.db.get('User', p).name}: ${x.votes[p] ? x.votes[p].vote.toLowerCase() : 'waiting'}</span>`)}</div>
    </div>`)}
    <div class="split">
      <div class="card">
        <div class="card-head"><h2 class="sr-only">Deliverable</h2><span class="small muted">The assembled deliverable. The ZIP also has every accepted file and credits.json.</span><button class="btn small" onClick=${zip}>Download ZIP</button></div>
        ${d.gaps.length || d.conflicts.length ? html`<div class="callout warn" style=${{ marginTop: '.6rem' }}><b>Flagged for you:</b>${d.gaps.map((g) => html`<div>Gap: ${g}</div>`)}${d.conflicts.map((g) => html`<div>Conflict: ${g}</div>`)}</div>` : ''}
        <hr />
        ${report ? html`<${Markdown} text=${report} />` : html`<span class="spinner"></span>`}
      </div>
      <div class="card"><h2>Credits manifest</h2>
        <div class="table-wrap"><table><thead><tr><th>Tile</th><th>Contributor</th><th>Files</th></tr></thead><tbody>
          ${d.manifest.map((m) => html`<tr><td><b>${m.tileTitle}</b><div class="tiny muted">${m.role}</div></td><td class="small">${m.contributorName}</td><td class="tiny mono">${m.files.join(', ') || '—'}</td></tr>`)}
        </tbody></table></div>
        <p class="tiny muted" style=${{ marginTop: '.5rem' }}>Assembled by ${d.model}. The manifest is checked against the accepted tiles, so every contributor is credited.</p>
      </div>
    </div>
    ${dispute && html`<${Modal} title="Dispute tiles" onClose=${() => setDispute(false)}>
      <p class="small">Name the tiles that fall short and say why. Three contributors who didn’t work on this commission will vote to uphold the delivery or reopen the tiles. Reopened tiles are redone at the platform’s cost.</p>
      <fieldset style=${{ border: 0, margin: '.7rem 0' }}><legend class="label">Tiles</legend><div class="choices">
        ${accepted.map((t) => html`<label class="choice"><input type="checkbox" checked=${picked.includes(t.id)} onChange=${(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} /><span><b>${t.title}</b><span>${T.db.get('User', t.claimedById)?.name}</span></span></label>`)}
      </div></fieldset>
      <${Field} label="What’s wrong?" id="dispute-reason"><textarea id="dispute-reason" value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder="Be specific: the panel reads this."></textarea><//>
      <div class="row" style=${{ marginTop: '.8rem' }}><${AsyncButton} class="primary" onClick=${async () => { const r = await act(() => T.api.disputeDelivery(c.requesterId, c.id, { tileIds: picked, reason }), 'Dispute opened. A three-person panel has been picked.'); if (r) setDispute(false); }}>Open dispute<//></div>
    <//>`}
  </div>`;
}

// ---------------------------------------------------------------- ledger + runs

export function LedgerTable({ entries, showCommission }) {
  const T = useT();
  let bal = 0;
  const rows = [...entries].sort((a, b) => a.createdAt - b.createdAt).map((e) => { bal += e.amountCents; return { e, bal }; });
  return html`<div class="table-wrap"><table><thead><tr><th>When</th>${showCommission ? html`<th>Commission</th>` : ''}<th>Type</th><th>Who</th><th>Memo</th><th class="right">Amount</th>${showCommission ? '' : html`<th class="right">Escrow</th>`}</tr></thead>
    <tbody>${rows.reverse().map(({ e, bal: b }) => html`<tr>
      <td class="tiny nowrap">${fmtDateTime(e.createdAt)}</td>
      ${showCommission ? html`<td class="small"><a href=${`#/c/${e.commissionId}/ledger`}>${truncate(T.db.get('Commission', e.commissionId)?.title || '', 36)}</a></td>` : ''}
      <td><span class="badge">${e.type.replace(/_/g, ' ')}</span></td>
      <td class="small">${e.userId ? T.db.get('User', e.userId)?.name : 'Platform'}</td>
      <td class="small">${e.memo}</td>
      <td class="money">${fmtMoney(e.amountCents)}</td>
      ${showCommission ? '' : html`<td class="money muted">${fmtMoney(b)}</td>`}
    </tr>`)}</tbody></table></div>`;
}

function LedgerTab({ c }) {
  const T = useT();
  const entries = T.db.filter('LedgerEntry', (e) => e.commissionId === c.id);
  const sumOf = (types) => entries.filter((e) => types.includes(e.type)).reduce((n, e) => n + e.amountCents, 0);
  return html`<div class="stack">
    <div class="card stats">
      <div class="stat"><span class="v">${fmtMoney(sumOf(['ESCROW_FUND']))}</span><span class="l">Funded</span></div>
      <div class="stat"><span class="v">${fmtMoney(-sumOf(['TILE_PAYOUT', 'REVIEW_PAYOUT', 'PARTIAL_PAYOUT']))}</span><span class="l">Paid to contributors</span></div>
      <div class="stat"><span class="v">${fmtMoney(-sumOf(['PLATFORM_FEE']))}</span><span class="l">Platform fee (10%)</span></div>
      <div class="stat"><span class="v">${fmtMoney(-sumOf(['REFUND']))}</span><span class="l">Refunded</span></div>
      <div class="stat"><span class="v">${fmtMoney(commissionBalance(entries, c.id))}</span><span class="l">Left in escrow</span></div>
    </div>
    <p class="small muted">Every figure is recomputed from these ${entries.length} append-only entries. Funding is positive; payouts, fees and refunds are negative. A closed commission always nets to zero.</p>
    ${entries.length ? html`<${LedgerTable} entries=${entries} />` : html`<div class="card"><${Empty} title="No money has moved yet" /></div>`}
  </div>`;
}

export function RunsTable({ runs, showCommission }) {
  const T = useT();
  const [open, setOpen] = useState(null);
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  return html`<div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Agent</th><th>Prompt</th><th>Model</th>${showCommission ? html`<th>Commission</th>` : ''}<th class="right">Tokens in / out</th><th class="right">Latency</th><th class="right">Cost</th><th>Result</th></tr></thead>
      <tbody>${sorted.slice(0, 300).map((r) => html`<tr class="clickable" tabindex="0" onClick=${() => setOpen(r)} onKeyDown=${(e) => e.key === 'Enter' && setOpen(r)}>
        <td class="tiny nowrap">${fmtDateTime(r.createdAt)}</td><td><b>${r.agent}</b>${r.attempt > 1 ? html`<span class="tiny muted"> try ${r.attempt}</span>` : ''}</td>
        <td class="mono tiny">${r.promptVersion}</td><td class="small">${r.model}<div class="tiny muted">${r.provider}</div></td>
        ${showCommission ? html`<td class="small">${truncate(T.db.get('Commission', r.commissionId)?.title || '—', 30)}</td>` : ''}
        <td class="money small">${r.tokensIn ?? '—'} / ${r.tokensOut ?? '—'}</td><td class="money small">${r.latencyMs} ms</td>
        <td class="money small">${r.provider === 'mock' ? html`<span title="What this call would cost on the model it stands in for">$0 <span class="muted">(${'$' + shadowCostUsd(r).toFixed(4)})</span></span>` : '$' + runCostUsd(r).toFixed(4)}</td>
        <td>${r.error ? html`<span class="badge bad" title=${r.error}>rejected</span>` : html`<span class="badge good">ok</span>`}</td>
      </tr>`)}</tbody></table></div>
    ${open && html`<${Modal} wide title=${`${open.agent} · ${open.promptVersion}`} onClose=${() => setOpen(null)}>
      <dl class="kv"><dt>Provider</dt><dd>${open.provider}</dd><dt>Model</dt><dd>${open.model}${open.shadowModel ? ` (stands in for ${open.shadowModel})` : ''}</dd><dt>Attempt</dt><dd>${open.attempt}</dd><dt>Latency</dt><dd>${open.latencyMs} ms</dd>${open.error ? html`<dt>Rejected because</dt><dd style=${{ color: 'var(--bad)' }}>${open.error}</dd>` : ''}</dl>
      <h3 style=${{ marginTop: '.8rem' }}>Input</h3><pre>${JSON.stringify(open.input, null, 2)}</pre>
      <h3 style=${{ marginTop: '.8rem' }}>Output</h3><pre>${typeof open.output === 'string' ? open.output : JSON.stringify(open.output, null, 2)}</pre>
    <//>`}
  </div>`;
}

function RunsTab({ runs }) {
  const total = runs.reduce((n, r) => n + runCostUsd(r), 0);
  const shadow = runs.reduce((n, r) => n + shadowCostUsd(r), 0);
  return html`<div class="stack">
    <p class="small muted">${runs.length} agent calls · actual cost $${total.toFixed(4)} · would cost about $${shadow.toFixed(4)} on the Claude models the mock stands in for. Select a row to see the exact input and output.</p>
    ${runs.length ? html`<${RunsTable} runs=${runs} />` : html`<div class="card"><${Empty} title="No agent calls yet" /></div>`}
  </div>`;
}

export { TileTable, Money };
