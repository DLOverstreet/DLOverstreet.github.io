// The tile graph (a layered SVG layout, keyboard-accessible) and the tile editor used
// while a plan is waiting for approval.
import { html, useState } from '../../../vendor/preact.js';
import { layoutGraph } from '../../domain/graph.js';
import { config } from '../../domain/config.js';
import { fmtMoney, fmtRate, truncate } from '../../lib/util.js';
import { tilePayCents } from '../../domain/pricing.js';
import { STATUS_LABEL, Field, AsyncButton } from '../ui.js';
import { RULE_HELP } from '../../domain/autochecks.js';

const STATUS_VAR = {
  DRAFT: 'var(--st-draft)', LOCKED: 'var(--st-locked)', OPEN: 'var(--st-open)', OFFERED: 'var(--st-offered)', CLAIMED: 'var(--st-claimed)',
  SUBMITTED: 'var(--st-submitted)', IN_REVIEW: 'var(--st-review)', REVISION: 'var(--st-revision)', ACCEPTED: 'var(--st-accepted)', CANCELLED: 'var(--st-cancelled)',
};
const KIND_VAR = { WORK: 'var(--st-open)', REVIEW: 'var(--st-review)', INTEGRATION: 'var(--st-offered)' };

function wrap(text, max) {
  const words = text.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length > max && cur) lines.push(w);
    else lines[lines.length - 1] = (cur + ' ' + w).trim();
  }
  return lines.slice(0, 2).map((l, i, a) => (i === 1 && lines.length > 2 ? truncate(l, max - 1) + '…' : l));
}

/** @param {{ tiles: object[], selected?: string, onSelect?: Function, colorBy?: 'status'|'kind' }} p */
export function GraphView({ tiles, selected, onSelect, colorBy = 'status' }) {
  const L = layoutGraph(tiles, { nodeW: 210, nodeH: 74, gapX: 56, gapY: 18 });
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const hl = new Set();
  if (selected) {
    const s = byKey.get(selected);
    for (const d of s?.dependsOn || []) hl.add(`${d}>${selected}`);
    for (const t of tiles) if ((t.dependsOn || []).includes(selected)) hl.add(`${selected}>${t.key}`);
  }
  return html`<div class="graph-wrap">
    <svg width=${L.width} height=${L.height} viewBox=${`0 0 ${L.width} ${L.height}`} role="group" aria-label=${`Tile graph with ${tiles.length} tiles`}>
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)" /></marker></defs>
      ${L.edges.map((e) => html`<path class=${`gedge ${hl.has(`${e.from}>${e.to}`) ? 'hl' : ''}`} d=${e.d} marker-end="url(#arrow)" />`)}
      ${L.nodes.map((n) => {
        const t = byKey.get(n.key);
        const lines = wrap(t.title, 27);
        const color = colorBy === 'kind' ? KIND_VAR[t.kind] : STATUS_VAR[t.status];
        const label = `${t.title}. ${t.kind.toLowerCase()} tile, tier ${t.tier}, ${t.estMinutes} minutes, ${fmtMoney(t.payCents)}${colorBy === 'status' ? `, ${STATUS_LABEL[t.status]}` : ''}. Depends on ${(t.dependsOn || []).length || 'nothing'}.`;
        return html`<g class=${`gnode ${selected === t.key ? 'selected' : ''}`} transform=${`translate(${n.x},${n.y})`} tabindex=${onSelect ? 0 : -1} role=${onSelect ? 'button' : 'img'} aria-label=${label} aria-pressed=${onSelect ? String(selected === t.key) : undefined}
          onClick=${() => onSelect && onSelect(t.key)} onKeyDown=${(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(t.key); } }}>
          <rect class="box" width=${L.nodeW} height=${L.nodeH} rx="8" />
          <rect class="bar" width="6" height=${L.nodeH} rx="3" fill=${color} />
          ${lines.map((l, i) => html`<text x="14" y=${20 + i * 15} font-weight="600">${l}</text>`)}
          <text class="meta" x="14" y=${L.nodeH - 11}>${t.kind === 'WORK' ? '' : `${t.kind} · `}T${t.tier} · ${t.estMinutes}m · ${fmtMoney(t.payCents)}${colorBy === 'status' ? ` · ${STATUS_LABEL[t.status]}` : ''}</text>
        </g>`;
      })}
    </svg>
  </div>`;
}

function emptyCriterion(list) {
  let n = list.length + 1;
  while (list.some((c) => c.id === `c${n}`)) n++;
  return { id: `c${n}`, text: '', check: 'LLM' };
}

