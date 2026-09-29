// One tile. Whoever holds it gets the workspace: their brief, the criteria, inputs,
// submission, review results and a copilot scoped to the tile. Peer reviewers get the
// review form; the requester sees submissions and reviews and can settle stalled reviews.
import { html, useState, useEffect, useRef } from '../../../vendor/preact.js';
import { useT, useDbVersion, useNow, navigate, currentUser, act, toast, downloadBytes } from '../state.js';
import { StatusBadge, Money, Countdown, Empty, AsyncButton, Modal, Field, Rate, Markdown, UserName, ago, STATUS_LABEL } from '../ui.js';
import { latestBrief, upstreamFiles } from '../../services/work.js';
import { CompetitionCard } from './supervision.js';
import { explainFit } from '../../services/market.js';
import { generateSampleWork } from '../../agents/mock/sample-work.js';
import { config } from '../../domain/config.js';
import { RULES, parseRule } from '../../domain/autochecks.js';
import { redactText } from '../../lib/redact.js';
import { parseCsv } from '../../lib/csv.js';
import { fmtMoney, fmtMinutes, fmtBytes, fmtDateTime, isTextFile, mimeFor, fileExt, truncate } from '../../lib/util.js';

// ---------------------------------------------------------------- files

function FilePreviewModal({ file, bytes, onClose }) {
  const ext = fileExt(file.name);
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
      const u = URL.createObjectURL(new Blob([bytes], { type: mimeFor(file.name) }));
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    return undefined;
  }, []);
  let body;
  if (url) body = html`<img src=${url} alt=${`Preview of ${file.name}`} style=${{ maxWidth: '100%', background: '#fff', borderRadius: '6px' }} />`;
  else if (ext === 'csv' || ext === 'tsv') {
    const { columns, rows } = parseCsv(new TextDecoder().decode(bytes));
    body = html`<p class="small muted">${rows.length} rows · ${columns.length} columns</p><div class="table-wrap" style=${{ maxHeight: '60vh' }}><table><thead><tr>${columns.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>${rows.slice(0, 100).map((r) => html`<tr>${r.map((v) => html`<td class="small">${v}</td>`)}</tr>`)}</tbody></table></div>`;
  } else if (ext === 'md' || ext === 'markdown') body = html`<div class="card flat"><${Markdown} text=${new TextDecoder().decode(bytes)} /></div>`;
  else if (isTextFile(file.name)) body = html`<pre>${new TextDecoder().decode(bytes).slice(0, 200000)}</pre>`;
  else body = html`<p class="small">No preview for .${ext} files. Download it instead.</p>`;
  return html`<${Modal} wide title=${file.name} onClose=${onClose}>${body}
    <div class="row" style=${{ marginTop: '.8rem' }}><button class="btn" onClick=${() => downloadBytes(bytes, file.name, mimeFor(file.name))}>Download</button></div><//>`;
}

/** A stored file: name, size and preview/download buttons. */
export function StoredFile({ file, from }) {
  const T = useT();
  const [open, setOpen] = useState(null);
  const load = async () => {
    const bytes = await T.blobs.get(file.key);
    if (!bytes) { toast('That file is missing from this browser’s storage.', 'err'); return null; }
    return bytes;
  };
  return html`<li><span class="name">${file.name}</span>${from ? html`<span class="tiny muted">from ${from}</span>` : ''}<span class="tiny muted">${fmtBytes(file.size)}</span>
    <button class="btn small" onClick=${async () => { const b = await load(); if (b) setOpen(b); }}>Preview</button>
    <button class="btn small ghost" onClick=${async () => { const b = await load(); if (b) downloadBytes(b, file.name, mimeFor(file.name)); }} aria-label=${`Download ${file.name}`}>⬇</button>
    ${open && html`<${FilePreviewModal} file=${file} bytes=${open} onClose=${() => setOpen(null)} />`}
  </li>`;
}

// ---------------------------------------------------------------- shared sections

