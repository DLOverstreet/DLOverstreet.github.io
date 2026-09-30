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
import { FREE_PROVIDERS } from '../../llm/free-chain.js';
import { createOpenAiCompatibleProvider } from '../../llm/openai-compatible.js';

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
    <${FreeModels} />
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

/** Free model providers tried before Claude: which ones, their models and keys, and what they may do. */
function FreeModels() {
  const T = useT();
  useDbVersion();
  const llm = T.db.meta.settings.llm;
  const free = llm.free || { providers: [], light: false };
  const sw = swarmSettings(T.db);
  const [keys, setKeys] = useState({});
  const [lists, setLists] = useState({});
  const save = (patch) => { T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, llm: { ...tx.meta.settings.llm, free: { ...(tx.meta.settings.llm.free || { providers: [] }), ...patch } } } })); T.llm.clearCache(); };
  const setSwarm = (patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, swarm: { ...(tx.meta.settings.swarm || {}), ...patch } } }));
  const row = (id) => free.providers.find((p) => p.id === id) || { id, on: false, model: FREE_PROVIDERS[id].model };
  const setRow = (id, patch) => save({ providers: [...Object.keys(FREE_PROVIDERS).map((k) => (k === id ? { ...row(k), ...patch } : row(k)))] });
  const listModels = async (id) => {
    const def = FREE_PROVIDERS[id];
    const p = createOpenAiCompatibleProvider({ baseUrl: row(id).baseUrl || def.baseUrl, apiKey: T.secrets.get(`free.${id}`) || '' });
    const names = await act(() => p.models());
    if (names) { setLists({ ...lists, [id]: names }); toast(`${def.label}: ${names.length} models. Pick one below.`, 'ok'); }
  };
  const ready = T.llm.freeReady();
  return html`<div class="card stack-sm">
    <h2>Free models first</h2>
    <p class="small muted">Claude has no free API tier, but Google, Groq and OpenRouter have free developer tiers, and Ollama runs models on your own computer for nothing. Set any of them up here and the cheap work tries them before Claude: the call goes to Claude only when a free model is out of requests, can’t be reached, or gives an answer that doesn’t hold up. Planning, supervising and assembling always stay on Claude. Free calls show in Admin → Agent runs at $0, beside what Claude would have cost.</p>
    <p class="small" style=${{ color: 'var(--warn)' }}>Privacy: the cloud free tiers may keep or learn from what you send (Google says its free tier does). Only jobs marked <b>Public</b> go to them. Mark an unpublished manuscript or anything confidential <b>Need to know</b> or <b>Restricted</b> when you post it, and only Claude, or Ollama on your own computer, will see it.</p>
    ${Object.entries(FREE_PROVIDERS).map(([id, def]) => {
      const r = row(id);
      const hasKey = T.secrets.has(`free.${id}`);
      return html`<div class="stack-sm" style=${{ borderTop: '1px solid var(--line)', paddingTop: '.6rem' }}>
        <label class="choice"><input type="checkbox" checked=${!!r.on} onChange=${(e) => setRow(id, { on: e.target.checked })} /><span><b>${def.label}</b><span>${def.limits} ${def.privacy}</span></span></label>
        ${r.on ? html`<div class="inline-fields">
          <${Field} label="Model" id=${`free-model-${id}`} hint=${lists[id] ? `${lists[id].length} available${id === 'openrouter' ? '; free ones end in :free' : ''}.` : 'List the models to see what your key can use.'}>
            ${lists[id] ? html`<select id=${`free-model-${id}`} value=${r.model} onChange=${(e) => setRow(id, { model: e.target.value })}>${[r.model, ...lists[id].filter((m) => m !== r.model && (id !== 'openrouter' || /:free$/.test(m)))].filter(Boolean).map((m) => html`<option value=${m} selected=${m === r.model}>${m}</option>`)}</select>`
              : html`<input id=${`free-model-${id}`} type="text" value=${r.model} onChange=${(e) => setRow(id, { model: e.target.value.trim() })} />`}<//>
          ${def.local ? html`<${Field} label="Address" id=${`free-url-${id}`}><input id=${`free-url-${id}`} type="url" value=${r.baseUrl || def.baseUrl} onChange=${(e) => setRow(id, { baseUrl: e.target.value.trim() })} /><//>`
            : html`<${Field} label=${hasKey ? 'Key (saved in this browser)' : 'Key'} id=${`free-key-${id}`} hint=${def.keyHint}><div class="row"><input id=${`free-key-${id}`} type="password" autocomplete="off" placeholder=${hasKey ? '••••••••' : ''} value=${keys[id] || ''} onInput=${(e) => setKeys({ ...keys, [id]: e.target.value })} style=${{ flex: 1, width: 'auto' }} />
              <button class="btn small" onClick=${() => { if (!keys[id]) return; T.secrets.set(`free.${id}`, keys[id].trim()); T.llm.clearCache(); setKeys({ ...keys, [id]: '' }); toast('Key saved in this browser.', 'ok'); }}>Save</button>
              ${hasKey ? html`<button class="btn small danger" onClick=${() => { T.secrets.remove(`free.${id}`); T.llm.clearCache(); toast('Key removed.', 'ok'); }}>Remove</button>` : ''}</div><//>`}
          <div class="field"><label> </label><${AsyncButton} onClick=${() => listModels(id)}>List models<//></div>
        </div>` : ''}
      </div>`;
    })}
    <div style=${{ borderTop: '1px solid var(--line)', paddingTop: '.6rem' }} class="stack-sm">
      <div class="label">What the free models do</div>
      <label class="choice"><input type="checkbox" checked=${!!free.light} onChange=${(e) => save({ light: e.target.checked })} /><span><b>Light work</b><span>Reviewer first passes (Claude takes over when it isn’t confident), matcher notes, the autopilot’s scoping answers and the lessons written after each task.</span></span></label>
      <label class="choice"><input type="checkbox" checked=${sw.challenger === 'free'} onChange=${(e) => setSwarm({ challenger: e.target.checked ? 'free' : 'off' })} /><span><b>A free-model challenger in every competition</b><span>One of the competing workers on each task uses the free models. It is scored like the rest, so you see where a free model is good enough; when it wins, the task cost almost nothing.</span></span></label>
      <label class="choice"><input type="checkbox" checked=${!!sw.freeSolo} onChange=${(e) => setSwarm({ freeSolo: e.target.checked })} /><span><b>Agents working alone</b><span>When competition is off (or a config works alone), the agent tries the free models first; the Reviewer still checks the work.</span></span></label>
      ${!ready ? html`<p class="tiny muted">No free provider is ready yet: switch one on and give it a model${Object.values(FREE_PROVIDERS).some((d) => !d.local) ? ' and a key' : ''}. Until then everything runs on Claude as before.</p>` : ''}
    </div>
  </div>`;
}

/** One click to the cheaper or the standard way of running the swarm. */
const PRESETS = {
  economy: { competitors: 2, finalists: 2, exchange: 'notes', reveal: 'auto', cheaperClones: true, workerEffort: 'low', checkEffort: 'low', wire: true },
  standard: { competitors: 3, finalists: 0, exchange: 'notes', reveal: 'auto', cheaperClones: true, workerEffort: 'medium', checkEffort: 'medium', wire: true, challenger: 'off', batch: false, freeSolo: false },
};

function SwarmSettings() {
  const T = useT();
  const sw = swarmSettings(T.db);
  const llm = T.db.meta.settings.llm;
  const set = (patch) => T.db.tx((tx) => tx.setMeta({ settings: { ...tx.meta.settings, swarm: { ...(tx.meta.settings.swarm || {}), ...patch } } }));
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
  const options = (value) => ANTHROPIC_MODELS.map((m) => html`<option value=${m} selected=${m === value}>${MODEL_PRICES[m].label} ($${MODEL_PRICES[m].in} / $${MODEL_PRICES[m].out} per M tokens)</option>`);
  const claude = llm.provider === 'anthropic';
  const effort = (id, value, onChange) => html`<select id=${id} value=${value} onChange=${onChange}>${['low', 'medium', 'high'].map((e) => html`<option value=${e} selected=${e === value}>${e[0].toUpperCase() + e.slice(1)}</option>`)}</select>`;
  const economy = Object.entries(PRESETS.economy).every(([k, v]) => sw[k] === v);
  return html`<div class="card stack-sm">
    <h2>Agent swarm</h2>
    <p class="small muted">The AI agents that do every step of a job you <a href="#/swarm">hand to the swarm</a>. They use the platform provider above; with the mock they hand in placeholder files.</p>
    <div class="stack-sm" style=${{ border: '1px solid var(--line)', borderRadius: '.5rem', padding: '.7rem' }}>
      <div class="row" style=${{ justifyContent: 'space-between' }}><b>Cost</b>
        <div class="row">
          <button class=${`btn small${economy ? ' primary' : ''}`} onClick=${() => { set({ ...PRESETS.economy, challenger: T.llm.freeReady() ? 'free' : 'haiku' }); toast('Economy: two competitors, two finalists, low effort, a cheaper challenger.', 'ok'); }}>Economy</button>
          <button class="btn small" onClick=${() => { set(PRESETS.standard); toast('Standard settings restored.', 'ok'); }}>Standard</button>
        </div></div>
      <p class="tiny muted">Always on: the prompt cache (the system prompt and the requester’s files are cached for an hour and reread at a tenth of the input price or less), revisions by edits instead of rewrites, and notes instead of whole drafts between rounds. Economy also runs two competitors instead of three, lets only the best two revise, lowers the workers’ and the supervisor’s effort (a point or two of quality for a third to a half less), and adds a cheaper challenger. Standard puts those back.</p>
      <label class="choice"><input type="checkbox" checked=${!!sw.batch} onChange=${(e) => set({ batch: e.target.checked })} disabled=${!claude} /><span><b>Half-price batch mode</b><span>The workers’, supervisors’ and reflection calls go through Anthropic’s Message Batches API: every token at half price. A call then takes minutes instead of seconds (sometimes longer, up to 24 hours), so a job finishes later. Keep this tab open while it runs: calls in flight when you close it are sent again when you come back. Needs Claude as the platform model.</span></span></label>
    </div>
    <div class="inline-fields">
      <${Field} label="Worker model" id="sw-model" hint=${claude ? 'The model each agent does its tile with. Claude Sonnet 5.5 is fast and a fraction of Opus’s price.' : 'Used when the platform model is Claude.'}><select id="sw-model" value=${sw.workerModel} onChange=${(e) => set({ workerModel: e.target.value })}>${options(sw.workerModel)}</select><//>
      <${Field} label="Check model" id="sw-check" hint="Agreement checks, spot checks and peer reviews run on a different model from the work they check."><select id="sw-check" value=${sw.checkModel} onChange=${(e) => set({ checkModel: e.target.value })}>${options(sw.checkModel)}</select><//>
    </div>
    <label class="choice"><input type="checkbox" checked=${!!sw.web} onChange=${(e) => set({ web: e.target.checked })} /><span><b>Let agents search and read the web</b><span>Tiles that need outside facts (prices, venues, funders, public data, research) get a research step first with Anthropic’s web search and web fetch, and cite their sources. Searches cost $10 per 1,000 on top of tokens; reading pages costs only tokens. Needs Claude as the platform model and web search allowed for your key’s organization.</span></span></label>
    <div class="inline-fields">
      <${Field} label="Web searches per tile" id="sw-searches" hint="The most a tile’s research may run (1 to 20)."><input id="sw-searches" type="number" min="1" max="20" value=${sw.maxSearchesPerTile} disabled=${!sw.web} onChange=${(e) => set({ maxSearchesPerTile: num(e.target.value, 1, 20) })} /><//>
      <${Field} label="Pages read per tile" id="sw-fetches" hint="The most pages a tile’s research may open (0 to 20)."><input id="sw-fetches" type="number" min="0" max="20" value=${sw.maxFetchesPerTile} disabled=${!sw.web} onChange=${(e) => set({ maxFetchesPerTile: Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))) })} /><//>
    </div>
    <${Field} label="Competing workers" id="sw-comp" hint="On: each tile goes to several worker configs and a supervisor on the check model keeps the best. Auto: also lets a config that wins nearly every task of a type work alone, still supervised. Off: one agent per tile, checked by the Reviewer. Competition multiplies worker calls; the shared prompt cache keeps the extra input to about a tenth of its price.">
      <select id="sw-comp" value=${sw.competition} onChange=${(e) => set({ competition: e.target.value })}>
        <option value="on" selected=${sw.competition === 'on'}>On</option><option value="auto" selected=${sw.competition === 'auto'}>Auto</option><option value="off" selected=${sw.competition === 'off'}>Off</option>
      </select>
    <//>
    <div class="inline-fields">
      <${Field} label="Competitors per tile" id="sw-rivals" hint="2 to 5. Two compete on a task type one config clearly dominates."><input id="sw-rivals" type="number" min="2" max="5" value=${sw.competitors} disabled=${sw.competition === 'off'} onChange=${(e) => set({ competitors: num(e.target.value, 2, 5) })} /><//>
      <${Field} label="Second round" id="sw-reveal" hint="After the blind round, the workers learn from each other and revise. Auto runs it only when the blind round wasn’t a clean win.">
        <select id="sw-reveal" value=${sw.reveal} disabled=${sw.competition === 'off'} onChange=${(e) => set({ reveal: e.target.value })}>
          <option value="auto" selected=${sw.reveal === 'auto'}>Auto</option><option value="always" selected=${sw.reveal === 'always'}>Always</option><option value="never" selected=${sw.reveal === 'never'}>Never</option>
        </select>
      <//>
      <${Field} label="Score to accept (0 to 1)" id="sw-threshold" hint="The rubric score the best attempt must reach."><input id="sw-threshold" type="number" min="0.3" max="1" step="0.05" value=${sw.threshold} disabled=${sw.competition === 'off'} onChange=${(e) => set({ threshold: Math.max(0.3, Math.min(1, Number(e.target.value) || 0.7)) })} /><//>
      <${Field} label="Accepted tasks sampled for your review (%)" id="sw-sample" hint="Your verdicts on them score the supervisors."><input id="sw-sample" type="number" min="0" max="100" value=${sw.reviewSamplePct} disabled=${sw.competition === 'off'} onChange=${(e) => set({ reviewSamplePct: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} /><//>
    </div>
    <div class="inline-fields">
      <${Field} label="Between rounds, workers see" id="sw-exchange" hint="Notes: the supervisor’s scores and summaries, the notes the workers post to each other, and each one’s approach. Drafts: every blind draft in full (costs more to read, and workers copy more).">
        <select id="sw-exchange" value=${sw.exchange} disabled=${sw.competition === 'off'} onChange=${(e) => set({ exchange: e.target.value })}>
          <option value="notes" selected=${sw.exchange === 'notes'}>Scores and notes</option><option value="drafts" selected=${sw.exchange === 'drafts'}>Every draft</option>
        </select>
      <//>
      <${Field} label="Finalists who revise" id="sw-finalists" hint="0: every worker revises. 2: only the two best drafts go on; the rest count as losses."><input id="sw-finalists" type="number" min="0" max="5" value=${sw.finalists} disabled=${sw.competition === 'off'} onChange=${(e) => set({ finalists: Math.max(0, Math.min(5, Math.round(Number(e.target.value) || 0))) })} /><//>
      <${Field} label="Cheaper challenger" id="sw-challenger" hint="One competitor on every task runs on a cheaper model, scored like the rest.">
        <select id="sw-challenger" value=${sw.challenger} disabled=${sw.competition === 'off'} onChange=${(e) => set({ challenger: e.target.value })}>
          ${[['off', 'None'], ['free', 'Free models (set up above)'], ['haiku', 'Claude Haiku 4.5'], ['sonnet', 'Claude Sonnet 5.5']].map(([v, l]) => html`<option value=${v} selected=${sw.challenger === v}>${l}</option>`)}
        </select>
      <//>
    </div>
    <div class="inline-fields">
      <${Field} label="Worker effort" id="sw-weffort" hint="How hard the workers think. Low costs less and loses a little quality on most writing and research.">${effort('sw-weffort', sw.workerEffort, (e) => set({ workerEffort: e.target.value }))}<//>
      <${Field} label="Supervisor effort" id="sw-ceffort" hint="How hard the supervisor thinks when it scores.">${effort('sw-ceffort', sw.checkEffort, (e) => set({ checkEffort: e.target.value }))}<//>
    </div>
    <label class="choice"><input type="checkbox" checked=${sw.wire !== false} onChange=${(e) => set({ wire: e.target.checked })} /><span><b>Agents talk on the wire</b><span>Agents post short notes (a problem in the inputs, a convention they settled, a fact they checked) for the agents on other tiles, and for their rivals on the same task to read next round. They say which notes they used; when accepted work relied on a note, its author earns an assist, which counts in the rankings. The notes are on the Supervision page.</span></span></label>
    <label class="choice"><input type="checkbox" checked=${!!sw.cheaperClones} disabled=${sw.competition === 'off'} onChange=${(e) => set({ cheaperClones: e.target.checked })} /><span><b>Try cheaper models for winning strategies</b><span>When a config wins over half its tasks, its strategy is tried on the next cheaper Claude model. Configs that score about the same are ranked cheapest first, so if the cheaper clone keeps up it gets the work, and if it doesn’t it is retired.</span></span></label>
    <label class="choice"><input type="checkbox" checked=${!!sw.learning} disabled=${sw.competition === 'off'} onChange=${(e) => set({ learning: e.target.checked })} /><span><b>Learn from scored tasks</b><span>After each task a reflection agent writes short lessons from the winning and losing attempts. Lessons go back into later prompts and stay only if they raise scores against a control worker that runs without them.</span></span></label>
    <label class="choice"><input type="checkbox" checked=${!!sw.split} onChange=${(e) => set({ split: e.target.checked })} /><span><b>Let an agent split a long tile among agents</b><span>When a tile would take one agent much longer than the rest, its agent may split it into parts (rows of a table, sections of a document) that other agents do at the same time; the swarm joins the parts and checks them like one agent’s work. Offered only when it saves real time within the extra cost below. The parts reread the tile’s context from Anthropic’s prompt cache, at about a tenth of the input price, and run on top of the agents working at once.</span></span></label>
    <div class="inline-fields">
      <${Field} label="Split tiles longer than (seconds)" id="sw-split-s" hint="Also the target the plan is tuned to: short page-by-page drafts fold into one tile up to this long."><input id="sw-split-s" type="number" min="20" max="600" value=${sw.splitAboveSeconds} onChange=${(e) => set({ splitAboveSeconds: num(e.target.value, 20, 600) })} /><//>
      <${Field} label="Most parts per tile" id="sw-parts" hint="2 to 8."><input id="sw-parts" type="number" min="2" max="8" value=${sw.maxParts} disabled=${!sw.split} onChange=${(e) => set({ maxParts: num(e.target.value, 2, 8) })} /><//>
      <${Field} label="Extra cost allowed for a split (%)" id="sw-extra" hint="The most a split may add to the tile’s model cost. 0 to 200."><input id="sw-extra" type="number" min="0" max="200" value=${sw.splitMaxExtraPct} disabled=${!sw.split} onChange=${(e) => set({ splitMaxExtraPct: num(e.target.value, 0, 200) })} /><//>
    </div>
    <div class="inline-fields">
      <${Field} label="Agents working at once" id="sw-conc" hint="1 to 8. More is faster and spends faster."><input id="sw-conc" type="number" min="1" max="8" value=${sw.concurrency} onChange=${(e) => set({ concurrency: num(e.target.value, 1, 8) })} /><//>
      <${Field} label="Spend cap per job (USD)" id="sw-cap" hint="The swarm pauses a job when its model spend reaches this. 0 means no cap."><input id="sw-cap" type="number" min="0" step="1" value=${sw.spendCapUsd} onChange=${(e) => set({ spendCapUsd: Math.max(0, Number(e.target.value) || 0) })} /><//>
      <${Field} label="Agents in the swarm" id="sw-size" hint="How many agent accounts share the work (2 to 24)."><input id="sw-size" type="number" min="2" max="24" value=${sw.size} onChange=${(e) => set({ size: num(e.target.value, 2, 24) })} /><//>
    </div>
  </div>`;
}