/** Edits one draft tile. `onSave(patch)` and `onDelete()` return promises. */
export function TileEditor({ tile, allTiles, rush, onSave, onDelete, onClose }) {
  const [d, setD] = useState(() => ({
    title: tile.title, key: tile.key, kind: tile.kind, tier: tile.tier, estMinutes: tile.estMinutes, spec: tile.spec,
    deliverableFormat: tile.deliverableFormat, skillTags: tile.skillTags.join(', '), languages: (tile.languages || []).join(', '),
    acceptanceCriteria: tile.acceptanceCriteria.map((c) => ({ ...c })), dependsOn: [...(tile.dependsOn || [])], highStakes: !!tile.highStakes,
  }));
  const set = (k) => (e) => setD({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setCrit = (i, k, v) => setD({ ...d, acceptanceCriteria: d.acceptanceCriteria.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const pay = tilePayCents({ estMinutes: Number(d.estMinutes) || 0, tier: Number(d.tier) || 1 }, { rush });
  const others = allTiles.filter((t) => t.key !== tile.key);
  const save = () => onSave({
    title: d.title, key: d.key, kind: d.kind, tier: Number(d.tier), estMinutes: Number(d.estMinutes), spec: d.spec,
    deliverableFormat: d.deliverableFormat, skillTags: d.skillTags.split(',').map((x) => x.trim()).filter(Boolean),
    languages: d.languages.split(',').map((x) => x.trim()).filter(Boolean), dependsOn: d.dependsOn, highStakes: d.highStakes,
    acceptanceCriteria: d.acceptanceCriteria.map((c) => ({ id: c.id, text: c.text, check: c.check, ...(c.check === 'AUTO' && c.rule ? { rule: c.rule } : {}) })),
  });
  return html`<div class="card stack">
    <div class="card-head"><h3>Edit tile</h3><button class="btn small ghost" onClick=${onClose}>Close</button></div>
    <${Field} label="Title" id="te-title"><input id="te-title" type="text" maxlength="80" value=${d.title} onInput=${set('title')} /><//>
    <div class="inline-fields">
      <${Field} label="Key" id="te-key"><input id="te-key" type="text" value=${d.key} onInput=${set('key')} /><//>
      <${Field} label="Kind" id="te-kind"><select id="te-kind" value=${d.kind} onChange=${set('kind')}><option>WORK</option><option>REVIEW</option><option>INTEGRATION</option></select><//>
      <${Field} label="Tier" id="te-tier"><select id="te-tier" value=${d.tier} onChange=${set('tier')}>${[1, 2, 3, 4].map((t) => html`<option value=${t}>${t} · ${fmtRate(config.tierRates[t])}</option>`)}</select><//>
      <${Field} label="Minutes" id="te-min" hint="15–120"><input id="te-min" type="number" min="15" max="120" value=${d.estMinutes} onInput=${set('estMinutes')} /><//>
    </div>
    <p class="small">Pays <b>${fmtMoney(pay)}</b>${rush ? ' (rush)' : ''}. Pay comes from the formula; to change it, change the time or tier.</p>
    <${Field} label="Spec" id="te-spec" hint="Everything the contributor needs. They see only this and the outputs of upstream tiles."><textarea id="te-spec" rows="6" value=${d.spec} onInput=${set('spec')}></textarea><//>
    <${Field} label="Deliverable format" id="te-fmt"><input id="te-fmt" type="text" value=${d.deliverableFormat} onInput=${set('deliverableFormat')} /><//>
    <div class="inline-fields">
      <${Field} label="Skill tags" id="te-tags" hint="Comma-separated, kebab-case"><input id="te-tags" type="text" value=${d.skillTags} onInput=${set('skillTags')} /><//>
      <${Field} label="Languages" id="te-langs" hint="e.g. en, es (blank = commission language)"><input id="te-langs" type="text" value=${d.languages} onInput=${set('languages')} /><//>
    </div>
    <div>
      <div class="label">Acceptance criteria</div>
      ${d.acceptanceCriteria.map((c, i) => html`<div class="card flat" style=${{ padding: '.6rem', marginTop: '.4rem' }}>
        <div class="row"><span class="mono small">${c.id}</span>
          <select aria-label=${`Check type for ${c.id}`} value=${c.check} onChange=${(e) => setCrit(i, 'check', e.target.value)} style=${{ width: 'auto' }}><option>AUTO</option><option>LLM</option><option>PEER</option></select>
          <button class="btn small ghost" onClick=${() => setD({ ...d, acceptanceCriteria: d.acceptanceCriteria.filter((_, j) => j !== i) })} aria-label=${`Remove criterion ${c.id}`}>Remove</button></div>
        <input type="text" aria-label=${`Criterion ${c.id} text`} value=${c.text} onInput=${(e) => setCrit(i, 'text', e.target.value)} style=${{ marginTop: '.35rem' }} />
        ${c.check === 'AUTO' ? html`<input type="text" class="mono" aria-label=${`Rule for ${c.id}`} placeholder="e.g. csv_columns(a, b)" value=${c.rule || ''} onInput=${(e) => setCrit(i, 'rule', e.target.value)} style=${{ marginTop: '.35rem' }} list="rule-help" />` : ''}
      </div>`)}
      <datalist id="rule-help">${RULE_HELP.map((r) => html`<option value=${r.help.split(' — ')[0]}>${r.help}</option>`)}</datalist>
      <button class="btn small" style=${{ marginTop: '.4rem' }} onClick=${() => setD({ ...d, acceptanceCriteria: [...d.acceptanceCriteria, emptyCriterion(d.acceptanceCriteria)] })}>Add criterion</button>
    </div>
    <fieldset style=${{ border: 0 }}><legend class="label">Depends on</legend>
      ${others.length ? html`<div class="choices">${others.map((t) => html`<label class="choice"><input type="checkbox" checked=${d.dependsOn.includes(t.key)} onChange=${(e) => setD({ ...d, dependsOn: e.target.checked ? [...d.dependsOn, t.key] : d.dependsOn.filter((k) => k !== t.key) })} /><span><b>${t.title}</b><span>${t.key}</span></span></label>`)}</div>` : html`<p class="small muted">No other tiles.</p>`}
    </fieldset>
    <label class="choice"><input type="checkbox" checked=${d.highStakes} onChange=${set('highStakes')} /><span><b>High stakes</b><span>Always send this tile to a human peer reviewer.</span></span></label>
    <div class="row"><${AsyncButton} class="primary" onClick=${save}>Save tile<//><${AsyncButton} class="danger" onClick=${onDelete}>Delete tile<//></div>
  </div>`;
}
