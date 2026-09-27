// Contributor onboarding and profile: skills, languages, tools, availability, cap,
// pay floor, the model that writes your briefs, and brief style.
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, currentUser, act, toast } from '../state.js';
import { Field, AsyncButton } from '../ui.js';
import { skillVocabulary, config } from '../../domain/config.js';
import { DAY_NAMES, weeklyWindowHours } from '../../domain/availability.js';
import { ANTHROPIC_MODELS, MODEL_PRICES } from '../../llm/prices.js';
import { fmtRate } from '../../lib/util.js';

const ZONES = ['America/Phoenix', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'Europe/London', 'Europe/Rome', 'Africa/Accra', 'Asia/Kolkata', 'Asia/Seoul', 'UTC'];
const LANGS = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', zh: 'Chinese', ko: 'Korean', hi: 'Hindi', ru: 'Russian', pt: 'Portuguese' };

function Chips({ values, onChange, placeholder, options, label }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x && !values.includes(x)) onChange([...values, x]); setV(''); };
  return html`<div>
    <div class="tags" style=${{ marginBottom: '.4rem' }}>${values.map((x) => html`<span class="tag">${options?.[x] || x} <button aria-label=${`Remove ${x}`} style=${{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }} onClick=${() => onChange(values.filter((y) => y !== x))}>×</button></span>`)}</div>
    <div class="row"><input type="text" aria-label=${label} placeholder=${placeholder} value=${v} onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style=${{ flex: 1, width: 'auto' }} list=${options ? undefined : undefined} /><button class="btn small" onClick=${add}>Add</button></div>
  </div>`;
}