function TileHeader({ t, now, me }) {
  const T = useT();
  const c = T.db.get('Commission', t.commissionId);
  const canSeeCommission = c.privacy === 'PUBLIC' || me?.id === c.requesterId || me?.isAdmin;
  return html`<div class="page-head">
    <div style=${{ minWidth: 0 }}>
      <div class="tiny muted">${canSeeCommission ? html`<a href=${`#/c/${c.id}`}>${c.title}</a>` : 'Part of a need-to-know commission'} · <span class="mono">${t.key}</span></div>
      <h1>${t.title}</h1>
      <div class="row small" style=${{ marginTop: '.35rem' }}>
        <${StatusBadge} status=${t.status} />
        <b><${Money} cents=${t.payCents} /></b><span class="muted">·</span><${Rate} tile=${t} /><span class="muted">·</span>${fmtMinutes(t.estMinutes)}<span class="muted">·</span>tier ${t.tier}
        ${t.kind !== 'WORK' ? html`<span class="badge info">${t.kind.toLowerCase()}</span>` : ''}${t.highStakes ? html`<span class="badge warn">high stakes</span>` : ''}${t.rush ? html`<span class="badge warn">rush</span>` : ''}
        ${t.claimExpiresAt && ['CLAIMED', 'REVISION'].includes(t.status) ? html`<span class="muted">· claim ends in <${Countdown} until=${t.claimExpiresAt} now=${now} /></span>` : ''}
        ${t.revisionCount ? html`<span class="badge warn">round ${t.revisionCount + 1} of ${config.maxRevisionRounds + 1}</span>` : ''}
      </div>
      <div class="tags" style=${{ marginTop: '.4rem' }}>${t.skillTags.map((s) => html`<span class="tag">${s}</span>`)}</div>
    </div>
  </div>`;
}

function SpecCard({ t, restricted }) {
  const spec = restricted ? redactText(t.spec) : t.spec;
  return html`<div class="card"><h2>Spec</h2>
    <div class="small" style=${{ whiteSpace: 'pre-wrap' }}>${spec}</div>
    <dl class="kv" style=${{ marginTop: '.7rem' }}><dt>Deliver</dt><dd>${t.deliverableFormat}</dd>
      ${t.languages?.length ? html`<dt>Languages</dt><dd>${t.languages.join(', ')}</dd>` : ''}
      ${t.sensitiveInputs?.length ? html`<dt>Sensitive</dt><dd>${t.sensitiveInputs.join(', ')}: keep these out of your outputs and out of any AI tool.</dd>` : ''}
      ${t.calibration ? html`<dt>Estimate</dt><dd>${t.originalEstMinutes} → ${t.estMinutes} min, because ${t.calibration.tags.join(', ')} tiles have run ×${t.calibration.ratio} their estimates.</dd>` : ''}
    </dl></div>`;
}

function CriteriaCard({ t, verdicts }) {
  return html`<div class="card"><h2>Acceptance criteria</h2>
    <p class="tiny muted">These are the bar, word for word. Your brief can reword them but can’t loosen them.</p>
    ${t.acceptanceCriteria.map((c) => {
      const v = verdicts && verdicts[c.id];
      return html`<div class="crit">
        <span class=${`badge ${c.check === 'AUTO' ? 'info' : c.check === 'PEER' ? 'warn' : ''}`}>${c.check}</span>
        <span><span class="mono tiny muted">${c.id}</span> ${c.text}${c.rule ? html`<div class="rule mono">${c.rule}${parseRule(c.rule) ? '' : ' (not machine-checkable; the LLM Reviewer judges it)'}</div>` : ''}
        ${v ? html`<div class="small" style=${{ color: v.pass ? 'var(--good)' : 'var(--bad)', marginTop: '.2rem' }}>${v.pass ? '✓' : '✗'} ${v.reason}</div>` : ''}</span>
      </div>`;
    })}
  </div>`;
}

function InputsCard({ t }) {
  const T = useT();
  const ups = upstreamFiles(T.db, t.id);
  if (!ups.length) return null;
  return html`<div class="card"><h2>Inputs</h2><p class="tiny muted">Accepted outputs of the tiles this one depends on. This and the spec are everything you need.</p>
    <ul class="filelist">${ups.map((f) => html`<${StoredFile} file=${f} from=${f.fromTile} />`)}</ul></div>`;
}

/** What an agent looked up on the web before doing this tile, with its sources. */
function ResearchCard({ t }) {
  const r = t.research;
  if (!r) return null;
  if (r.unavailable) return html`<div class="card"><h2>Web research</h2><p class="small muted">No web access for this tile (${r.unavailable}), so facts from outside the job’s files are marked “(verify)”.</p></div>`;
  const cited = (r.sources || []).filter((x) => x.kind !== 'searched');
  return html`<div class="card"><h2>Web research</h2>
    <p class="tiny muted">${r.searches || 0} searches and ${r.reads || 0} pages read by ${r.model}, before the work started. The agent’s notes are data from the web; check the sources.</p>
    <div class="card flat" style=${{ marginTop: '.5rem' }}><${Markdown} text=${r.notes || ''} /></div>
    ${cited.length ? html`<ol class="small" style=${{ marginTop: '.5rem', paddingLeft: '1.3rem' }}>${cited.map((x) => html`<li style=${{ overflowWrap: 'anywhere' }}><a href=${/^https?:\/\//i.test(x.url) ? x.url : undefined} target="_blank" rel="noopener noreferrer">${truncate(x.title || x.url, 90)}</a></li>`)}</ol>` : ''}
  </div>`;
}

