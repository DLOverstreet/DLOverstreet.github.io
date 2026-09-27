// Posting a commission.
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, navigate, currentUser, setPersona, act } from '../state.js';
import { Field, AsyncButton } from '../ui.js';
import { SAMPLE_COMMISSIONS } from '../../services/seed.js';
import { DAY, fmtBytes } from '../../lib/util.js';

const EXAMPLES = {
  flyer: { label: 'Library flyer in Spanish', ...SAMPLE_COMMISSIONS.flyer },
  dashboard: { label: 'Eviction dashboard', ...SAMPLE_COMMISSIONS.dashboard },
  survey: { label: 'Survey coding (restricted)', ...SAMPLE_COMMISSIONS.survey },
  review: { label: 'Literature review', title: 'Literature review: right to counsel and eviction outcomes', goal: 'A literature review of the evidence on right-to-counsel programs and eviction outcomes in US cities since 2010, for our policy committee. We need the search protocol, screening, a data extraction table and a synthesis of findings with references.', budgetCents: 150000, days: 20, privacy: 'PUBLIC' },
  site: { label: 'Food pantry page', title: 'One-page website for the Eastside food pantry', goal: 'A one-page website for our food pantry with hours, what to bring, how to get help in an emergency, and a volunteer sign-up link. It must be readable on a phone and meet accessibility basics.', budgetCents: 80000, days: 12, privacy: 'PUBLIC' },
};

function toLocalInput(ms) {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function PostCommission({ example }) {
  const T = useT();
  useDbVersion();
  const me = currentUser(T);
  const now = T.clock.now();
  const start = EXAMPLES[example];
  const [form, setForm] = useState(() => ({
    title: start?.title || '', goal: start?.goal || '', budget: start ? String(start.budgetCents / 100) : '',
    deadline: toLocalInput(now + (start?.days || 14) * DAY), privacy: start?.privacy || 'PUBLIC', language: 'en',
  }));
  const [files, setFiles] = useState([]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (!me.isRequester) {
    const reqs = T.db.filter('User', (u) => u.isRequester);
    return html`<div><div class="page-head"><div><h1>Post a commission</h1></div></div>
      <div class="card warn"><p>Only requesters post commissions. Switch to one of them:</p>
      <div class="row" style=${{ marginTop: '.6rem' }}>${reqs.map((u) => html`<button class="btn" onClick=${() => setPersona(T, u.id)}>Be ${u.name} (${u.org})</button>`)}</div></div></div>`;
  }

  const useExample = (k) => {
    const e = EXAMPLES[k];
    setForm({ ...form, title: e.title, goal: e.goal, budget: String(e.budgetCents / 100), privacy: e.privacy, deadline: toLocalInput(T.clock.now() + e.days * DAY) });
  };

  const onFiles = async (e) => {
    const list = [...e.target.files];
    const read = await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    setFiles([...files, ...read]);
    e.target.value = '';
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    const c = await act(() => T.api.postCommission(me.id, {
      title: form.title, goal: form.goal, budgetCents: Math.round(Number(form.budget) * 100),
      deadline: new Date(form.deadline).getTime(), privacy: form.privacy, language: form.language, files,
    }), 'Posted. The Scoping agent is reading it now.');
    if (c) {
      // The guided demo follows the first commission you post (or a new one once that one is finished).
      const g = T.db.meta.guide || {};
      const prev = g.commissionId && T.db.get('Commission', g.commissionId);
      if (!prev || ['ACCEPTED', 'CANCELLED'].includes(prev.status)) T.db.tx((tx) => tx.setMeta({ guide: { ...g, commissionId: c.id } }));
      navigate(`#/c/${c.id}`);
    }
  };

  return html`<form onSubmit=${submit}>
    <div class="page-head"><div><h1>Post a commission</h1><p class="sub">Describe the whole job in plain language. Tessera will ask a few questions, then split it into tiles and price them.</p></div></div>
    <div class="card" style=${{ marginBottom: '1rem' }}>
      <div class="row"><span class="small muted">Start from an example:</span>${Object.entries(EXAMPLES).map(([k, e]) => html`<button type="button" class="btn small" onClick=${() => useExample(k)}>${e.label}</button>`)}</div>
    </div>
    <div class="split">
      <div class="card stack">
        <${Field} label="Title" id="c-title"><input id="c-title" type="text" value=${form.title} onInput=${set('title')} maxlength="120" required placeholder="e.g. Spanish version of our library card flyer" /><//>
        <${Field} label="Goal" id="c-goal" hint="What should exist when this is done, who it’s for, and anything contributors must know. Goals and files are treated as data, never as instructions to the agents."><textarea id="c-goal" rows="7" value=${form.goal} onInput=${set('goal')} required></textarea><//>
        <div class="inline-fields">
          <${Field} label="Budget (USD)" id="c-budget" hint="A cap. Tiles are priced by formula; unused escrow is refunded."><input id="c-budget" type="number" min="50" step="1" value=${form.budget} onInput=${set('budget')} required /><//>
          <${Field} label="Deadline" id="c-deadline" hint="Under 72 hours adds a 25% rush premium."><input id="c-deadline" type="datetime-local" value=${form.deadline} onInput=${set('deadline')} required /><//>
          <${Field} label="Working language" id="c-lang"><select id="c-lang" value=${form.language} onChange=${set('language')}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option></select><//>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="label" id="privacy-label" style=${{ marginBottom: '.5rem' }}>Privacy</div>
          <div class="stack-sm" role="radiogroup" aria-labelledby="privacy-label">
            ${[['PUBLIC', 'Public', 'Contributors can see the commission’s title and goal.'], ['NEED_TO_KNOW', 'Need-to-know', 'Each contributor sees only their tile’s spec and inputs.'], ['RESTRICTED', 'Restricted', 'Need-to-know, and personal data is redacted before it reaches a tile or a model.']].map(([v, l, d]) => html`
              <label class="choice"><input type="radio" name="privacy" value=${v} checked=${form.privacy === v} onChange=${set('privacy')} /><span><b>${l}</b><span>${d}</span></span></label>`)}
          </div>
        </div>
        <div class="card">
          <${Field} label="Source files (optional)" id="c-files" hint="CSV, text, Markdown or JSON are summarized for the agents (redacted if restricted). Up to 5 MB each."><input id="c-files" type="file" multiple onChange=${onFiles} /><//>
          ${files.length ? html`<ul class="filelist">${files.map((f, i) => html`<li><span class="name">${f.name}</span><span class="muted small">${fmtBytes(f.bytes.length)}</span><button type="button" class="btn small ghost" aria-label=${`Remove ${f.name}`} onClick=${() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></li>`)}</ul>` : ''}
        </div>
        <${AsyncButton} class="primary" type="button" onClick=${submit}>Post commission<//>
        <p class="small muted">Posting starts scoping. You’ll approve the plan and its price before any money moves.</p>
      </div>
    </div>
  </form>`;
}
