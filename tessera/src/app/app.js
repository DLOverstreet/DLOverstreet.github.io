// The app shell: header with clock, crowd and persona controls, role-based navigation,
// routing, the guided demo and toasts.
import { html, useEffect, useState, useRef } from '../../vendor/preact.js';
import { useT, useDbVersion, useNow, useRoute, navigate, currentUser, setPersona, toast } from './state.js';
import { Avatar, Logo, Toasts } from './ui.js';
import { HOUR, DAY, fmtDuration } from '../lib/util.js';
import { Welcome, PersonaPage, Home } from './views/home.js';
import { HowItWorks } from './views/how.js';
import { PostCommission } from './views/post.js';
import { CommissionView } from './views/commission.js';
import { Offers, Board, MyWork, Earnings, Reputation } from './views/contributor.js';
import { TileView } from './views/tile.js';
import { ProfileView } from './views/profile.js';
import { AdminView } from './views/admin.js';
import { SettingsView } from './views/settings.js';
import { VerifyView } from './views/verify.js';
import { BreakdownPage } from './views/breakdown.js';
import { Guide } from './guide.js';

function useOutside(ref, onOut) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onOut(); };
    const k = (e) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('pointerdown', h); document.removeEventListener('keydown', k); };
  }, []);
}

function ClockMenu() {
  const T = useT();
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const st = T.clock.state();
  const shifted = st.mode === 'frozen' || Math.abs(st.offsetMs) > 60000;
  const day = new Date(now).toLocaleString('en-US', { weekday: 'short' });
  const time = new Date(now).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  const advance = async (ms, what) => {
    T.clock.advance(ms);
    await T.worker.tick();
    toast(`Moved the clock forward ${what}. Timers (offer windows, claims, auto-acceptance) were applied.`, 'ok');
  };
  return html`<div class="rel" ref=${ref}>
    <button class="chip-btn" aria-haspopup="true" aria-expanded=${open} onClick=${() => setOpen(!open)} title="Simulated clock">
      <span aria-hidden="true">⏱</span><span class="num"><span class="hide-xs">${day} </span>${time}</span>${shifted ? html`<span class="hide-sm" style=${{ opacity: 0.7 }}>${st.mode === 'frozen' ? '(paused)' : `(+${fmtDuration(st.offsetMs)})`}</span>` : ''}
    </button>
    ${open && html`<div class="menu" role="menu">
      <div class="small muted" style=${{ padding: '.3rem .55rem .45rem' }}>Every time rule reads this clock. Move it forward to see offers lapse (2 h), claims expire (48 h) and deliveries auto-accept (7 days).</div>
      <button role="menuitem" onClick=${() => advance(HOUR, 'an hour')}>⏩ Forward 1 hour</button>
      <button role="menuitem" onClick=${() => advance(DAY, 'a day')}>⏩ Forward 1 day</button>
      <button role="menuitem" onClick=${() => advance(7 * DAY + 60000, 'a week')}>⏩ Forward 7 days</button>
      <div class="sep"></div>
      <button role="menuitem" onClick=${() => { T.clock.run(0); toast('Back to real time.', 'ok'); setOpen(false); }}>↺ Back to real time</button>
    </div>`}
  </div>`;
}

function CrowdToggle() {
  const T = useT();
  useDbVersion();
  const on = !!T.db.meta.settings.crowd;
  return html`<button class="chip-btn" aria-pressed=${on} title="When on, the other seeded contributors accept offers, do sample work and review each other on their own."
    onClick=${() => { T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, crowd: !on } })); toast(on ? 'Crowd paused. Nobody acts unless you do it.' : 'Crowd on. Other contributors will pick up and finish tiles on their own.', 'ok'); }}>
    <span class=${`dot ${on ? '' : 'off'}`} aria-hidden="true"></span><span>Crowd<span class="hide-xs"> ${on ? 'on' : 'off'}</span></span>
  </button>`;
}

function PersonaMenu() {
  const T = useT();
  useDbVersion();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const me = currentUser(T);
  const people = T.db.filter('User', (u) => u.persona);
  const group = (title, list) => list.length ? html`<div class="tiny muted" style=${{ padding: '.35rem .55rem .1rem', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>${title}</div>
    ${list.map((u) => html`<button role="menuitem" onClick=${() => { setPersona(T, u.id); setOpen(false); navigate('#/'); toast(`You are now ${u.name}.`, 'ok'); }} aria-current=${me?.id === u.id}>
      <${Avatar} user=${u} size=${24} /><span>${u.name}${u.org ? html`<span class="muted tiny"> · ${u.org}</span>` : ''}</span>${me?.id === u.id ? html`<span style=${{ marginLeft: 'auto' }}>✓</span>` : ''}
    </button>`)}` : '';
  return html`<div class="rel" ref=${ref}>
    <button class="chip-btn persona-btn" aria-haspopup="true" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      ${me ? html`<${Avatar} user=${me} size=${24} /><span class="hide-sm">${me.name.split(' ')[0]}</span>` : html`<span>Pick a persona</span>`}<span aria-hidden="true">▾</span>
    </button>
    ${open && html`<div class="menu" role="menu" style=${{ maxHeight: '70vh', overflowY: 'auto' }}>
      ${group('Requesters', people.filter((u) => u.isRequester))}
      ${group('Contributors', people.filter((u) => u.isContributor))}
      ${group('Platform', people.filter((u) => u.isAdmin))}
      <div class="sep"></div>
      <a href="#/personas" onClick=${() => setOpen(false)}>All personas, with who they are →</a>
    </div>`}
  </div>`;
}

