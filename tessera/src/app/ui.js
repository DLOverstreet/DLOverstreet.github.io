// Shared UI components.
import { html, useEffect, useRef, useState } from '../../vendor/preact.js';
import { hashString, fmtMoney, fmtDuration, fmtRate } from '../lib/util.js';
import { renderMarkdown } from '../lib/markdown.js';
import { onToast } from './state.js';
import { SCORE_LABELS } from '../domain/matching.js';

export const STATUS_LABEL = {
  DRAFT: 'Draft', LOCKED: 'Locked', OPEN: 'Open', OFFERED: 'Offered', CLAIMED: 'Claimed', SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review', REVISION: 'Revision', ACCEPTED: 'Accepted', CANCELLED: 'Cancelled',
  SCOPING: 'Scoping', PLANNED: 'Planned', FUNDED: 'Funded', ACTIVE: 'Active', ASSEMBLING: 'Assembling',
  DELIVERED: 'Delivered', DISPUTED: 'Disputed',
};
const STATUS_VAR = {
  DRAFT: '--st-draft', LOCKED: '--st-locked', OPEN: '--st-open', OFFERED: '--st-offered', CLAIMED: '--st-claimed',
  SUBMITTED: '--st-submitted', IN_REVIEW: '--st-review', REVISION: '--st-revision', ACCEPTED: '--st-accepted', CANCELLED: '--st-cancelled',
};
const COMMISSION_TONE = { ACCEPTED: 'good', DELIVERED: 'info', DISPUTED: 'warn', CANCELLED: '', ACTIVE: 'info', PLANNED: 'warn', SCOPING: 'warn' };

export function StatusBadge({ status, kind = 'tile' }) {
  if (kind === 'commission') return html`<span class=${`badge ${COMMISSION_TONE[status] || ''}`}>${STATUS_LABEL[status] || status}</span>`;
  const v = STATUS_VAR[status];
  return html`<span class="badge"><span class="sw" style=${{ background: v ? `var(${v})` : 'var(--line)' }}></span>${STATUS_LABEL[status] || status}</span>`;
}

const AVATAR_COLORS = ['#1f5f9e', '#13a07a', '#9b59d0', '#e2711d', '#c2410c', '#0e7490', '#4d7c0f', '#be185d', '#5b5fd6', '#a16207'];
export function Avatar({ user, size = 28 }) {
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  const bg = user.isAdmin ? '#16293f' : AVATAR_COLORS[hashString(user.id) % AVATAR_COLORS.length];
  return html`<span class="avatar" aria-hidden="true" style=${{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px`, background: bg }}>${initials}</span>`;
}

export function Money({ cents, sign }) {
  return html`<span class="num">${fmtMoney(cents, { sign })}</span>`;
}

export function Countdown({ until, now, done = 'ended' }) {
  const left = until - now;
  if (left <= 0) return html`<span class="countdown muted">${done}</span>`;
  return html`<span class="countdown">${fmtDuration(left)}</span>`;
}

export function ago(ms, now) {
  const d = now - ms;
  if (d < 60000) return 'just now';
  return `${fmtDuration(d)} ago`;
}

export function Mosaic({ tiles, big = false, label, onPick }) {
  const counts = {};
  for (const t of tiles) counts[t.status] = (counts[t.status] || 0) + 1;
  const summary = label || Object.entries(counts).map(([s, n]) => `${n} ${STATUS_LABEL[s].toLowerCase()}`).join(', ');
  return html`<div class=${`mosaic ${big ? 'big' : ''}`} role="img" aria-label=${`Tiles: ${summary}`}>
    ${tiles.map((t) => html`<span
      key=${t.id}
      class=${`tess s-${t.status} kind-${t.kind} ${['CLAIMED', 'IN_REVIEW', 'SUBMITTED'].includes(t.status) ? 'pulse' : ''}`}
      title=${`${t.title} — ${STATUS_LABEL[t.status]}`}
      onClick=${onPick ? () => onPick(t) : undefined}
      style=${onPick ? { cursor: 'pointer' } : undefined}></span>`)}
  </div>`;
}

export function Legend({ statuses = ['LOCKED', 'OPEN', 'OFFERED', 'CLAIMED', 'IN_REVIEW', 'REVISION', 'ACCEPTED'] }) {
  return html`<div class="legend" aria-hidden="true">${statuses.map((s) => html`<span><i style=${{ background: `var(${STATUS_VAR[s]})` }}></i>${STATUS_LABEL[s]}</span>`)}
    <span><i style=${{ background: 'var(--st-locked)', borderRadius: '50%' }}></i>● review · ◆ integration</span></div>`;
}

export function Tabs({ tabs, value, onChange, label = 'Sections' }) {
  return html`<div class="tabs" role="tablist" aria-label=${label}>
    ${tabs.map((t) => html`<button role="tab" id=${`tab-${t.id}`} aria-selected=${value === t.id ? 'true' : 'false'} onClick=${() => onChange(t.id)}>
      ${t.label}${t.count ? html` <span class="badge warn" style=${{ marginLeft: '.25rem' }}>${t.count}</span>` : ''}
    </button>`)}
  </div>`;
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = /** @type {HTMLElement|null} */ (ref.current);
    const first = /** @type {HTMLElement|null} */ (el && el.querySelector('input, textarea, select, button:not(.x)'));
    (first || el)?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev && /** @type {HTMLElement} */ (prev).focus && /** @type {HTMLElement} */ (prev).focus(); };
  }, []);
  return html`<div class="modal-back" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title} ref=${ref} tabindex="-1">
      <div class="modal-head"><h2>${title}</h2><button class="x" aria-label="Close" onClick=${onClose}>×</button></div>
      ${children}
    </div>
  </div>`;
}

export function Button({ busy, children, class: cls = '', ...rest }) {
  return html`<button class=${`btn ${cls}`} disabled=${busy || rest.disabled} aria-busy=${busy ? 'true' : 'false'} ...${rest}>${busy ? html`<span class="spin" aria-hidden="true"></span>` : ''}${children}</button>`;
}

/** A button that runs an async action and shows a spinner meanwhile. */
export function AsyncButton({ onClick, children, ...rest }) {
  const [busy, setBusy] = useState(false);
  return html`<${Button} busy=${busy} ...${rest} onClick=${async (e) => { setBusy(true); try { await onClick(e); } finally { setBusy(false); } }}>${children}<//>`;
}

