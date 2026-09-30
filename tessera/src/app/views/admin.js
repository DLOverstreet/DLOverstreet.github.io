// The platform console: overview, every agent run with its cost, cost per commission,
// jobs, the whole ledger, the decomposer eval and the signing key.
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, navigate, act, toast } from '../state.js';
import { Tabs, Empty, StatusBadge, AsyncButton, ago } from '../ui.js';
import { RunsTable, LedgerTable } from './commission.js';
import { runCostUsd, shadowCostUsd, savingsUsd } from '../../llm/prices.js';
import { commissionBalance, platformRevenue, findOverdraw, PAYOUT_TYPES } from '../../domain/ledger.js';
import { runDecomposerEval, EVAL_FIXTURES } from '../../agents/eval.js';
import { fmtMoney, fmtDateTime, fmtMinutes, truncate } from '../../lib/util.js';

export function AdminView({ tab = 'overview' }) {
  const T = useT();
  useDbVersion();
  const set = (t) => navigate(`#/admin/${t}`);
  const failed = T.db.count('Job', (j) => j.status === 'FAILED');
  return html`<div>
    <div class="page-head"><div><h1>Platform console</h1><p class="sub">Everything the agents did, what it cost, and where the money is. Readable by anyone in this demo.</p></div></div>
    <${Tabs} value=${tab} onChange=${set} label="Console sections" tabs=${[
      { id: 'overview', label: 'Overview' }, { id: 'runs', label: 'Agent runs' }, { id: 'costs', label: 'Cost per commission' },
      { id: 'jobs', label: 'Jobs', count: failed }, { id: 'ledger', label: 'Ledger' }, { id: 'eval', label: 'Decomposer eval' }, { id: 'keys', label: 'Signing key' },
    ]} />
    ${tab === 'overview' && html`<${Overview} />`}
    ${tab === 'runs' && html`<${AllRuns} />`}
    ${tab === 'costs' && html`<${Costs} />`}
    ${tab === 'jobs' && html`<${Jobs} />`}
    ${tab === 'ledger' && html`<${AllLedger} />`}
    ${tab === 'eval' && html`<${Eval} />`}
    ${tab === 'keys' && html`<${Keys} />`}
  </div>`;
}

function Overview() {
  const T = useT();
  const entries = T.db.all('LedgerEntry');
  const commissions = T.db.all('Commission');
  const held = commissions.reduce((n, c) => n + commissionBalance(entries, c.id), 0);
  const paid = -entries.filter((e) => PAYOUT_TYPES.includes(e.type)).reduce((n, e) => n + e.amountCents, 0);
  const runs = T.db.all('AgentRun');
  const settings = T.db.meta.settings.llm;
  return html`<div class="stack">
    <div class="card stats">
      <div class="stat"><span class="v">${commissions.length}</span><span class="l">Commissions</span></div>
      <div class="stat"><span class="v">${T.db.count('Tile', (t) => t.status === 'ACCEPTED')}</span><span class="l">Tiles accepted</span></div>
      <div class="stat"><span class="v">${fmtMoney(paid)}</span><span class="l">Paid to contributors</span></div>
      <div class="stat"><span class="v">${fmtMoney(platformRevenue(entries))}</span><span class="l">Platform fees</span></div>
      <div class="stat"><span class="v">${fmtMoney(held)}</span><span class="l">Held in escrow</span></div>
      <div class="stat"><span class="v">${runs.length}</span><span class="l">Agent calls · $${runs.reduce((n, r) => n + runCostUsd(r), 0).toFixed(2)}</span></div>
    </div>
    <div class="callout">Platform model: <b>${settings.provider === 'mock' ? 'deterministic mock' : settings.provider === 'anthropic' ? `Claude (${settings.heavyModel} heavy, ${settings.lightModel} light)` : settings.provider === 'free' ? `free models only (${T.llm.platform('heavy').label})` : `${settings.openai.model} at ${settings.openai.baseUrl}`}</b>. Change it in <a href="#/settings">Settings</a>.</div>
    <div class="card"><h2>Commissions</h2><div class="table-wrap"><table><thead><tr><th>Commission</th><th>Status</th><th>Requester</th><th class="right">Budget</th><th class="right">Escrow</th></tr></thead><tbody>
      ${commissions.sort((a, b) => b.createdAt - a.createdAt).map((c) => html`<tr class="clickable" tabindex="0" onClick=${() => navigate(`#/c/${c.id}`)} onKeyDown=${(e) => e.key === 'Enter' && navigate(`#/c/${c.id}`)}>
        <td><b>${c.title}</b></td><td><${StatusBadge} status=${c.status} kind="commission" /></td><td class="small">${T.db.get('User', c.requesterId)?.name}</td>
        <td class="money">${fmtMoney(c.budgetCents)}</td><td class="money">${fmtMoney(commissionBalance(entries, c.id))}</td></tr>`)}
    </tbody></table></div></div>
  </div>`;
}

