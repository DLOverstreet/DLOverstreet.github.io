// The contributor's pages: offers (and dispute-panel duty), the open board, their tiles,
// earnings and reputation.
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, navigate, currentUser, act, toast, downloadText } from '../state.js';
import { StatusBadge, Money, Countdown, ScoreBars, Empty, AsyncButton, Modal, Rate, ago } from '../ui.js';
import { boardFor } from '../../services/market.js';
import { userEarnings, PAYOUT_TYPES } from '../../domain/ledger.js';
import { summarizeReputation, REP_REASONS } from '../../domain/reputation.js';
import { config } from '../../domain/config.js';
import { fmtMoney, fmtRate, fmtMinutes, fmtDateTime, truncate, DAY } from '../../lib/util.js';
import { setPendingRecord } from './verify.js';

function NotContributor() {
  return html`<div class="card"><h1>Contributors only</h1><p class="small" style=${{ marginTop: '.4rem' }}>Switch to a contributor persona from the menu at the top right, or <a href="#/personas">pick one here</a>.</p></div>`;
}

function commissionLabel(db, tile) {
  const c = db.get('Commission', tile.commissionId);
  return c.privacy === 'PUBLIC' ? c.title : 'A need-to-know commission';
}

export function Offers() {
  const T = useT();
  useDbVersion();
  const now = useNow(1000);
  const me = currentUser(T);
  if (!me.isContributor) return html`<${NotContributor} />`;
  const profile = T.db.find('ContributorProfile', (p) => p.userId === me.id);
  const pending = T.db.filter('Offer', (o) => o.contributorId === me.id && o.response === 'PENDING').sort((a, b) => a.expiresAt - b.expiresAt);
  const past = T.db.filter('Offer', (o) => o.contributorId === me.id && o.response !== 'PENDING').sort((a, b) => (b.respondedAt || b.createdAt) - (a.respondedAt || a.createdAt)).slice(0, 12);
  const panels = T.db.filter('Dispute', (d) => d.status === 'OPEN' && d.panel.includes(me.id));
  return html`<div class="stack">
    <div class="page-head"><div><h1>Offers</h1><p class="sub">The Matcher offers each open tile to its three best fits for a two-hour window. It never offers a tile below your ${fmtRate(Math.max(profile.payFloorCents, config.platformFloorCents))} floor.</p></div><a class="btn" href="#/board">Open board</a></div>
    ${panels.map((d) => html`<${PanelDuty} d=${d} me=${me} key=${d.id} />`)}
    ${pending.length ? html`<div class="grid-2">${pending.map((o) => html`<${OfferCard} o=${o} now=${now} me=${me} profile=${profile} key=${o.id} />`)}</div>`
      : html`<div class="card"><${Empty} title="No offers waiting">Offers appear as tiles open that fit your skills, languages, availability and floor. The open board may have tiles whose offer window has passed.</${Empty}></div>`}
    ${past.length ? html`<div class="card"><h2>Recent offers</h2><div class="table-wrap"><table><thead><tr><th>Tile</th><th>Response</th><th class="right">Pay</th><th>When</th></tr></thead><tbody>
      ${past.map((o) => { const t = T.db.get('Tile', o.tileId); return html`<tr><td><a href=${`#/t/${t.id}`}>${t.title}</a></td><td><span class=${`badge ${o.response === 'ACCEPTED' ? 'good' : ''}`}>${o.response.toLowerCase()}</span></td><td class="money">${fmtMoney(t.payCents)}</td><td class="tiny">${ago(o.respondedAt || o.createdAt, now)}</td></tr>`; })}
    </tbody></table></div></div>` : ''}
  </div>`;
}

function OfferCard({ o, now, me, profile }) {
  const T = useT();
  const t = T.db.get('Tile', o.tileId);
  const target = t.reviewOf ? T.db.get('Tile', t.reviewOf.tileId) : null;
  const accept = async () => {
    const r = await act(() => T.api.respondToOffer(me.id, o.id, true), 'Claimed. Your brief is one click away.');
    if (r) navigate(`#/t/${t.id}`);
  };
  return html`<div class="card stack-sm">
    <div class="row-between"><span class="tiny muted">${commissionLabel(T.db, t)}</span><span class="small">closes in <b><${Countdown} until=${o.expiresAt} now=${now} /></b></span></div>
    <h3 style=${{ margin: 0 }}>${t.title}</h3>
    <div class="row small"><b><${Money} cents=${t.payCents} /></b><span class="muted">·</span><${Rate} tile=${t} /><span class="muted">(your floor ${fmtRate(profile.payFloorCents)})</span><span class="muted">·</span>${fmtMinutes(t.estMinutes)}<span class="muted">·</span>tier ${t.tier}${t.kind !== 'WORK' ? html`<span class="badge info">${t.kind.toLowerCase()}</span>` : ''}</div>
    <div class="tags">${(target || t).skillTags.map((s) => html`<span class="tag">${s}</span>`)}</div>
    <p class="small">${truncate(t.spec.replace(/^Context:[^\n]*\n\n?/, ''), 260)}</p>
    <div class="callout" style=${{ padding: '.4rem .6rem' }}><span class="small"><b>Why this fits you:</b> ${o.note || html`<span class="muted">writing a note…</span>`}</span></div>
    <details><summary class="small">Match score ${o.score.toFixed(2)}</summary><div style=${{ marginTop: '.4rem' }}><${ScoreBars} breakdown=${o.breakdown} score=${o.score} /></div>
      <p class="tiny muted" style=${{ marginTop: '.3rem' }}>0.45·Skill + 0.25·Reputation + 0.15·Availability + 0.10·Fair rotation + 0.05·Growth. Pay isn’t part of it.</p></details>
    <div class="row"><${AsyncButton} class="primary" onClick=${accept}>Accept and claim<//><${AsyncButton} onClick=${() => act(() => T.api.respondToOffer(me.id, o.id, false), 'Declined. No penalty.')}>Decline<//></div>
  </div>`;
}

function PanelDuty({ d, me }) {
  const T = useT();
  const [note, setNote] = useState('');
  const c = T.db.get('Commission', d.commissionId);
  const voted = d.votes[me.id];
  return html`<div class="card warn stack-sm">
    <h2>Dispute panel: ${c.title}</h2>
    <p class="small">The requester disputes ${d.tileIds.length} tile${d.tileIds.length > 1 ? 's' : ''}: “${d.reason}”</p>
    <ul class="small" style=${{ paddingLeft: '1.1rem' }}>${d.tileIds.map((id) => { const t = T.db.get('Tile', id); return html`<li><a href=${`#/t/${id}`}>${t.title}</a> by ${T.db.get('User', t.claimedById)?.name}</li>`; })}</ul>
    ${voted ? html`<p class="small">You voted to <b>${voted.vote.toLowerCase()}</b>. Waiting for the rest of the panel.</p>` : html`
      <textarea aria-label="Note for your vote (optional)" placeholder="Optional note explaining your vote" value=${note} onInput=${(e) => setNote(e.target.value)} rows="2"></textarea>
      <div class="row"><${AsyncButton} class="good" onClick=${() => act(() => T.api.castPanelVote(me.id, d.id, 'UPHOLD', note), 'Vote cast: uphold.')}>Uphold the delivery<//><${AsyncButton} class="danger" onClick=${() => act(() => T.api.castPanelVote(me.id, d.id, 'REOPEN', note), 'Vote cast: reopen.')}>Reopen the tiles<//></div>
      <p class="tiny muted">Two of three votes decide. Reopened tiles are redone as new tiles funded by the platform; accepted pay is never clawed back.</p>`}
  </div>`;
}

const HIDDEN_TEXT = {
  'below-floor': 'pay under your floor',
  'no-skill': 'need skills you haven’t listed',
  language: 'need a language you don’t work in',
  'no-availability': 'need you before your next availability window',
  'over-cap': 'would put you over your weekly hours cap',
  excluded: 'you’ve already had',
  'own-commission': 'are on your own commission',
  'no-reviewer-rep': 'are peer reviews needing reputation you haven’t earned yet',
  'worked-on-commission': 'are reviews of commissions you worked on',
  'worked-on-tile': 'are reviews of your own work',
};

export function Board() {
  const T = useT();
  useDbVersion();
  const now = useNow(5000);
  const me = currentUser(T);
  const [skill, setSkill] = useState('');
  if (!me.isContributor) return html`<${NotContributor} />`;
  const { visible, hidden, totalOpen } = boardFor(T.db, me.id, now);
  const skills = [...new Set(visible.flatMap((v) => v.tile.skillTags))].sort();
  const shown = skill ? visible.filter((v) => v.tile.skillTags.includes(skill)) : visible;
  const claim = async (t) => { const r = await act(() => T.api.claimFromBoard(me.id, t.id), 'Claimed.'); if (r) navigate(`#/t/${t.id}`); };
  return html`<div class="stack">
    <div class="page-head"><div><h1>Open board</h1><p class="sub">Open tiles you can claim right now: their offer windows have passed, or no one was offered them. Prices are fixed; there’s no bidding.</p></div></div>
    ${skills.length > 1 ? html`<div class="row"><span class="small muted">Filter:</span><button class=${`btn small ${skill ? '' : 'primary'}`} onClick=${() => setSkill('')}>All</button>${skills.map((s) => html`<button class=${`btn small ${skill === s ? 'primary' : ''}`} onClick=${() => setSkill(s)}>${s}</button>`)}</div>` : ''}
    ${shown.length ? html`<div class="grid-2">${shown.map(({ tile: t, fit }) => html`<div class="card stack-sm" key=${t.id}>
      <span class="tiny muted">${commissionLabel(T.db, t)}</span>
      <h3 style=${{ margin: 0 }}>${t.title}</h3>
      <div class="row small"><b><${Money} cents=${t.payCents} /></b><span class="muted">·</span><${Rate} tile=${t} /><span class="muted">·</span>${fmtMinutes(t.estMinutes)}<span class="muted">·</span>tier ${t.tier}${t.kind !== 'WORK' ? html`<span class="badge info">${t.kind.toLowerCase()}</span>` : ''}</div>
      <div class="tags">${t.skillTags.map((s) => html`<span class="tag">${s}</span>`)}</div>
      <p class="small">${truncate(t.spec.replace(/^Context:[^\n]*\n\n?/, ''), 200)}</p>
      <div class="row-between"><span class="small muted">Your fit: ${fit.score?.toFixed(2)}</span><${AsyncButton} class="primary" onClick=${() => claim(t)}>Claim<//></div>
    </div>`)}</div>` : html`<div class="card"><${Empty} title="Nothing you can claim right now">${totalOpen ? `${totalOpen} tile(s) are open, but none fit you yet.` : 'The board is empty; offers are going out as tiles open.'}</${Empty}></div>`}
    ${Object.keys(hidden).length ? html`<div class="callout"><b>Hidden from you:</b> ${Object.entries(hidden).map(([code, n]) => `${n} ${n === 1 ? 'tile' : 'tiles'} that ${HIDDEN_TEXT[code] || code}`).join('; ')}. Pay floors are hard filters, so tiles below yours never appear here or in offers.</div>` : ''}
  </div>`;
}

export function MyWork() {
  const T = useT();
  useDbVersion();
  const now = useNow(1000);
  const me = currentUser(T);
  if (!me.isContributor) return html`<${NotContributor} />`;
  const mine = T.db.filter('Tile', (t) => t.claimedById === me.id);
  const groups = [
    ['In progress', mine.filter((t) => ['CLAIMED', 'REVISION'].includes(t.status))],
    ['Being checked', mine.filter((t) => ['SUBMITTED', 'IN_REVIEW'].includes(t.status))],
    ['Accepted', mine.filter((t) => t.status === 'ACCEPTED').sort((a, b) => b.acceptedAt - a.acceptedAt)],
  ];
  const reopened = T.db.filter('Tile', (t) => (t.excludedUserIds || []).includes(me.id) && t.claimedById !== me.id);
  return html`<div class="stack">
    <div class="page-head"><div><h1>My tiles</h1><p class="sub">Everything you’ve claimed. A claim lasts three times the estimate or 48 hours, whichever is longer.</p></div></div>
    ${groups.map(([title, list]) => html`<div class="card"><div class="card-head"><h2>${title}</h2><span class="small muted">${list.length}</span></div>
      ${list.length ? html`<div class="table-wrap"><table><thead><tr><th>Tile</th><th>Status</th><th class="right">Pay</th><th>${title === 'Accepted' ? 'Accepted' : 'Claim ends'}</th></tr></thead><tbody>
        ${list.map((t) => html`<tr class="clickable" tabindex="0" onClick=${() => navigate(`#/t/${t.id}`)} onKeyDown=${(e) => e.key === 'Enter' && navigate(`#/t/${t.id}`)}>
          <td><b>${t.title}</b><div class="tiny muted">${commissionLabel(T.db, t)}${t.revisionCount ? ` · revision ${t.revisionCount} of ${config.maxRevisionRounds}` : ''}</div></td>
          <td><${StatusBadge} status=${t.status} /></td><td class="money">${fmtMoney(t.payCents)}</td>
          <td class="small">${title === 'Accepted' ? ago(t.acceptedAt, now) : t.claimExpiresAt && ['CLAIMED', 'REVISION'].includes(t.status) ? html`<${Countdown} until=${t.claimExpiresAt} now=${now} />` : '—'}</td></tr>`)}
      </tbody></table></div>` : html`<p class="small muted">None.</p>`}
    </div>`)}
    ${reopened.length ? html`<div class="card"><h2>Released or reopened</h2><ul class="small" style=${{ paddingLeft: '1.1rem' }}>${reopened.map((t) => html`<li><a href=${`#/t/${t.id}`}>${t.title}</a>${t.partialPayCandidate?.contributorId === me.id && t.partialPayCandidate.paidCents > 0 ? ` · partial pay ${fmtMoney(t.partialPayCandidate.paidCents)}` : ''}</li>`)}</ul></div>` : ''}
  </div>`;
}

export function Earnings() {
  const T = useT();
  useDbVersion();
  const now = useNow(10000);
  const me = currentUser(T);
  if (!me.isContributor) return html`<${NotContributor} />`;
  const ledger = T.db.all('LedgerEntry');
  const mine = ledger.filter((e) => e.userId === me.id && PAYOUT_TYPES.includes(e.type)).sort((a, b) => b.createdAt - a.createdAt);
  const byType = (type) => -mine.filter((e) => e.type === type).reduce((n, e) => n + e.amountCents, 0);
  return html`<div class="stack">
    <div class="page-head"><div><h1>Earnings</h1><p class="sub">Recomputed from ${mine.length} ledger entries every time you open this page. Pay is released the moment a tile is accepted.</p></div></div>
    <div class="card stats">
      <div class="stat"><span class="v">${fmtMoney(userEarnings(ledger, me.id))}</span><span class="l">All time</span></div>
      <div class="stat"><span class="v">${fmtMoney(userEarnings(ledger, me.id, { since: now - 7 * DAY }))}</span><span class="l">Last 7 days</span></div>
      <div class="stat"><span class="v">${fmtMoney(byType('TILE_PAYOUT'))}</span><span class="l">Tiles</span></div>
      <div class="stat"><span class="v">${fmtMoney(byType('REVIEW_PAYOUT'))}</span><span class="l">Reviews</span></div>
      <div class="stat"><span class="v">${fmtMoney(byType('PARTIAL_PAYOUT'))}</span><span class="l">Partial pay</span></div>
    </div>
    ${mine.length ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>For</th><th>Type</th><th class="right">Amount</th></tr></thead><tbody>
      ${mine.map((e) => html`<tr><td class="tiny nowrap">${fmtDateTime(e.createdAt)}</td><td class="small">${e.tileId ? html`<a href=${`#/t/${e.tileId}`}>${e.memo}</a>` : e.memo}</td><td><span class="badge">${e.type.replace(/_/g, ' ').toLowerCase()}</span></td><td class="money">${fmtMoney(-e.amountCents)}</td></tr>`)}
    </tbody></table></div>` : html`<div class="card"><${Empty} title="No earnings yet">Accept an offer and submit work to get paid.</${Empty}></div>`}
    <p class="small muted">The platform fee (${config.feeRate * 100}%) is paid by the requester on top of tile pay, so you receive the full amount shown on each tile.</p>
  </div>`;
}

export function Reputation() {
  const T = useT();
  useDbVersion();
  const now = useNow(10000);
  const me = currentUser(T);
  const [record, setRecord] = useState(null);
  if (!me.isContributor) return html`<${NotContributor} />`;
  const events = T.db.filter('ReputationEvent', (e) => e.userId === me.id).sort((a, b) => b.createdAt - a.createdAt);
  const rep = summarizeReputation(events, me.id, now);
  const skills = Object.values(rep.skills).sort((a, b) => b.accepted - a.accepted);
  const profile = T.db.find('ContributorProfile', (p) => p.userId === me.id);
  const unlisted = profile.skills.filter((s) => !rep.skills[s.tag]);
  const exportIt = async () => {
    const r = await act(() => T.api.exportReputation(me.id));
    if (r) {
      setRecord(r);
      T.db.tx((tx) => tx.setMeta({ guide: { ...(tx.meta.guide || {}), exported: true } }));
    }
  };
  return html`<div class="stack">
    <div class="page-head"><div><h1>Reputation</h1><p class="sub">Yours, per skill, built only from accepted work and reviews. Export it as a signed record any platform can verify.</p></div>
      <${AsyncButton} class="primary" onClick=${exportIt}>Export signed record<//></div>
    ${skills.length ? html`<div class="grid-3">${skills.map((s) => html`<div class="card">
      <div class="row-between"><span class="tag">${s.tag}</span><span class="small muted">best tier ${s.highestTier || '—'}</span></div>
      <div class="stat" style=${{ marginTop: '.5rem' }}><span class="v">${Math.round(s.score * 100)}%</span><span class="l">smoothed acceptance · ${s.accepted} accepted of ${s.attempts} attempts</span></div>
      <div class="meter" style=${{ marginTop: '.5rem' }}><div style=${{ width: `${Math.round(s.score * 100)}%` }}></div></div>
    </div>`)}</div>` : html`<div class="card"><${Empty} title="No reputation events yet">Every new contributor starts at 50% in every skill.</${Empty}></div>`}
    ${unlisted.length ? html`<p class="small muted">No history yet in ${unlisted.map((s) => s.tag).join(', ')}: those start at 50%.</p>` : ''}
    <div class="card"><h2>Events</h2>
      ${events.length ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>Skill</th><th>Event</th><th class="right">Points</th></tr></thead><tbody>
        ${events.map((e) => html`<tr><td class="tiny nowrap">${fmtDateTime(e.createdAt)}</td><td><span class="tag">${e.skillTag}</span></td><td class="small">${REP_REASONS[e.reason]?.label}${e.tileId ? html` · <a href=${`#/t/${e.tileId}`}>tile</a>` : ''}</td><td class="money">${e.delta > 0 ? '+' : ''}${e.delta}</td></tr>`)}
      </tbody></table></div>` : html`<p class="small muted">None yet.</p>`}
      <p class="tiny muted" style=${{ marginTop: '.5rem' }}>R = (accepted + 2) / (attempts + 4). Events older than 12 months count half. A failed review is an attempt; a first expired claim isn’t counted.</p>
    </div>
    ${record && html`<${Modal} wide title="Signed reputation record" onClose=${() => setRecord(null)}>
      <p class="small">Signed with this demo instance’s Ed25519 key (<span class="mono">${record.issuer.keyId}</span>). Change any character and verification fails.</p>
      <pre style=${{ marginTop: '.6rem' }}>${JSON.stringify(record, null, 2)}</pre>
      <div class="row" style=${{ marginTop: '.8rem' }}>
        <button class="btn primary" onClick=${() => { downloadText(JSON.stringify(record, null, 2), `reputation-${me.name.toLowerCase().replace(/\s+/g, '-')}.json`, 'application/json'); toast('Downloaded.', 'ok'); }}>Download JSON</button>
        <button class="btn" onClick=${() => { setPendingRecord(record); navigate('#/verify'); }}>Verify it now</button>
      </div>
    <//>`}
  </div>`;
}