function Nav({ route }) {
  const T = useT();
  useDbVersion();
  const me = currentUser(T);
  const here = route.parts[0] || '';
  const offers = me ? T.db.count('Offer', (o) => o.contributorId === me.id && o.response === 'PENDING') + T.db.count('Dispute', (d) => d.status === 'OPEN' && d.panel.includes(me.id) && !d.votes[me.id]) : 0;
  const link = (to, label, key, count) => html`<a href=${to} class=${here === key ? 'active' : ''} aria-current=${here === key ? 'page' : undefined}>${label}${count ? html`<span class="count" aria-label=${`${count} waiting`}>${count}</span>` : ''}</a>`;
  return html`<nav class="nav" aria-label="Main">
    ${link('#/', 'Home', '')}
    ${link('#/breakdown', 'Break down a job', 'breakdown')}
    ${me?.isRequester ? html`${link('#/post', 'Post a commission', 'post')}` : ''}
    ${me?.isContributor ? html`${link('#/offers', 'Offers', 'offers', offers)}${link('#/board', 'Open board', 'board')}${link('#/work', 'My tiles', 'work')}${link('#/earnings', 'Earnings', 'earnings')}${link('#/reputation', 'Reputation', 'reputation')}${link('#/profile', 'Profile', 'profile')}` : ''}
    ${me?.isAdmin ? link('#/admin', 'Admin', 'admin') : ''}
    ${link('#/how', 'How it works', 'how')}
    ${link('#/settings', 'Settings', 'settings')}
  </nav>`;
}

function Routes({ route }) {
  const T = useT();
  useDbVersion();
  const [a, b, c] = route.parts;
  const me = currentUser(T);
  const needPersona = (view) => (me ? view : html`<${PersonaPage} reason="Pick a persona first. Everything here is simulated, so you can switch at any time." />`);
  switch (a) {
    case undefined: return me ? html`<${Home} />` : html`<${Welcome} />`;
    case 'how': return html`<${HowItWorks} />`;
    case 'breakdown': return html`<${BreakdownPage} key=${route.query.example || ''} example=${route.query.example} />`;
    case 'personas': return html`<${PersonaPage} />`;
    case 'post': return needPersona(html`<${PostCommission} example=${route.query.example} />`);
    case 'c': return html`<${CommissionView} id=${b} tab=${c} />`;
    case 'offers': return needPersona(html`<${Offers} />`);
    case 'board': return needPersona(html`<${Board} />`);
    case 'work': return needPersona(html`<${MyWork} />`);
    case 't': return html`<${TileView} id=${b} />`;
    case 'earnings': return needPersona(html`<${Earnings} />`);
    case 'reputation': return needPersona(html`<${Reputation} />`);
    case 'profile': return needPersona(html`<${ProfileView} />`);
    case 'admin': return html`<${AdminView} tab=${b} />`;
    case 'settings': return html`<${SettingsView} />`;
    case 'verify': return html`<${VerifyView} />`;
    default: return html`<div class="empty"><h1 tabindex="-1">Not found</h1><p><a href="#/">Go home</a></p></div>`;
  }
}

export function App({ banner }) {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
    const h = /** @type {HTMLElement|null} */ (document.querySelector('main h1'));
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }, [route.parts.join('/')]);
  return html`
    <a class="skip-link" href="#main" onClick=${(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    ${banner && html`<div class="banner" role="status">${banner}</div>`}
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#/"><${Logo} /><span>Tessera</span><small>prototype</small></a>
        <a class="back-link" href="../#applications">← dloverstreet.github.io</a>
        <span class="spacer"></span>
        <${ClockMenu} />
        <${CrowdToggle} />
        <${PersonaMenu} />
      </div>
      <${Nav} route=${route} />
    </header>
    <main id="main" tabindex="-1"><${Routes} route=${route} /></main>
    <footer class="footer">
      Tessera is a working prototype built from <a href="https://github.com/DLOverstreet/DLOverstreet.github.io/blob/main/tessera/docs/BLUEPRINT.md">the blueprint</a>. It runs entirely in your browser with simulated money; nothing you do here leaves this device unless you connect your own model.${' '}
      <a href="https://github.com/DLOverstreet/DLOverstreet.github.io/tree/main/tessera">Source</a> · <a href="#/how">How it works</a> · <a href="#/verify">Verify a reputation record</a>
    </footer>
    <${Guide} />
    <${Toasts} />`;
}
