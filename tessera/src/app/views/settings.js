// Settings: the platform model, the crowd simulation, the clock, appearance, and the
// demo world itself (export, import, reset).
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, act, toast, downloadText } from '../state.js';
import { Field, AsyncButton } from '../ui.js';
import { ANTHROPIC_MODELS, MODEL_PRICES } from '../../llm/prices.js';
import { runAgent } from '../../llm/run-agent.js';
import { bytesToBase64, base64ToBytes, DAY, HOUR } from '../../lib/util.js';
import { WORLD_VERSION } from '../../db/schema.js';
import { startGuidedDemo } from './home.js';
import { swarmSettings } from '../../services/swarm.js';
import { config } from '../../domain/config.js';

const PING = { name: 'ping', format: 'text', prompt: { version: 'ping.v1', system: 'You are a connectivity check. Reply with the single word OK.', render: () => 'Reply with OK.' } };

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

export function SettingsView() {
  const T = useT();
  useDbVersion();
  const s = T.db.meta.settings;
  const llm = s.llm;
  const [key, setKey] = useState('');
  const [okey, setOkey] = useState('');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('tessera.theme') || 'system'; } catch { return 'system'; } });
  const setLlm = (patch) => { T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, ...patch } } })); T.llm.clearCache(); };
  const setSettings = (patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, ...patch } }));
  const hasKey = T.secrets.has('platform.anthropic');
  const test = async () => {
    const route = T.llm.platform('light');
    const r = await act(() => runAgent({ agent: PING, input: {}, route, log: T.log, retries: 0, maxTokens: 20 }));
    if (r) toast(`${route.label} answered: “${String(r.output).slice(0, 40)}”`, 'ok');
  };
  const human = T.db.meta.humanPersonaIds || [];

  const exportWorld = async () => {
    const world = T.db.snapshot();
    const files = {};
    for (const k of await T.blobs.keys()) { const b = await T.blobs.get(k); if (b) files[k] = bytesToBase64(b); }
    downloadText(JSON.stringify({ kind: 'tessera.world', version: WORLD_VERSION, exportedAt: new Date().toISOString(), world, files }), `tessera-world-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('Exported. API keys are never included.', 'ok');
  };
  const importWorld = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await act(async () => {
      const data = JSON.parse(await f.text());
      if (data.kind !== 'tessera.world' || data.version !== WORLD_VERSION) throw new Error('That isn’t a Tessera world export from this version.');
      await T.stores.worldStore.save(data.world);
      await T.blobs.clear();
      for (const [k, v] of Object.entries(data.files || {})) await T.blobs.put(k, base64ToBytes(v));
      location.reload();
    });
  };
  const reset = async () => {
    if (!confirm('Reset the demo? Everything you did in this browser is erased and the seed is rebuilt. Your API keys stay.')) return;
    T.worker.stop();
    await T.stores.worldStore.clear();
    await T.blobs.clear();
    location.reload();
  };

  return html`<div class="stack">
    <div class="page-head"><div><h1>Settings</h1><p class="sub">These apply to this browser only.</p></div></div>
    <div class="card stack">
      <h2>Platform model</h2>
      <p class="small muted">Runs the platform agents: Scoping, Decomposer, Matcher notes, Reviewer and Assembler. Contributors on the shared model use it for briefs too.</p>
      <div class="choices" role="radiogroup" aria-label="Platform model provider">
        ${[['mock', 'Deterministic mock', 'No key, no network, instant. Good for trying the whole loop.'], ['anthropic', 'Claude', 'Real agents on the Anthropic API with your key.'], ['openai', 'OpenAI-compatible', 'Ollama, OpenRouter or a gateway.']].map(([v, l, d]) => html`
          <label class="choice"><input type="radio" name="provider" checked=${llm.provider === v} onChange=${() => setLlm({ provider: v })} /><span><b>${l}</b><span>${d}</span></span></label>`)}
      </div>
      ${llm.provider === 'anthropic' ? html`<div class="stack-sm">
        <div class="inline-fields">
          <${Field} label="Heavy model" id="heavy" hint="Scoping, Decomposer, Assembler, and Reviewer escalations"><select id="heavy" value=${llm.heavyModel} onChange=${(e) => setLlm({ heavyModel: e.target.value })}>${ANTHROPIC_MODELS.map((m) => html`<option value=${m}>${MODEL_PRICES[m].label}</option>`)}</select><//>
          <${Field} label="Light model" id="light" hint="Reviewer first pass and Matcher notes"><select id="light" value=${llm.lightModel} onChange=${(e) => setLlm({ lightModel: e.target.value })}>${ANTHROPIC_MODELS.map((m) => html`<option value=${m}>${MODEL_PRICES[m].label}</option>`)}</select><//>
        </div>
        <${Field} label=${hasKey ? 'Anthropic API key (saved in this browser)' : 'Anthropic API key'} id="pkey" hint="Stored only in this browser’s localStorage and sent only to api.anthropic.com. It is never written to the Tessera database or included in exports. Create one at console.anthropic.com.">
          <div class="row"><input id="pkey" type="password" autocomplete="off" placeholder=${hasKey ? '••••••••••••' : 'sk-ant-…'} value=${key} onInput=${(e) => setKey(e.target.value)} style=${{ flex: 1, width: 'auto' }} />
            <button class="btn small" onClick=${() => { if (!/^sk-ant-/.test(key)) { toast('Anthropic keys start with sk-ant-.', 'err'); return; } T.secrets.set('platform.anthropic', key); T.llm.clearCache(); setKey(''); toast('Key saved in this browser.', 'ok'); }}>Save key</button>
            ${hasKey ? html`<button class="btn small danger" onClick=${() => { T.secrets.remove('platform.anthropic'); T.llm.clearCache(); toast('Key removed.', 'ok'); }}>Remove</button>` : ''}</div><//>
        ${!hasKey ? html`<p class="small" style=${{ color: 'var(--warn)' }}>Without a key the platform keeps using the mock.</p>` : ''}
        <p class="small muted">Platform calls are rate-limited to ${config.limits.llmCallsPerWindow} per 10 minutes as a safety net, and the agent swarm has its own ${config.limits.swarmCallsPerWindow}. Everything is logged under Admin → Agent runs with its cost.</p>
      </div>` : ''}
      ${llm.provider === 'openai' ? html`<div class="inline-fields">
        <${Field} label="Base URL" id="obase"><input id="obase" type="url" value=${llm.openai.baseUrl} onInput=${(e) => setLlm({ openai: { ...llm.openai, baseUrl: e.target.value } })} /><//>
        <${Field} label="Model" id="omodel"><input id="omodel" type="text" value=${llm.openai.model} onInput=${(e) => setLlm({ openai: { ...llm.openai, model: e.target.value } })} /><//>
        <${Field} label="Key (optional)" id="okey"><div class="row"><input id="okey" type="password" value=${okey} onInput=${(e) => setOkey(e.target.value)} style=${{ flex: 1, width: 'auto' }} /><button class="btn small" onClick=${() => { T.secrets.set('platform.openai', okey); T.llm.clearCache(); setOkey(''); toast('Saved in this browser.', 'ok'); }}>Save</button></div><//>
      </div>` : ''}
      <div><${AsyncButton} onClick=${test}>Test the connection<//></div>
    </div>
    <${SwarmSettings} />
    <div class="grid-2">
      <div class="card stack-sm">
        <h2>Crowd simulation</h2>
        <label class="choice"><input type="checkbox" checked=${!!s.crowd} onChange=${(e) => setSettings({ crowd: e.target.checked })} /><span><b>Other contributors act on their own</b><span>They accept offers, submit sample work, review each other and vote on panels after a short delay. Personas you’ve played are left alone.</span></span></label>
        <${Field} label=${`Weak first attempts: ${Math.round((s.crowdFailRate ?? 0.12) * 100)}%`} id="fail" hint="Share of simulated first submissions that fail review, to show the revision loop."><input id="fail" type="range" min="0" max="0.5" step="0.02" value=${s.crowdFailRate ?? 0.12} onInput=${(e) => setSettings({ crowdFailRate: Number(e.target.value) })} /><//>
        ${human.length ? html`<div><div class="label">Personas you control</div><div class="row" style=${{ marginTop: '.3rem' }}>${human.map((id) => html`<span class="badge">${T.db.get('User', id)?.name}</span>`)}
          <button class="btn small" onClick=${() => { T.db.tx((tx) => tx.setMeta({ humanPersonaIds: tx.meta.activePersonaId ? [tx.meta.activePersonaId] : [] })); toast('Handed back to the crowd.', 'ok'); }}>Hand the others back to the crowd</button></div></div>` : ''}
      </div>
      <div class="card stack-sm">
        <h2>Clock</h2>
        <p class="small">Simulated time: <b>${new Date(T.clock.now()).toLocaleString()}</b>${T.clock.state().mode === 'frozen' ? ' (paused)' : ''}</p>
        <div class="row">${[[HOUR, '1 hour'], [DAY, '1 day'], [7 * DAY + 60000, '7 days']].map(([ms, l]) => html`<button class="btn small" onClick=${async () => { T.clock.advance(ms); await T.worker.tick(); toast(`Forward ${l}.`, 'ok'); }}>+${l}</button>`)}
          <button class="btn small" onClick=${() => { T.clock.run(0); toast('Back to real time.', 'ok'); }}>Real time</button></div>
        <h2 style=${{ marginTop: '1rem' }}>Appearance</h2>
        <div class="row">${['system', 'light', 'dark'].map((t) => html`<label class="choice" style=${{ padding: '.35rem .6rem' }}><input type="radio" name="theme" checked=${theme === t} onChange=${() => { setTheme(t); try { localStorage.setItem('tessera.theme', t); } catch { /* ignore */ } applyTheme(t); }} /><span><b>${t[0].toUpperCase() + t.slice(1)}</b></span></label>`)}</div>
      </div>
    </div>
    <div class="card stack-sm">
      <h2>Your demo world</h2>
      <p class="small">Everything lives in this browser (IndexedDB). Export it to keep it or hand it to someone; API keys are never included.</p>
      <div class="row">
        <button class="btn" onClick=${exportWorld}>Export world</button>
        <label class="btn">Import world<input type="file" accept="application/json,.json" class="sr-only" onChange=${importWorld} /></label>
        <button class="btn" onClick=${() => startGuidedDemo(T)}>Restart the guided demo</button>
        <button class="btn danger" onClick=${reset}>Reset the demo</button>
      </div>
      <p class="tiny muted">Storage: ${T.stores.worldStore.kind}${T.stores.worldStore.kind === 'memory' ? ' (this browser blocked IndexedDB, so nothing persists after you close the tab)' : ''}.</p>
    </div>
  </div>`;
}

function SwarmSettings() {
  const T = useT();
  const sw = swarmSettings(T.db);
  const llm = T.db.meta.settings.llm;
  const set = (patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, swarm: { ...(tx.meta.settings.swarm || {}), ...patch } } }));
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
  const label = (id) => MODEL_PRICES[id]?.label || id;
  return html`<div class="card stack-sm">
    <h2>Agent swarm</h2>
    <p class="small muted">The AI agents that do every step of a job you <a href="#/swarm">hand to the swarm</a>. They use the platform model above; with the mock they hand in placeholder files.</p>
    <div class="inline-fields">
      <${Field} label="Worker model" id="sw-tier" hint="The model each agent works with. The Reviewer still starts light and escalates."><select id="sw-tier" value=${sw.workerTier} onChange=${(e) => set({ workerTier: e.target.value })}>
        <option value="heavy">Heavy (${llm.provider === 'anthropic' ? label(llm.heavyModel) : 'platform heavy'})</option>
        <option value="light">Light (${llm.provider === 'anthropic' ? label(llm.lightModel) : 'platform light'}), cheaper</option>
      </select><//>
      <${Field} label="Agents working at once" id="sw-conc" hint="1 to 8. More is faster and spends faster."><input id="sw-conc" type="number" min="1" max="8" value=${sw.concurrency} onChange=${(e) => set({ concurrency: num(e.target.value, 1, 8) })} /><//>
      <${Field} label="Spend cap per job (USD)" id="sw-cap" hint="The swarm pauses a job when its model spend reaches this. 0 means no cap."><input id="sw-cap" type="number" min="0" step="1" value=${sw.spendCapUsd} onChange=${(e) => set({ spendCapUsd: Math.max(0, Number(e.target.value) || 0) })} /><//>
      <${Field} label="Agents in the swarm" id="sw-size" hint="How many agent accounts share the work (2 to 24)."><input id="sw-size" type="number" min="2" max="24" value=${sw.size} onChange=${(e) => set({ size: num(e.target.value, 2, 24) })} /><//>
    </div>
  </div>`;
}