function AllRuns() {
  const T = useT();
  const [agent, setAgent] = useState('');
  const runs = T.db.all('AgentRun');
  const agents = [...new Set(runs.map((r) => r.agent))].sort();
  const shown = agent ? runs.filter((r) => r.agent === agent) : runs;
  return html`<div class="stack">
    <div class="row"><span class="small muted">Agent:</span><button class=${`btn small ${agent ? '' : 'primary'}`} onClick=${() => setAgent('')}>All (${runs.length})</button>
      ${agents.map((a) => html`<button class=${`btn small ${agent === a ? 'primary' : ''}`} onClick=${() => setAgent(a)}>${a} (${runs.filter((r) => r.agent === a).length})</button>`)}</div>
    ${shown.length ? html`<${RunsTable} runs=${shown} showCommission />` : html`<div class="card"><${Empty} title="No agent runs yet" /></div>`}
  </div>`;
}

function Costs() {
  const T = useT();
  const runs = T.db.all('AgentRun');
  const rows = T.db.all('Commission').map((c) => {
    const rs = runs.filter((r) => r.commissionId === c.id);
    const by = {};
    for (const r of rs) by[r.agent] = (by[r.agent] || 0) + 1;
    const saved = { cache: 0, batch: 0, free: 0 };
    for (const r of rs) { const x = savingsUsd(r); saved.cache += x.cache; saved.batch += x.batch; saved.free += x.free; }
    const freeCalls = rs.filter((r) => String(r.provider || '').startsWith('free:') && !r.error).length;
    return { c, n: rs.length, tin: rs.reduce((n, r) => n + (r.tokensIn || 0), 0), tout: rs.reduce((n, r) => n + (r.tokensOut || 0), 0), cost: rs.reduce((n, r) => n + runCostUsd(r), 0), shadow: rs.reduce((n, r) => n + shadowCostUsd(r), 0), by, saved, freeCalls };
  });
  const total = rows.reduce((n, r) => ({ cost: n.cost + r.cost, cache: n.cache + r.saved.cache, batch: n.batch + r.saved.batch, free: n.free + r.saved.free }), { cost: 0, cache: 0, batch: 0, free: 0 });
  const usd = (x) => `$${x.toFixed(x < 1 ? 4 : 2)}`;
  return html`<div class="stack">
    <div class="card stats">
      <div class="stat"><span class="v">${usd(total.cost)}</span><span class="l">Spent on models</span></div>
      <div class="stat" title="Input read from the prompt cache at a tenth of its price or less, minus the premium paid to write the cache."><span class="v">${usd(total.cache)}</span><span class="l">Saved by the prompt cache</span></div>
      <div class="stat" title="Calls sent through the Message Batches API, at half price (Settings → Agent swarm → Half-price batch mode)."><span class="v">${usd(total.batch)}</span><span class="l">Saved by batches</span></div>
      <div class="stat" title="What Claude would have charged for the calls free models answered (Settings → Free models first)."><span class="v">${usd(total.free)}</span><span class="l">Saved by free models</span></div>
    </div>
    <p class="small muted">Actual cost is what the calls cost on the provider used: $0 for free models and the mock. The shadow column estimates what the same token counts would cost on the Claude models the mock or the free models stood in for.</p>
    <div class="table-wrap"><table><thead><tr><th>Commission</th><th>Calls by agent</th><th class="right">Tokens in / out</th><th class="right">Actual</th><th class="right">Saved</th><th class="right">Shadow</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><a href=${`#/c/${r.c.id}/runs`}>${r.c.title}</a></td><td class="small">${Object.entries(r.by).map(([a, n]) => `${a} ×${n}`).join(', ')}${r.freeCalls ? html`<div class="tiny muted">${r.freeCalls} answered by free models</div>` : ''}</td>
        <td class="money small">${r.tin.toLocaleString()} / ${r.tout.toLocaleString()}</td><td class="money">$${r.cost.toFixed(4)}</td>
        <td class="money small" title=${`Cache $${r.saved.cache.toFixed(4)} · batches $${r.saved.batch.toFixed(4)} · free models $${r.saved.free.toFixed(4)}`}>$${(r.saved.cache + r.saved.batch + r.saved.free).toFixed(4)}</td><td class="money muted">$${r.shadow.toFixed(4)}</td></tr>`)}
    </tbody></table></div>
  </div>`;
}

