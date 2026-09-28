// Welcome page, persona picker and each role's home dashboard.
import { html } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, navigate, currentUser, setPersona, toast } from '../state.js';
import { Avatar, StatusBadge, Mosaic, Legend, Money, Empty, Countdown, Pipeline, Rate } from '../ui.js';
import { fmtMoney, fmtRate, DAY } from '../../lib/util.js';
import { userEarnings, commissionBalance } from '../../domain/ledger.js';
import { summarizeReputation } from '../../domain/reputation.js';
import { AdminView } from './admin.js';

export const COMMISSION_STEPS = ['SCOPING', 'PLANNED', 'ACTIVE', 'ASSEMBLING', 'DELIVERED', 'ACCEPTED'];

function HeroArt() {
  const colors = ['#4aa3df', '#13a07a', '#e0a100', '#9b59d0', '#5b5fd6', '#e2711d', '#13a07a', '#4aa3df'];
  const cells = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
    const i = y * 8 + x;
    cells.push(html`<rect x=${x * 40 + 2} y=${y * 40 + 2} width="36" height="36" rx="6" fill=${colors[(x * 3 + y * 5) % colors.length]} fill-opacity=".92"
      style=${{ animation: `tessIn .5s ease ${(i * 37 % 48) * 0.06}s both` }} />`);
  }
  return html`<svg class="hero-art" viewBox="0 0 322 242" role="img" aria-label="A mosaic of colored tiles filling in">
    <style>${'@keyframes tessIn { from { opacity: 0 } to { opacity: 1 } } @media (prefers-reduced-motion: reduce) { rect { animation: none !important } }'}</style>
    ${cells}</svg>`;
}

const FLOW = ['Post the job', 'Scope', 'Break it down', 'Approve & fund', 'Match & offer', 'Translate brief', 'Do the work', 'Verify', 'Release pay', 'Assemble', 'Sign off'];

export function startGuidedDemo(T) {
  setPersona(T, 'usr_tom');
  T.db.tx((tx) => tx.setMeta({ guide: { ...(tx.meta.guide || {}), dismissed: false, minimized: false, startedAt: tx.now() } }));
  navigate('#/post?example=flyer');
  toast('You are Tom, an outreach librarian. Post the example commission to start.', 'ok');
}

export function Welcome() {
  const T = useT();
  return html`<div>
    <section class="hero">
      <div>
        <h1>Any job, split into pieces separate people can do at once.</h1>
        <p class="lead">Describe a job, whether it’s a gala, a grant, an app, 5,000 product listings or a podcast season. Tessera reads it, finds the separate pieces of work, and splits them into <b>tiles</b>: each one says exactly what it receives, what it delivers and how it’s checked, so a different person can do each at the same time.</p>
        <p class="lead muted" style=${{ fontSize: '.95rem' }}>Then it prices the tiles, offers each to people with the right skills, and assembles the results. A working prototype that runs in your browser with simulated money.</p>
        <div class="row hero-actions" style=${{ marginTop: '1.1rem' }}>
          <a class="btn primary" href="#/breakdown">Break down a job</a>
          <button class="btn" onClick=${() => startGuidedDemo(T)}>Run the full loop (guided, 5 minutes)</button>
          <a class="btn ghost" href="#/how">How it works</a>
        </div>
        <div class="row small" style=${{ marginTop: '.7rem', gap: '.35rem' }}><span class="muted">See a split:</span>
          <a href="#/breakdown?example=gala">a gala</a><span class="muted">·</span><a href="#/breakdown?example=listings">5,000 listings</a><span class="muted">·</span><a href="#/breakdown?example=podcast">a podcast season</a><span class="muted">·</span><a href="#/breakdown?example=app">an app</a><span class="muted">·</span><a href="#/breakdown?example=grant">a grant proposal</a>
        </div>
      </div>
      <${HeroArt} />
    </section>
    <h2 class="section-title">How work flows</h2>
    <div class="flow">${FLOW.map((s, i) => html`${i ? html`<span class="arr" aria-hidden="true">→</span>` : ''}<span class="step">${s}</span>`)}</div>
    <div class="grid-3" style=${{ marginTop: '1.4rem' }}>
      <div class="card"><h3>Contract first, then everyone at once</h3><p class="small">The first tile fixes the shared terms, formats and file names. Every other tile works from it, so a glossary, codebook or API contract lets ten people work in parallel without stepping on each other.</p></div>
      <div class="card"><h3>Fixed prices, no bidding</h3><p class="small">Pay comes from a formula on estimated time and skill tier. Nobody can win work by accepting less, and a pay floor is a hard filter.</p></div>
      <div class="card"><h3>Reputation you own</h3><p class="small">Built only from accepted work and reviews, per skill, and exportable as a signed record anyone can verify.</p></div>
      <div class="card"><h3>People decide what matters</h3><p class="small">Agents propose, check and assemble. People approve plans, claim work, settle disputes and sign off.</p></div>
    </div>
    <h2 class="section-title">Or jump in as anyone</h2>
    <${PersonaGrid} />
    <div class="callout" style=${{ marginTop: '1.4rem' }}>
      <b>What’s real here:</b> the pricing and matching formulas, both state machines, the append-only ledger and reputation, automatic checks, peer-review sampling, revisions, disputes, signed exports, and the LLM layer (connect Claude in <a href="#/settings">Settings</a>).${' '}
      <b>What’s simulated:</b> the money, the other people (a crowd simulation you can switch off), and the default model, a deterministic mock that needs no key.
    </div>
  </div>`;
}