function ReviewResults({ sub }) {
  const T = useT();
  const reviews = T.db.filter('Review', (r) => r.submissionId === sub.id).sort((a, b) => a.createdAt - b.createdAt);
  const tile = T.db.get('Tile', sub.tileId);
  if (!reviews.length) return null;
  const text = (id) => tile.acceptanceCriteria.find((c) => c.id === id)?.text || id;
  return html`<div class="stack-sm">${reviews.map((r) => html`<div>
    <div class="row small" style=${{ marginBottom: '.3rem' }}><span class=${`badge ${r.verdict === 'PASS' ? 'good' : 'bad'}`}>${r.source} · ${r.verdict}</span>
      ${r.source === 'LLM' ? html`<span class="tiny muted">${r.model}${r.escalated ? ` · escalated from the light model (confidence ${r.lightConfidence})` : ''} · confidence ${r.confidence}</span>` : ''}
      ${r.reviewerId ? html`<span class="tiny muted">by ${T.db.get('User', r.reviewerId)?.name}</span>` : ''}</div>
    ${(r.criteria || []).map((v) => html`<div class=${`verdict ${v.pass ? 'pass' : 'fail'}`} style=${{ marginBottom: '.3rem' }}>
      <span aria-hidden="true">${v.pass ? '✅' : '❌'}</span><span class="small"><b>${v.criterionId}</b> ${text(v.criterionId)}<br/><span class=${v.pass ? 'muted' : ''}>${v.reason}</span></span></div>`)}
  </div>`)}</div>`;
}

function Submissions({ t, onlyUserId }) {
  const T = useT();
  const now = useNow(10000);
  const subs = T.db.filter('Submission', (s) => s.tileId === t.id && (!onlyUserId || s.contributorId === onlyUserId)).sort((a, b) => b.createdAt - a.createdAt);
  if (!subs.length) return null;
  return html`<div class="card"><h2>Submissions</h2>${subs.map((s) => html`<div style=${{ borderTop: '1px solid var(--line)', paddingTop: '.7rem', marginTop: '.7rem' }}>
    <div class="row-between"><span class="small"><b>Round ${s.round}</b> by <${UserName} user=${T.db.get('User', s.contributorId)} org=${false} /></span><span class="tiny muted">${ago(s.createdAt, now)} · ${s.minutesSpent} min reported${s.modelUsed ? ` · used ${s.modelUsed}` : ''}</span></div>
    ${s.notes ? html`<p class="small" style=${{ margin: '.3rem 0' }}>“${s.notes}”</p>` : ''}
    ${s.files.length ? html`<ul class="filelist">${s.files.map((f) => html`<${StoredFile} file=${f} />`)}</ul>` : ''}
    <div style=${{ marginTop: '.6rem' }}><${ReviewResults} sub=${s} /></div>
  </div>`)}</div>`;
}

function History({ t }) {
  const T = useT();
  const now = useNow(10000);
  const rows = T.db.filter('StatusChange', (x) => x.entityId === t.id).sort((a, b) => b.createdAt - a.createdAt);
  return html`<div class="card"><h2>History</h2><ul class="feed">${rows.map((r) => html`<li><time title=${fmtDateTime(r.createdAt)}>${ago(r.createdAt, now)}</time><span><b>${STATUS_LABEL[r.from]} → ${STATUS_LABEL[r.to]}</b> <span class="muted small">${T.db.get('User', r.actor)?.name || r.actor}${r.note ? ` · ${r.note}` : ''}</span></span></li>`)}</ul></div>`;
}

// ---------------------------------------------------------------- the workspace