export function ProfileView() {
  const T = useT();
  useDbVersion();
  const me = currentUser(T);
  const existing = T.db.find('ContributorProfile', (p) => p.userId === me.id);
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(existing || {
    skills: [{ tag: 'research', selfLevel: 3 }], languages: ['en'], tools: [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    availability: [1, 2, 3, 4, 5].map((day) => ({ day, start: '18:00', end: '21:00' })), weeklyHoursCap: 10, payFloorCents: 2500,
    llmMode: 'SHARED', briefStyle: 'STEP_BY_STEP', llm: { provider: 'anthropic' },
  })));
  const [key, setKey] = useState('');
  const set = (patch) => setP({ ...p, ...patch });
  const llm = p.llm || { provider: 'anthropic' };
  const setLlm = (patch) => set({ llm: { ...llm, ...patch } });
  const keyName = `user.${me.id}.${llm.provider || 'anthropic'}`;
  const hasKey = T.secrets.has(keyName);
  const save = () => act(() => T.api.updateProfile(me.id, { ...p, payFloorCents: Math.round(Number(p.payFloorCents)), weeklyHoursCap: Math.round(Number(p.weeklyHoursCap)) }), 'Profile saved. The Matcher uses it from the next tile that opens.');

  return html`<div class="stack">
    <div class="page-head"><div><h1>${existing ? 'Your profile' : 'Become a contributor'}</h1><p class="sub">The Matcher uses this to decide what you’re offered. Nothing here changes what a tile pays.</p></div><${AsyncButton} class="primary" onClick=${save}>Save profile<//></div>
    <div class="grid-2">
      <div class="card stack">
        <h2>Skills</h2>
        <p class="small muted">Rate yourself 1 (learning) to 5 (expert). Self-ratings count toward your match score; reputation from accepted work counts too.</p>
        ${p.skills.map((s, i) => html`<div class="row">
          <input type="text" aria-label="Skill tag" value=${s.tag} list="skill-vocab" onInput=${(e) => set({ skills: p.skills.map((x, j) => (j === i ? { ...x, tag: e.target.value.trim().toLowerCase().replace(/\s+/g, '-') } : x)) })} style=${{ flex: 1, width: 'auto' }} />
          <select aria-label=${`Level for ${s.tag}`} value=${s.selfLevel} onChange=${(e) => set({ skills: p.skills.map((x, j) => (j === i ? { ...x, selfLevel: Number(e.target.value) } : x)) })} style=${{ width: 'auto' }}>${[1, 2, 3, 4, 5].map((l) => html`<option value=${l}>${l}</option>`)}</select>
          <button class="btn small ghost" aria-label=${`Remove ${s.tag}`} onClick=${() => set({ skills: p.skills.filter((_, j) => j !== i) })}>×</button>
        </div>`)}
        <datalist id="skill-vocab">${skillVocabulary.map((s) => html`<option value=${s} />`)}</datalist>
        <div><button class="btn small" onClick=${() => set({ skills: [...p.skills, { tag: '', selfLevel: 3 }] })}>Add a skill</button></div>
        <${Field} label="Working languages"><${Chips} label="Add a language code" values=${p.languages} options=${LANGS} placeholder="Two-letter code, e.g. es" onChange=${(languages) => set({ languages })} /><//>
        <${Field} label="Tools you have" hint="Briefs give setup steps for these."><${Chips} label="Add a tool" values=${p.tools} placeholder="e.g. excel, vscode, figma" onChange=${(tools) => set({ tools })} /><//>
      </div>
      <div class="card stack">
        <h2>Time and pay</h2>
        <div class="inline-fields">
          <${Field} label="Pay floor ($/hour)" id="floor" hint=${`A hard filter: you’re never offered a tile below it. The platform floor is ${fmtRate(config.platformFloorCents)}.`}>
            <input id="floor" type="number" min="0" step="1" value=${p.payFloorCents / 100} onInput=${(e) => set({ payFloorCents: Math.round(Number(e.target.value) * 100) })} /><//>
          <${Field} label="Weekly hours cap" id="cap"><input id="cap" type="number" min="1" max="60" value=${p.weeklyHoursCap} onInput=${(e) => set({ weeklyHoursCap: Number(e.target.value) })} /><//>
          <${Field} label="Time zone" id="tz"><select id="tz" value=${p.timezone} onChange=${(e) => set({ timezone: e.target.value })}>${[...new Set([p.timezone, ...ZONES])].map((z) => html`<option>${z}</option>`)}</select><//>
        </div>
        <div>
          <div class="label">Weekly availability <span class="muted small">(${weeklyWindowHours(p.availability)} h a week)</span></div>
          ${p.availability.map((w, i) => html`<div class="row" style=${{ marginTop: '.35rem' }}>
            <select aria-label="Day" value=${w.day} onChange=${(e) => set({ availability: p.availability.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })} style=${{ width: 'auto' }}>${DAY_NAMES.map((d, k) => html`<option value=${k}>${d}</option>`)}</select>
            <input type="text" aria-label="Start time" value=${w.start} pattern="\\d{2}:\\d{2}" onInput=${(e) => set({ availability: p.availability.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} style=${{ width: '5.5rem' }} />
            <span>to</span>
            <input type="text" aria-label="End time" value=${w.end} pattern="\\d{2}:\\d{2}" onInput=${(e) => set({ availability: p.availability.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} style=${{ width: '5.5rem' }} />
            <button class="btn small ghost" aria-label="Remove window" onClick=${() => set({ availability: p.availability.filter((_, j) => j !== i) })}>×</button>
          </div>`)}
          <button class="btn small" style=${{ marginTop: '.4rem' }} onClick=${() => set({ availability: [...p.availability, { day: 6, start: '10:00', end: '12:00' }] })}>Add a window</button>
        </div>
      </div>
    </div>
    <div class="card stack">
      <h2>Your model</h2>
      <p class="small muted">Your model writes your briefs and powers the tile copilot. Platform agents (Decomposer, Reviewer…) use the platform model in <a href="#/settings">Settings</a>.</p>
      <div class="choices" role="radiogroup" aria-label="Model mode">
        ${[['SHARED', 'Shared platform model', 'Uses whatever the platform runs (the mock by default).'], ['OWN_KEY', 'My own API key', 'Claude or any OpenAI-compatible service, billed to you.'], ['OLLAMA', 'Ollama on this computer', 'A local model; nothing leaves your machine.']].map(([v, l, d]) => html`
          <label class="choice"><input type="radio" name="llmMode" checked=${p.llmMode === v} onChange=${() => set({ llmMode: v })} /><span><b>${l}</b><span>${d}</span></span></label>`)}
      </div>
      ${p.llmMode === 'OWN_KEY' ? html`<div class="inline-fields">
        <${Field} label="Provider" id="prov"><select id="prov" value=${llm.provider} onChange=${(e) => setLlm({ provider: e.target.value })}><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI-compatible</option></select><//>
        ${llm.provider === 'anthropic' ? html`<${Field} label="Model" id="model"><select id="model" value=${llm.model || 'claude-sonnet-5'} onChange=${(e) => setLlm({ model: e.target.value })}>${ANTHROPIC_MODELS.map((m) => html`<option value=${m}>${MODEL_PRICES[m].label} ($${MODEL_PRICES[m].in}/$${MODEL_PRICES[m].out} per M tokens)</option>`)}</select><//>`
          : html`<${Field} label="Base URL" id="burl"><input id="burl" type="url" value=${llm.baseUrl || ''} placeholder="https://openrouter.ai/api/v1" onInput=${(e) => setLlm({ baseUrl: e.target.value })} /><//><${Field} label="Model" id="omodel"><input id="omodel" type="text" value=${llm.model || ''} onInput=${(e) => setLlm({ model: e.target.value })} /><//>`}
        <${Field} label=${hasKey ? 'API key (saved in this browser)' : 'API key'} id="ukey" hint="Stored only in this browser’s localStorage, never in the Tessera database or its exports, and sent only to the provider.">
          <div class="row"><input id="ukey" type="password" autocomplete="off" value=${key} placeholder=${hasKey ? '••••••••••••' : llm.provider === 'anthropic' ? 'sk-ant-…' : 'key'} onInput=${(e) => setKey(e.target.value)} style=${{ flex: 1, width: 'auto' }} />
          <button class="btn small" onClick=${() => { if (!key) return; if (llm.provider === 'anthropic' && !/^sk-ant-/.test(key)) { toast('Anthropic keys start with sk-ant-.', 'err'); return; } T.secrets.set(keyName, key); T.llm.clearCache(); setKey(''); toast('Key saved in this browser only.', 'ok'); }}>Save key</button>
          ${hasKey ? html`<button class="btn small danger" onClick=${() => { T.secrets.remove(keyName); T.llm.clearCache(); toast('Key removed.', 'ok'); }}>Remove</button>` : ''}</div><//>
      </div>` : ''}
      ${p.llmMode === 'OLLAMA' ? html`<div class="inline-fields">
        <${Field} label="Ollama URL" id="ourl"><input id="ourl" type="url" value=${llm.ollamaUrl || 'http://localhost:11434/v1'} onInput=${(e) => setLlm({ ollamaUrl: e.target.value })} /><//>
        <${Field} label="Model" id="omod"><input id="omod" type="text" value=${llm.ollamaModel || 'llama3.1'} onInput=${(e) => setLlm({ ollamaModel: e.target.value })} /><//>
      </div>
      <p class="small callout">Ollama must allow this site: start it with <code>OLLAMA_ORIGINS=${location.origin} ollama serve</code>. If it can’t be reached, the shared model writes your brief and says so.</p>` : ''}
      <div class="inline-fields">
        <${Field} label="Brief style" id="style"><select id="style" value=${p.briefStyle} onChange=${(e) => set({ briefStyle: e.target.value })}><option value="CONCISE">Concise</option><option value="STEP_BY_STEP">Step by step</option><option value="TEACH_ME">Teach me</option></select><//>
        <${Field} label="Brief language" id="blang"><select id="blang" value=${p.briefLanguage || p.languages[0]} onChange=${(e) => set({ briefLanguage: e.target.value })}>${p.languages.map((l) => html`<option value=${l}>${LANGS[l] || l}</option>`)}</select><//>
      </div>
    </div>
    <div><${AsyncButton} class="primary" onClick=${save}>Save profile<//></div>
  </div>`;
}