function personaFacts(T, u) {
  const p = T.db.find('ContributorProfile', (x) => x.userId === u.id);
  if (u.isAdmin) return 'Admin: agent runs, jobs, ledger, costs, keys';
  if (u.isRequester) return `Requester · ${T.db.count('Commission', (c) => c.requesterId === u.id)} commission(s)`;
  if (!p) return '';
  return `${p.skills.slice(0, 3).map((s) => s.tag).join(', ')} · floor ${fmtRate(p.payFloorCents)}`;
}

export function PersonaGrid() {
  const T = useT();
  useDbVersion();
  const me = currentUser(T);
  const people = T.db.filter('User', (u) => u.persona);
  const section = (title, list) => html`<h3 class="section-title">${title}</h3><div class="grid-3">
    ${list.map((u) => html`<button class=${`persona ${me?.id === u.id ? 'current' : ''}`} onClick=${() => { setPersona(T, u.id); navigate('#/'); toast(`You are now ${u.name}.`, 'ok'); }}>
      <${Avatar} user=${u} size=${38} />
      <span><b>${u.name}</b><span class="meta">${u.org || (u.isAdmin ? 'Platform' : 'Contributor')}</span>
      <span class="small" style=${{ display: 'block', marginTop: '.25rem' }}>${u.blurb}</span>
      <span class="tiny muted" style=${{ display: 'block', marginTop: '.25rem' }}>${personaFacts(T, u)}</span></span>
    </button>`)}</div>`;
  return html`<div>${section('Requesters', people.filter((u) => u.isRequester))}${section('Contributors', people.filter((u) => u.isContributor))}${section('Platform', people.filter((u) => u.isAdmin))}</div>`;
}

export function PersonaPage({ reason }) {
  return html`<div>
    <div class="page-head"><div><h1>Pick a persona</h1><p class="sub">${reason || 'No account needed. Switch at any time from the menu at the top right.'}</p></div></div>
    <${PersonaGrid} />
  </div>`;
}

/** Things a requester needs to act on for one commission. */
export function requesterTodos(db, c) {
  const out = [];
  const tiles = db.filter('Tile', (t) => t.commissionId === c.id);
  if (c.status === 'SCOPING' && c.clarifications.scopedAt && !c.clarifications.answeredAt && c.clarifications.questions.length) out.push({ text: 'Answer the scoping questions', tab: 'plan' });
  if (c.planError) out.push({ text: c.planError, tab: 'plan', bad: true });
  if (c.status === 'PLANNED') out.push({ text: 'Review the plan and fund it', tab: 'plan' });
  if (c.status === 'DELIVERED') out.push({ text: 'Accept or dispute the delivery', tab: 'delivery' });
  for (const t of tiles) {
    if (t.status === 'IN_REVIEW' && t.pendingReviewTileId) {
      const rt = db.get('Tile', t.pendingReviewTileId);
      if (rt && rt.status === 'OPEN' && rt.matchSummary && rt.matchSummary.eligible === 0) out.push({ text: `No peer reviewer is free for “${t.title}”. Review it yourself.`, href: `#/t/${t.id}` });
    }
    if (t.partialPayCandidate && !t.partialPayCandidate.paidCents) out.push({ text: `Decide on partial pay for “${t.title}”`, href: `#/t/${t.id}` });
  }
  return out;
}