function BriefCard({ t, me, checks, setChecks }) {
  const T = useT();
  const brief = latestBrief(T.db, t.id, me.id);
  const profile = T.db.find('ContributorProfile', (p) => p.userId === me.id);
  const route = T.llm.contributor(me, profile);
  const gen = () => act(() => T.api.generateBrief(me.id, t.id), 'Brief ready.');
  if (!brief) {
    return html`<div class="card accent"><h2>Your brief</h2>
      <p class="small">Your model rewrites this tile for you: steps at your level (${profile.briefStyle.toLowerCase().replace(/_/g, ' ')}), setup for your tools, in ${profile.briefLanguage || profile.languages[0]}, with a checklist that maps one to one onto the criteria.</p>
      <p class="small muted" style=${{ margin: '.4rem 0 .7rem' }}>Model: ${route.label}${route.fallback ? ` · ${route.fallback}` : ''}</p>
      <${AsyncButton} class="primary" onClick=${gen}>Write my brief<//></div>`;
  }
  const b = brief.content;
  return html`<div class="card">
    <div class="card-head"><h2>Your brief</h2><${AsyncButton} class="small" onClick=${gen}>Rewrite<//></div>
    <p class="tiny muted">Written by ${brief.model} (${brief.provider})${brief.fallbackNote ? ` · ${brief.fallbackNote}` : ''} · ${brief.style.toLowerCase().replace(/_/g, ' ')} · ${brief.language}</p>
    <p style=${{ margin: '.6rem 0' }}>${b.purpose}</p>
    ${b.setup.length ? html`<h3>Setup</h3><ul class="small" style=${{ paddingLeft: '1.1rem', margin: '.3rem 0 .6rem' }}>${b.setup.map((s) => html`<li>${s}</li>`)}</ul>` : ''}
    <h3>Steps</h3><ol class="steps small">${b.steps.map((s) => html`<li>${s}</li>`)}</ol>
    <h3 style=${{ marginTop: '.6rem' }}>Checklist</h3>
    <ul class="checklist">${b.checklist.map((c) => html`<li><input type="checkbox" id=${`ck-${c.criterionId}`} checked=${!!checks[c.criterionId]} onChange=${(e) => setChecks({ ...checks, [c.criterionId]: e.target.checked })} /><label for=${`ck-${c.criterionId}`} class="small"><span class="mono tiny muted">${c.criterionId}</span> ${c.text}</label></li>`)}</ul>
    ${b.pitfalls.length ? html`<h3 style=${{ marginTop: '.6rem' }}>Pitfalls</h3><ul class="small" style=${{ paddingLeft: '1.1rem' }}>${b.pitfalls.map((s) => html`<li>${s}</li>`)}</ul>` : ''}
  </div>`;
}

function NewFileModal({ onAdd, onClose }) {
  const [name, setName] = useState('notes.md');
  const [text, setText] = useState('');
  return html`<${Modal} title="Create a file" onClose=${onClose}>
    <${Field} label="File name" id="nf-name" hint="Include the extension, e.g. glossary.csv or memo.md"><input id="nf-name" type="text" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
    <${Field} label="Contents" id="nf-body"><textarea id="nf-body" rows="12" class="mono" value=${text} onInput=${(e) => setText(e.target.value)}></textarea><//>
    <div class="row" style=${{ marginTop: '.8rem' }}><button class="btn primary" onClick=${() => { onAdd({ name: name.trim() || 'file.txt', bytes: new TextEncoder().encode(text) }); onClose(); }}>Add file</button></div><//>`;
}