function Jobs() {
  const T = useT();
  const now = useNow(2000);
  const jobs = T.db.all('Job').sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  const counts = {};
  for (const j of T.db.all('Job')) counts[j.status] = (counts[j.status] || 0) + 1;
  return html`<div class="stack">
    <p class="small muted">The worker polls this table every 300 ms. A job is retried with backoff; one whose agent already retried twice fails straight away for a person to look at. ${Object.entries(counts).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ')}</p>
    <div class="table-wrap"><table><thead><tr><th>Created</th><th>Type</th><th>Status</th><th>Attempts</th><th>Last error</th><th></th></tr></thead><tbody>
      ${jobs.map((j) => html`<tr><td class="tiny nowrap">${ago(j.createdAt, now)}</td><td><b>${j.type}</b></td><td><span class=${`badge ${j.status === 'FAILED' ? 'bad' : j.status === 'DONE' ? 'good' : 'info'}`}>${j.status.toLowerCase()}</span></td>
        <td class="num">${j.attempts}</td><td class="small">${j.lastError ? truncate(j.lastError, 140) : ''}</td>
        <td>${j.status === 'FAILED' ? html`<button class="btn small" onClick=${() => { T.worker.retry(j.id); toast('Queued for retry.', 'ok'); }}>Retry</button>` : ''}</td></tr>`)}
    </tbody></table></div>
  </div>`;
}

function AllLedger() {
  const T = useT();
  const entries = T.db.all('LedgerEntry');
  const closed = T.db.filter('Commission', (c) => ['ACCEPTED', 'CANCELLED'].includes(c.status));
  const netOk = closed.every((c) => commissionBalance(entries, c.id) === 0);
  const noOverdraw = T.db.all('Commission').every((c) => !findOverdraw(entries, c.id));
  return html`<div class="stack">
    <div class=${`callout ${netOk && noOverdraw ? 'good' : 'bad'}`}>${netOk ? `All ${closed.length} closed commission(s) net to exactly $0.00.` : 'A closed commission does not net to zero!'} ${noOverdraw ? 'No escrow ever went below zero.' : 'An escrow went below zero!'} ${entries.length} append-only entries.</div>
    ${entries.length ? html`<${LedgerTable} entries=${entries} showCommission />` : ''}
  </div>`;
}