export function CommissionCard({ c }) {
  const T = useT();
  const now = useNow(5000);
  const tiles = T.db.filter('Tile', (t) => t.commissionId === c.id && t.status !== 'CANCELLED');
  const planned = tiles.filter((t) => !t.dynamic);
  const accepted = planned.filter((t) => t.status === 'ACCEPTED').length;
  const todos = requesterTodos(T.db, c);
  const spent = T.db.filter('LedgerEntry', (e) => e.commissionId === c.id && e.type !== 'ESCROW_FUND' && e.type !== 'REFUND').reduce((n, e) => n - e.amountCents, 0);
  return html`<a class="card card-link" href=${`#/c/${c.id}`}>
    <div class="row-between"><h3 style=${{ margin: 0 }}>${c.title}</h3><${StatusBadge} status=${c.status} kind="commission" /></div>
    <div class="small muted" style=${{ margin: '.3rem 0 .6rem' }}>Budget ${fmtMoney(c.budgetCents)} · ${c.privacy.replace(/_/g, '-').toLowerCase()} · due ${new Date(c.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
    ${planned.length ? html`<${Mosaic} tiles=${tiles} /><div class="small" style=${{ marginTop: '.5rem' }}>${accepted} of ${planned.length} tiles accepted${spent ? html` · ${fmtMoney(spent)} paid out` : ''}${c.status === 'DELIVERED' && c.autoAcceptAt ? html` · auto-accepts in <${Countdown} until=${c.autoAcceptAt} now=${now} />` : ''}</div>` : html`<div class="small muted">${c.status === 'SCOPING' ? (c.clarifications.scopedAt ? 'Scoping questions are ready.' : 'The Scoping agent is reading the commission…') : ''}</div>`}
    ${todos.map((t) => html`<div class=${`callout ${t.bad ? 'bad' : 'warn'}`} style=${{ marginTop: '.5rem', padding: '.35rem .6rem' }}>${t.text}</div>`)}
  </a>`;
}

function RequesterHome({ me }) {
  const T = useT();
  const mine = T.db.filter('Commission', (c) => c.requesterId === me.id).sort((a, b) => b.createdAt - a.createdAt);
  return html`<div>
    <div class="page-head"><div><h1>${me.name}</h1><p class="sub">${me.org} · requester</p></div><a class="btn primary" href="#/post">Post a commission</a></div>
    ${mine.length ? html`<div class="grid-2">${mine.map((c) => html`<${CommissionCard} c=${c} key=${c.id} />`)}</div><${Legend} />` : html`<div class="card"><${Empty} title="No commissions yet">Post one to see it scoped, split into tiles and priced.</${Empty}></div>`}
  </div>`;
}

function ContributorHome({ me }) {
  const T = useT();
  const now = useNow(5000);
  const ledger = T.db.all('LedgerEntry');
  const offers = T.db.filter('Offer', (o) => o.contributorId === me.id && o.response === 'PENDING');
  const held = T.db.filter('Tile', (t) => t.claimedById === me.id && ['CLAIMED', 'SUBMITTED', 'IN_REVIEW', 'REVISION'].includes(t.status));
  const rep = summarizeReputation(T.db.all('ReputationEvent'), me.id, now);
  const panels = T.db.filter('Dispute', (d) => d.status === 'OPEN' && d.panel.includes(me.id) && !d.votes[me.id]);
  const p = T.db.find('ContributorProfile', (x) => x.userId === me.id);
  return html`<div>
    <div class="page-head"><div><h1>${me.name}</h1><p class="sub">${me.blurb}</p></div><a class="btn" href="#/profile">Edit profile</a></div>
    <div class="stats card">
      <div class="stat"><span class="v">${fmtMoney(userEarnings(ledger, me.id))}</span><span class="l">Earned in total</span></div>
      <div class="stat"><span class="v">${fmtMoney(userEarnings(ledger, me.id, { since: now - 7 * DAY }))}</span><span class="l">Last 7 days</span></div>
      <div class="stat"><span class="v">${Math.round(rep.totalAccepted)}</span><span class="l">Tiles and reviews accepted</span></div>
      <div class="stat"><span class="v">${fmtRate(p.payFloorCents)}</span><span class="l">Your pay floor</span></div>
    </div>
    ${panels.length ? html`<div class="callout warn" style=${{ marginTop: '1rem' }}>You’re on ${panels.length} dispute panel${panels.length > 1 ? 's' : ''}. <a href="#/offers">Cast your vote →</a></div>` : ''}
    <div class="grid-2" style=${{ marginTop: '1rem' }}>
      <div class="card"><div class="card-head"><h2>Offers waiting</h2><a href="#/offers" class="small">All offers →</a></div>
        ${offers.length ? offers.slice(0, 4).map((o) => { const t = T.db.get('Tile', o.tileId); return html`<a class="row-between" href="#/offers" style=${{ padding: '.4rem 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}><span><b>${t.title}</b><br/><span class="small muted">${fmtMoney(t.payCents)} · <${Rate} tile=${t} /> · ${t.estMinutes} min</span></span><span class="small">closes in <${Countdown} until=${o.expiresAt} now=${now} /></span></a>`; })
          : html`<${Empty} title="No offers right now">The Matcher offers tiles that fit your skills, availability and floor. Check the <a href="#/board">open board</a> too.</${Empty}>`}
      </div>
      <div class="card"><div class="card-head"><h2>Your tiles</h2><a href="#/work" class="small">All →</a></div>
        ${held.length ? held.map((t) => html`<a class="row-between" href=${`#/t/${t.id}`} style=${{ padding: '.4rem 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}><span><b>${t.title}</b><br/><span class="small muted">${fmtMoney(t.payCents)}${t.claimExpiresAt && ['CLAIMED', 'REVISION'].includes(t.status) ? html` · claim ends in <${Countdown} until=${t.claimExpiresAt} now=${now} />` : ''}</span></span><${StatusBadge} status=${t.status} /></a>`)
          : html`<${Empty} title="Nothing in progress">Accept an offer to start a tile.</${Empty}>`}
      </div>
    </div>
  </div>`;
}

export function Home() {
  const T = useT();
  useDbVersion();
  const me = currentUser(T);
  if (me.isAdmin) return html`<${AdminView} />`;
  if (me.isRequester) return html`<${RequesterHome} me=${me} />`;
  return html`<${ContributorHome} me=${me} />`;
}

export { Pipeline, commissionBalance, Money };