function SubmitCard({ t, me, checks, setChecks }) {
  const T = useT();
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState(String(t.estMinutes));
  const [over, setOver] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const input = useRef(null);
  const add = async (list) => {
    const read = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    setFiles((xs) => [...xs.filter((x) => !read.some((r) => r.name === x.name)), ...read]);
  };
  const lastSub = T.db.filter('Submission', (s) => s.tileId === t.id && s.contributorId === me.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  const reuse = async () => {
    const out = [];
    for (const f of lastSub.files) { const b = await T.blobs.get(f.key); if (b) out.push({ name: f.name, bytes: b }); }
    setFiles(out);
    toast(`Loaded ${out.length} file(s) from round ${lastSub.round}. Fix what failed, then submit.`, 'ok');
  };
  const sample = () => {
    const w = generateSampleWork(t, { seed: `${t.id}:${t.revisionCount || 0}:visitor`, upstreamFiles: upstreamFiles(T.db, t.id).map((f) => f.name) });
    setFiles(w.files.map((f) => ({ name: f.name, bytes: new TextEncoder().encode(f.text) })));
    setNotes(w.notes);
    setMinutes(String(w.minutesSpent));
    setChecks(Object.fromEntries(t.acceptanceCriteria.map((c) => [c.id, true])));
    toast('Filled with sample work that meets the automatic checks. Preview or edit it before submitting.', 'ok');
  };
  const submit = async () => {
    const r = await act(() => T.api.submitWork(me.id, t.id, { files, notes, minutesSpent: Number(minutes), checklist: checks, modelUsed: null }), 'Submitted. Automatic checks are running.');
    if (r) { setFiles([]); setNotes(''); }
  };
  const unticked = t.acceptanceCriteria.filter((c) => !checks[c.id]).length;
  const autoRules = t.acceptanceCriteria.filter((c) => c.check === 'AUTO' && parseRule(c.rule));
  return html`<div class="card stack-sm">
    <h2>${t.status === 'REVISION' ? 'Resubmit' : 'Submit your work'}</h2>
    <div class=${`dropzone ${over ? 'over' : ''}`} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
      <p class="small">Drop files here, or</p>
      <div class="row" style=${{ justifyContent: 'center', marginTop: '.4rem' }}>
        <button class="btn small" onClick=${() => input.current.click()}>Choose files</button>
        <button class="btn small" onClick=${() => setCreating(true)}>Create a file</button>
        ${lastSub && t.status === 'REVISION' ? html`<button class="btn small" onClick=${reuse}>Start from round ${lastSub.round}</button>` : ''}
        <button class="btn small ghost" onClick=${sample} title="Demo shortcut: generates files that satisfy this tile's automatic checks">Fill with sample work (demo)</button>
      </div>
      <input ref=${input} type="file" multiple class="sr-only" aria-label="Choose files to submit" onChange=${(e) => { add(e.target.files); e.target.value = ''; }} />
    </div>
    ${files.length ? html`<ul class="filelist">${files.map((f, i) => html`<li><span class="name">${f.name}</span><span class="tiny muted">${fmtBytes(f.bytes.length)}</span>
      ${isTextFile(f.name) ? html`<button class="btn small" onClick=${() => setEditing(i)}>Edit</button>` : ''}
      <button class="btn small ghost" onClick=${() => setFiles(files.filter((_, j) => j !== i))} aria-label=${`Remove ${f.name}`}>Remove</button></li>`)}</ul>` : ''}
    ${autoRules.length ? html`<p class="tiny muted">Checked automatically on submit: ${autoRules.map((c) => c.rule).join(' · ')}</p>` : ''}
    <${Field} label="Note for the reviewer" id="sub-notes"><textarea id="sub-notes" rows="3" value=${notes} onInput=${(e) => setNotes(e.target.value)} placeholder="What you did, anything unusual, where to look."></textarea><//>
    <${Field} label="Minutes you actually spent" id="sub-min" hint="Honest numbers keep future estimates, and pay, fair."><input id="sub-min" type="number" min="1" value=${minutes} onInput=${(e) => setMinutes(e.target.value)} style=${{ maxWidth: '10rem' }} /><//>
    ${unticked ? html`<p class="small" style=${{ color: 'var(--warn)' }}>${unticked} checklist item${unticked > 1 ? 's are' : ' is'} unticked. You can still submit.</p>` : ''}
    <div class="row"><${AsyncButton} class="primary" onClick=${submit} disabled=${!files.length}>Submit ${files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}<//>
      <span class="tiny muted">Up to ${config.limits.maxFilesPerSubmission} files, ${fmtBytes(config.limits.maxFileBytes)} each.</span></div>
    ${creating && html`<${NewFileModal} onClose=${() => setCreating(false)} onAdd=${(f) => setFiles([...files.filter((x) => x.name !== f.name), f])} />`}
    ${editing !== null && html`<${Modal} wide title=${`Edit ${files[editing].name}`} onClose=${() => setEditing(null)}>
      <textarea class="mono" rows="18" aria-label="File contents" value=${new TextDecoder().decode(files[editing].bytes)} onInput=${(e) => { const b = new TextEncoder().encode(e.target.value); setFiles(files.map((f, j) => (j === editing ? { ...f, bytes: b } : f))); }}></textarea>
      <div class="row" style=${{ marginTop: '.8rem' }}><button class="btn primary" onClick=${() => setEditing(null)}>Done</button></div><//>`}
  </div>`;
}

function Copilot({ t, me }) {
  const T = useT();
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs.length]);
  const ask = async (question) => {
    if (!question.trim()) return;
    const history = msgs.map((m) => ({ role: m.me ? 'user' : 'assistant', content: m.text }));
    setMsgs((xs) => [...xs, { me: true, text: question }]);
    setQ('');
    setBusy(true);
    const r = await act(() => T.api.askCopilot(me.id, t.id, question, history));
    setBusy(false);
    if (r) setMsgs((xs) => [...xs, { me: false, text: r.answer, model: r.model }]);
  };
  return html`<div class="card">
    <h2>Tile copilot</h2>
    <p class="tiny muted">Scoped to this tile only, on your model. Try: ${['What counts as done?', 'Where do I start?', 'What files do I deliver?'].map((s, i) => html`${i ? ', ' : ''}<button class="btn small ghost" style=${{ padding: '0 .2rem', minHeight: 0 }} onClick=${() => ask(s)}>${s}</button>`)}</p>
    <div class="chat" ref=${box} aria-live="polite">${msgs.map((m) => html`<div class=${`msg ${m.me ? 'me' : 'bot'}`}>${m.text}</div>`)}${busy ? html`<div class="msg bot"><span class="spinner"></span></div>` : ''}</div>
    <form class="row" style=${{ marginTop: '.5rem' }} onSubmit=${(e) => { e.preventDefault(); ask(q); }}>
      <input type="text" aria-label="Ask the copilot" placeholder="Ask about this tile…" value=${q} onInput=${(e) => setQ(e.target.value)} style=${{ flex: 1, width: 'auto' }} />
      <button class="btn" type="submit" disabled=${busy}>Ask</button>
    </form>
  </div>`;
}

function Waiting({ t }) {
  const T = useT();
  const rt = t.pendingReviewTileId && T.db.get('Tile', t.pendingReviewTileId);
  const job = T.db.find('Job', (j) => j.type === 'verify' && j.payload.tileId === t.id && ['PENDING', 'RUNNING', 'FAILED'].includes(j.status));
  return html`<div class="card accent" role="status">
    <h2>Being checked</h2>
    ${rt ? html`<p class="small">Automatic and LLM checks passed. A person now reviews it: ${t.peerReviewReason?.toLowerCase()}. ${rt.status === 'CLAIMED' ? `${T.db.get('User', rt.claimedById)?.name} is reviewing it now.` : rt.status === 'OFFERED' ? 'The review has been offered to eligible reviewers.' : 'Waiting for a reviewer to claim it.'}</p>`
      : job?.status === 'FAILED' ? html`<p class="small" style=${{ color: 'var(--bad)' }}>Verification failed to run: ${job.lastError}</p>`
      : html`<p class="small"><span class="spinner"></span> Running the automatic checks, then the LLM Reviewer…</p>`}
  </div>`;
}

function Workspace({ t, me, now }) {
  const T = useT();
  const [checks, setChecks] = useState({});
  const restricted = T.db.get('Commission', t.commissionId).privacy === 'RESTRICTED';
  const last = T.db.filter('Submission', (s) => s.tileId === t.id && s.contributorId === me.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  const lastVerdicts = {};
  if (last) for (const r of T.db.filter('Review', (x) => x.submissionId === last.id)) for (const v of r.criteria || []) lastVerdicts[v.criterionId] = v;
  return html`<div>
    <${TileHeader} t=${t} now=${now} me=${me} />
    ${t.status === 'REVISION' ? html`<div class="callout warn" style=${{ marginBottom: '1rem' }}>Round ${last?.round} didn’t pass. The criteria below show what failed and why. Fix those parts and resubmit; after ${config.maxRevisionRounds} revisions the tile reopens to others.</div>` : ''}
    <div class="split">
      <div class="stack">
        <${BriefCard} t=${t} me=${me} checks=${checks} setChecks=${setChecks} />
        <${CriteriaCard} t=${t} verdicts=${t.status === 'REVISION' ? lastVerdicts : null} />
        <${SpecCard} t=${t} restricted=${restricted} />
        <${InputsCard} t=${t} />
      </div>
      <div class="stack">
        ${['CLAIMED', 'REVISION'].includes(t.status) ? html`<${SubmitCard} t=${t} me=${me} checks=${checks} setChecks=${setChecks} />` : html`<${Waiting} t=${t} />`}
        <${Copilot} t=${t} me=${me} />
        <${Submissions} t=${t} onlyUserId=${me.id} />
        ${['CLAIMED', 'REVISION'].includes(t.status) ? html`<div><button class="btn small danger" onClick=${() => { if (confirm('Release this tile? It goes back to the pool with no penalty.')) act(() => T.api.releaseClaim(me.id, t.id), 'Released with no penalty.').then((r) => r && navigate('#/work')); }}>Release this tile</button></div>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- peer review

function VerdictForm({ criteria, onSubmit, submitLabel = 'Submit review' }) {
  const [v, setV] = useState(() => Object.fromEntries(criteria.map((c) => [c.id, { pass: null, reason: '' }])));
  const [notes, setNotes] = useState('');
  const set = (id, patch) => setV({ ...v, [id]: { ...v[id], ...patch } });
  return html`<div class="stack-sm">
    ${criteria.map((c) => html`<fieldset class="card flat" style=${{ padding: '.7rem' }}>
      <legend class="small"><span class="mono tiny muted">${c.id}</span> <b>${c.text}</b></legend>
      <div class="row" style=${{ margin: '.3rem 0' }}>
        <label class="choice" style=${{ padding: '.3rem .6rem' }}><input type="radio" name=${`v-${c.id}`} checked=${v[c.id].pass === true} onChange=${() => set(c.id, { pass: true })} /><span><b>Pass</b></span></label>
        <label class="choice" style=${{ padding: '.3rem .6rem' }}><input type="radio" name=${`v-${c.id}`} checked=${v[c.id].pass === false} onChange=${() => set(c.id, { pass: false })} /><span><b>Fail</b></span></label>
      </div>
      <textarea rows="2" aria-label=${`Reason for ${c.id}`} placeholder="A reason the contributor can act on (10+ characters)" value=${v[c.id].reason} onInput=${(e) => set(c.id, { reason: e.target.value })}></textarea>
    </fieldset>`)}
    <textarea rows="2" aria-label="Overall note (optional)" placeholder="Overall note (optional)" value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea>
    <div class="row">
      <${AsyncButton} class="primary" onClick=${() => onSubmit(criteria.map((c) => ({ criterionId: c.id, pass: v[c.id].pass, reason: v[c.id].reason })), notes)}>${submitLabel}<//>
      <button class="btn small ghost" onClick=${() => setV(Object.fromEntries(criteria.map((c) => [c.id, { pass: true, reason: 'Checked against the submitted files; it meets this criterion.' }])))}>Mark all pass (demo)</button>
    </div>
  </div>`;
}

function ReviewWorkspace({ t, me, now }) {
  const T = useT();
  const target = T.db.get('Tile', t.reviewOf.tileId);
  const sub = T.db.get('Submission', t.reviewOf.submissionId);
  const submit = async (verdicts, notes) => {
    const r = await act(() => T.api.submitPeerReview(me.id, t.id, { verdicts, notes }), 'Review submitted and paid.');
    if (r) navigate('#/work');
  };
  return html`<div>
    <${TileHeader} t=${t} now=${now} me=${me} />
    <div class="callout" style=${{ marginBottom: '1rem' }}>You’re reviewing someone else’s work on “${target.title}”. Why a person reviews it: ${t.reviewOf.reason.toLowerCase()}. Judge only the criteria below; reviews are paid when submitted.</div>
    <div class="split">
      <div class="stack">
        <div class="card"><h2>Their submission</h2>
          ${sub.notes ? html`<p class="small">“${sub.notes}”</p>` : ''}
          <ul class="filelist">${sub.files.map((f) => html`<${StoredFile} file=${f} />`)}</ul>
          <h3 style=${{ marginTop: '.8rem' }}>Automatic and LLM checks</h3><${ReviewResults} sub=${sub} />
        </div>
        <${SpecCard} t=${target} restricted=${T.db.get('Commission', t.commissionId).privacy === 'RESTRICTED'} />
      </div>
      <div class="card"><h2>Your verdicts</h2>
        ${t.status === 'CLAIMED' ? html`<${VerdictForm} criteria=${t.acceptanceCriteria} onSubmit=${submit} />` : html`<p class="small">This review is ${STATUS_LABEL[t.status].toLowerCase()}.</p>`}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- everyone else

function RequesterActions({ t, me }) {
  const T = useT();
  const [amount, setAmount] = useState(String(Math.round(t.payCents / 2) / 100));
  const rt = t.pendingReviewTileId && T.db.get('Tile', t.pendingReviewTileId);
  const cand = t.partialPayCandidate;
  return html`<div class="stack">
    ${t.status === 'IN_REVIEW' && rt ? html`<div class="card warn"><h2>Waiting for a peer review</h2>
      <p class="small">${rt.matchSummary && rt.matchSummary.eligible === 0 ? 'No eligible reviewer is available right now.' : `The review is ${STATUS_LABEL[rt.status].toLowerCase()}.`} You can review it yourself instead; the reviewer’s reserve is then refunded at the end.</p>
      <details style=${{ marginTop: '.5rem' }}><summary class="small">Review it myself</summary><div style=${{ marginTop: '.6rem' }}>
        <${VerdictForm} criteria=${rt.acceptanceCriteria} submitLabel="Record my verdict" onSubmit=${(verdicts) => act(() => T.api.requesterReview(me.id, t.id, verdicts), 'Your verdict was applied.')} />
      </div></details></div>` : ''}
    ${cand && !cand.paidCents ? html`<div class="card warn"><h2>Partial pay</h2>
      <p class="small">This tile failed its last round and reopened to others. If ${T.db.get('User', cand.contributorId)?.name}’s work is partly usable, you can pay for it (up to the full ${fmtMoney(t.payCents)}). It’s funded as a small top-up to escrow.</p>
      <div class="row" style=${{ marginTop: '.5rem' }}><label class="sr-only" for="pp">Amount in dollars</label><input id="pp" type="number" min="0.01" step="0.01" value=${amount} onInput=${(e) => setAmount(e.target.value)} style=${{ maxWidth: '8rem' }} />
        <${AsyncButton} class="primary" onClick=${() => act(() => T.api.grantPartialPay(me.id, t.id, Math.round(Number(amount) * 100)), 'Partial pay sent.')}>Pay $${amount}<//>
        <${AsyncButton} onClick=${() => act(() => T.api.declinePartialPay(me.id, t.id), 'Noted: no partial pay.')}>No partial pay<//></div></div>` : ''}
    ${!['ACCEPTED', 'CANCELLED'].includes(t.status) && !t.dynamic ? html`<label class="choice"><input type="checkbox" checked=${!!t.highStakes} onChange=${(e) => act(() => T.api.setHighStakes(me.id, t.id, e.target.checked), e.target.checked ? 'Flagged high stakes: a person will review it.' : 'No longer high stakes.')} /><span><b>High stakes</b><span>Always send this tile’s submissions to a human peer reviewer.</span></span></label>` : ''}
  </div>`;
}

export function TileView({ id }) {
  const T = useT();
  useDbVersion();
  const now = useNow(1000);
  const t = T.db.get('Tile', id);
  const me = currentUser(T);
  if (!t) return html`<div class="card"><${Empty} title="Tile not found"><a href="#/">Go home</a><//></div>`;
  const c = T.db.get('Commission', t.commissionId);
  const holder = me && t.claimedById === me.id && ['CLAIMED', 'REVISION', 'SUBMITTED', 'IN_REVIEW'].includes(t.status);
  if (holder && t.dynamic) return html`<${ReviewWorkspace} t=${t} me=${me} now=${now} />`;
  if (holder) return html`<${Workspace} t=${t} me=${me} now=${now} />`;
  const owner = me && (me.id === c.requesterId || me.isAdmin);
  const onPanel = me && T.db.filter('Dispute', (d) => d.tileIds.includes(id) && d.panel.includes(me.id)).length > 0;
  const worked = me && T.db.filter('Submission', (s) => s.tileId === id && s.contributorId === me.id).length > 0;
  const offer = me && T.db.find('Offer', (o) => o.tileId === id && o.contributorId === me.id && o.response === 'PENDING');
  const restricted = c.privacy === 'RESTRICTED';
  const fit = me?.isContributor && t.status === 'OPEN' ? explainFit(T.db, t.id, me.id, now) : null;
  return html`<div>
    <${TileHeader} t=${t} now=${now} me=${me} />
    ${offer ? html`<div class="card accent" style=${{ marginBottom: '1rem' }}>
      <div class="row-between"><div><h2>You have an offer for this tile</h2><p class="small">It closes in <b><${Countdown} until=${offer.expiresAt} now=${now} /></b>.${offer.note ? ` ${offer.note}` : ''}</p></div>
      <div class="row"><${AsyncButton} class="primary" onClick=${() => act(() => T.api.respondToOffer(me.id, offer.id, true), 'Claimed. Your brief is one click away.')}>Accept and claim<//>
        <${AsyncButton} onClick=${() => act(() => T.api.respondToOffer(me.id, offer.id, false), 'Declined. No penalty.')}>Decline<//></div></div>
    </div>` : ''}
    ${fit ? html`<div class=${`callout ${fit.eligible ? 'good' : ''}`} style=${{ marginBottom: '1rem' }}>${fit.eligible ? html`It’s on the open board and fits you. <${AsyncButton} class="small primary" onClick=${async () => { const r = await act(() => T.api.claimFromBoard(me.id, t.id), 'Claimed.'); if (r) navigate(`#/t/${t.id}`); }}>Claim it<//>` : `You can’t claim it: ${fit.reasons.map((r) => r.text).join('; ')}.`}</div>` : ''}
    ${t.claimedById && !holder ? html`<p class="small" style=${{ marginBottom: '1rem' }}>${t.status === 'ACCEPTED' ? 'Done by' : 'Held by'} <${UserName} user=${T.db.get('User', t.claimedById)} org=${false} />${t.acceptedAt ? ` · accepted ${ago(t.acceptedAt, now)}` : ''}</p>` : ''}
    <div class="split">
      <div class="stack">
        ${owner ? html`<${RequesterActions} t=${t} me=${me} />` : ''}
        ${owner || onPanel ? html`<${Submissions} t=${t} />` : worked ? html`<${Submissions} t=${t} onlyUserId=${me.id} />` : ''}
        <${CompetitionCard} t=${t} />
        <${CriteriaCard} t=${t} />
      </div>
      <div class="stack">
        <${SpecCard} t=${t} restricted=${restricted && !owner} />
        <${ResearchCard} t=${t} />
        <${History} t=${t} />
      </div>
    </div>
  </div>`;
}

export { truncate, RULES };