function Eval() {
  const T = useT();
  const [state, setState] = useState(null);
  const [progress, setProgress] = useState(0);
  const route = T.llm.platform('heavy');
  const run = async () => {
    setState(null);
    const out = await act(() => runDecomposerEval({ route, log: T.log, onProgress: (n) => setProgress(n) }));
    if (out) setState(out);
  };
  return html`<div class="stack">
    <div class="card">
      <p class="small">Runs the Decomposer on ${EVAL_FIXTURES.length} fixture commissions with the current platform model (<b>${route.label}</b>) and reports validity, tile-size spread, the share of criteria marked AUTO, and cost. Run it before and after any prompt change. ${route.providerName !== 'mock' ? html`<b>This makes ${EVAL_FIXTURES.length}+ real API calls billed to your key.</b>` : ''}</p>
      <div class="row" style=${{ marginTop: '.6rem' }}><${AsyncButton} class="primary" onClick=${run}>Run the eval<//>${progress && !state ? html`<span class="small muted">${progress} / ${EVAL_FIXTURES.length}</span>` : ''}</div>
    </div>
    ${state && html`<div class="card"><div class="stats">
        <div class="stat"><span class="v">${state.summary.valid}/${state.summary.total}</span><span class="l">Valid graphs</span></div>
        <div class="stat"><span class="v">${state.summary.medianTiles}</span><span class="l">Median tiles</span></div>
        <div class="stat"><span class="v">${Math.round(state.summary.autoShare * 100)}%</span><span class="l">Criteria marked AUTO</span></div>
        <div class="stat"><span class="v">${state.summary.medianScore ?? '—'}</span><span class="l">Median separability score</span></div>
        <div class="stat"><span class="v">${Math.round((state.summary.coverage || 0) * 100)}%</span><span class="l">Requirements covered</span></div>
        <div class="stat"><span class="v">$${state.summary.costUsd.toFixed(3)}</span><span class="l">Cost (shadow $${state.summary.shadowCostUsd.toFixed(3)})</span></div>
      </div></div>
      <div class="table-wrap"><table><thead><tr><th>Fixture</th><th>Valid</th><th class="right">Tiles</th><th class="right">Size (min / median / max)</th><th class="right">AUTO</th><th class="right">Price</th><th class="right">Tries</th></tr></thead><tbody>
        ${state.results.map((r) => html`<tr><td class="small">${r.fixture}</td><td>${r.valid ? html`<span class="badge good">valid</span>` : html`<span class="badge bad" title=${r.error}>invalid</span>`}</td>
          <td class="money">${r.tiles ?? '—'}</td><td class="money small">${r.valid ? `${fmtMinutes(r.minMinutes)} / ${fmtMinutes(r.medianMinutes)} / ${fmtMinutes(r.maxMinutes)}` : '—'}</td>
          <td class="money">${r.valid ? `${Math.round(r.autoShare * 100)}%` : '—'}</td><td class="money">${r.valid ? fmtMoney(r.totalCents) : '—'}</td><td class="money">${r.attempts}</td></tr>`)}
      </tbody></table></div>`}
  </div>`;
}

function Keys() {
  const T = useT();
  const k = T.db.meta.signingKey;
  return html`<div class="stack">
    <div class="card">
      <h2>Published signing key</h2>
      ${k ? html`<dl class="kv"><dt>Algorithm</dt><dd>Ed25519</dd><dt>Key id</dt><dd class="mono">${k.keyId}</dd><dt>Public key</dt><dd class="mono small" style=${{ wordBreak: 'break-all' }}>${k.publicKeyB64}</dd><dt>Created</dt><dd>${fmtDateTime(k.createdAt)}</dd></dl>`
        : html`<p class="small">Generating…</p>`}
      <p class="small" style=${{ marginTop: '.7rem' }}>Reputation exports are signed with this key. Its private half was generated in this browser as a non-extractable WebCrypto key and never leaves it. Because every visitor runs their own copy of the platform, each browser has its own key: a record verifies against the key published by the instance that issued it.</p>
      <div class="row" style=${{ marginTop: '.6rem' }}><a class="btn" href="#/verify">Verify a record</a></div>
    </div>
  </div>`;
}