export function Field({ label, hint, id, children }) {
  return html`<div class="field">${label ? html`<label for=${id}>${label}</label>` : ''}${children}${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
}

export function Empty({ title, children }) {
  return html`<div class="empty"><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><g fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3" opacity=".5"/><rect x="24" y="4" width="16" height="16" rx="3" opacity=".25"/><rect x="4" y="24" width="16" height="16" rx="3" opacity=".25"/><rect x="24" y="24" width="16" height="16" rx="3" opacity=".5"/></g></svg>
    <p><b>${title}</b></p>${children ? html`<div class="small" style=${{ marginTop: '.3rem' }}>${children}</div>` : ''}</div>`;
}

export function ScoreBars({ breakdown, score }) {
  if (!breakdown) return null;
  return html`<div class="bars" aria-label=${`Match score ${score ?? ''}`}>
    ${['S', 'R', 'A', 'F', 'G'].map((k) => html`<div class="b" title=${SCORE_LABELS[k]}>
      <b>${k}</b><div class="track"><div class="fill" style=${{ width: `${Math.round(breakdown[k] * 100)}%` }}></div></div><span class="num muted">${breakdown[k].toFixed(2)}</span>
    </div>`)}
  </div>`;
}

export function Markdown({ text }) {
  return html`<div class="prose" dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}></div>`;
}

export function Pipeline({ steps, current }) {
  const idx = steps.indexOf(current);
  return html`<div class="pipeline" aria-label=${`Status: ${STATUS_LABEL[current] || current}`}>
    ${steps.map((s, i) => html`${i ? html`<span class="arrow" aria-hidden="true">›</span>` : ''}<span class=${i < idx ? 'done' : i === idx ? 'now' : ''}>${STATUS_LABEL[s] || s}</span>`)}
  </div>`;
}

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => onToast((t) => {
    setItems((xs) => [...xs.slice(-3), t]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.ms);
  }), []);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${items.map((t) => html`<div class=${`toast ${t.kind}`} key=${t.id}><span>${t.message}</span><button aria-label="Dismiss" onClick=${() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>×</button></div>`)}
  </div>`;
}

export function Rate({ tile }) {
  return html`<span class="num">${fmtRate(Math.round(tile.payCents / (tile.estMinutes / 60)))}</span>`;
}

export function Logo({ size = 26 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="2" y="2" width="13" height="13" rx="3" fill="#4aa3df"/><rect x="17" y="2" width="13" height="13" rx="3" fill="#13a07a"/>
    <rect x="2" y="17" width="13" height="13" rx="3" fill="#e0a100"/><rect x="17" y="17" width="13" height="13" rx="3" fill="#9b59d0"/></svg>`;
}

export function UserName({ user, org = true }) {
  if (!user) return html`<span class="muted">—</span>`;
  return html`<span class="row" style=${{ gap: '.4rem', display: 'inline-flex' }}><${Avatar} user=${user} size=${22} /><span>${user.name}${org && user.org ? html` <span class="muted small">· ${user.org}</span>` : ''}</span></span>`;
}
