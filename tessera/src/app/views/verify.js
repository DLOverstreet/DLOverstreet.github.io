// Verify a signed reputation record against a published Ed25519 key.
import { html, useState } from '../../../vendor/preact.js';
import { useT, useDbVersion, act } from '../state.js';
import { Field, AsyncButton } from '../ui.js';
import { verifySignedRecord } from '../../lib/crypto.js';

let pending = null;
export function setPendingRecord(r) { pending = r; }

export function VerifyView() {
  const T = useT();
  useDbVersion();
  const published = T.db.meta.signingKey;
  const [text, setText] = useState(() => { const r = pending; pending = null; return r ? JSON.stringify(r, null, 2) : ''; });
  const [keySource, setKeySource] = useState('published');
  const [customKey, setCustomKey] = useState('');
  const [result, setResult] = useState(null);
  let record = null;
  try { record = text.trim() ? JSON.parse(text) : null; } catch { record = undefined; }
  const keyToUse = keySource === 'published' ? published?.publicKeyB64 : keySource === 'record' ? record?.issuer?.publicKey : customKey.trim();
  const verify = async () => {
    if (!record) { setResult({ valid: false, reason: 'Paste a record as JSON first.' }); return; }
    if (!keyToUse) { setResult({ valid: false, reason: 'Choose a public key to verify against.' }); return; }
    const r = await act(() => verifySignedRecord(record, keyToUse));
    if (r) setResult(r);
  };
  return html`<div class="stack">
    <div class="page-head"><div><h1>Verify a reputation record</h1><p class="sub">Checks the Ed25519 signature on an exported record. Any change to the record after signing makes it fail.</p></div></div>
    <div class="split">
      <div class="card stack-sm">
        <${Field} label="Record (JSON)" id="rec"><textarea id="rec" rows="16" class="mono small" value=${text} onInput=${(e) => { setText(e.target.value); setResult(null); }} placeholder='{"type":"tessera.reputation.v1", …, "signature":"…"}'></textarea><//>
        <label class="btn small" style=${{ alignSelf: 'flex-start' }}>Load a file<input type="file" accept=".json,application/json" class="sr-only" onChange=${async (e) => { const f = e.target.files[0]; if (f) { setText(await f.text()); setResult(null); } }} /></label>
        ${record === undefined ? html`<p class="small" style=${{ color: 'var(--bad)' }}>That isn’t valid JSON.</p>` : ''}
      </div>
      <div class="stack">
        <div class="card stack-sm">
          <div class="label" id="ks">Verify against</div>
          <div class="stack-sm" role="radiogroup" aria-labelledby="ks">
            <label class="choice"><input type="radio" name="ks" checked=${keySource === 'published'} onChange=${() => setKeySource('published')} /><span><b>This instance’s published key</b><span class="mono">${published ? published.keyId : 'not generated yet'}</span></span></label>
            <label class="choice"><input type="radio" name="ks" checked=${keySource === 'record'} onChange=${() => setKeySource('record')} /><span><b>The key named inside the record</b><span>Proves the record is intact, not who issued it.</span></span></label>
            <label class="choice"><input type="radio" name="ks" checked=${keySource === 'custom'} onChange=${() => setKeySource('custom')} /><span><b>Another key</b><span>Paste a base64 Ed25519 public key.</span></span></label>
          </div>
          ${keySource === 'custom' ? html`<input type="text" class="mono" aria-label="Public key" value=${customKey} onInput=${(e) => setCustomKey(e.target.value)} />` : ''}
          ${record && published && record.issuer?.publicKey && keySource === 'published' && record.issuer.publicKey !== published.publicKeyB64 ? html`<p class="small" style=${{ color: 'var(--warn)' }}>This record names a different issuer key than this instance publishes; it was probably exported from another browser.</p>` : ''}
          <${AsyncButton} class="primary" onClick=${verify}>Verify signature<//>
        </div>
        ${result && html`<div class=${`card ${result.valid ? 'good' : 'bad'}`} role="status"><h2>${result.valid ? '✓ Valid' : '✗ Not valid'}</h2><p class="small">${result.reason}</p>
          ${result.valid && record?.subject ? html`<p class="small" style=${{ marginTop: '.4rem' }}>${record.subject.name}: ${record.skills.map((s) => `${s.tag} ${Math.round(s.score * 100)}% (${s.accepted}/${s.attempts})`).join(' · ')}</p>` : ''}</div>`}
        <p class="small muted">Command line: <code>npm run verify:record -- record.json &lt;publicKey&gt;</code> in the tessera folder does the same check with Node.</p>
      </div>
    </div>
  </div>`;
}
