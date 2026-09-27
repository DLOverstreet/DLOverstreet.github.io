// The guided demo: a checklist that follows your first commission from posting to
// sign-off, and tells you which persona to become at each step.
import { html, useState } from '../../vendor/preact.js';
import { useT, useDbVersion, navigate, currentUser, setPersona, toast } from './state.js';

function stepsFor(T) {
  const db = T.db;
  const g = db.meta.guide || {};
  const me = currentUser(T);
  const c = g.commissionId && db.get('Commission', g.commissionId);
  const human = new Set(db.meta.humanPersonaIds || []);
  const tiles = c ? db.filter('Tile', (t) => t.commissionId === c.id) : [];
  const myTile = tiles.find((t) => !t.dynamic && t.claimedById && human.has(t.claimedById) && !db.get('User', t.claimedById).isRequester);
  const worker = myTile && db.get('User', myTile.claimedById);
  const offer = c && !myTile && db.find('Offer', (o) => o.commissionId === c.id && o.response === 'PENDING' && !db.get('Tile', o.tileId).dynamic);
  const offeredTo = offer && db.get('User', offer.contributorId);
  const past = (s) => c && ['ACTIVE', 'ASSEMBLING', 'DELIVERED', 'DISPUTED', 'ACCEPTED'].includes(c.status) && (s === 'ACTIVE' || c.status !== 'ACTIVE');
  const brief = myTile && db.find('Brief', (b) => b.tileId === myTile.id && b.userId === myTile.claimedById);
  const submitted = myTile && db.find('Submission', (s) => s.tileId === myTile.id && s.contributorId === myTile.claimedById);
  const be = (id, to) => () => { setPersona(T, id); navigate(to); toast(`You are now ${db.get('User', id).name}.`, 'ok'); };
  const requester = c ? c.requesterId : 'usr_tom';
  const waitingOnYou = c && me && !me.isRequester ? db.count('Offer', (o) => o.commissionId === c.id && o.response === 'PENDING' && o.contributorId === me.id) : 0;
  return [
    { done: !!c || !!me?.isRequester, text: 'Become a requester', hint: 'Tom runs outreach for a public library.', go: me?.isRequester ? null : be('usr_tom', '#/post?example=flyer'), goLabel: 'Be Tom' },
    { done: !!c, text: 'Post a commission', hint: 'The example is filled in for you: a flyer and FAQ to translate.', go: () => navigate('#/post?example=flyer') },
    { done: !!c && (c.clarifications.answeredAt || c.status !== 'SCOPING'), text: 'Answer the scoping questions', hint: '“Use all suggested answers” is fine.', go: c && (() => { if (me?.id !== requester) setPersona(T, requester); navigate(`#/c/${c.id}/plan`); }) },
    { done: past('ACTIVE'), text: 'Review the plan and fund it', hint: 'See every tile’s price, the 10% fee and the review reserve. Try editing a tile first.', go: c && (() => { if (me?.id !== requester) setPersona(T, requester); navigate(`#/c/${c.id}/plan`); }) },
    { done: !!myTile, text: offeredTo ? `Become ${offeredTo.name} and accept the offer` : 'Become a contributor with an offer', hint: offeredTo ? `The Matcher offered “${db.get('Tile', offer.tileId).title}” to ${offeredTo.name.split(' ')[0]}. The crowd waits until you’ve claimed a tile.` : 'Offers go out when the plan is funded.', go: offeredTo && be(offeredTo.id, `#/t/${offer.tileId}`), goLabel: offeredTo ? `Be ${offeredTo.name.split(' ')[0]}` : null },
    { done: !!brief, text: 'Have your model write your brief', hint: 'Steps in your style and language, with a checklist tied to the criteria.', go: myTile && (() => { if (me?.id !== worker.id) setPersona(T, worker.id); navigate(`#/t/${myTile.id}`); }) },
    { done: !!submitted, text: 'Submit your work', hint: '“Fill with sample work” makes files that pass the automatic checks. Or write your own.', go: myTile && (() => { if (me?.id !== worker.id) setPersona(T, worker.id); navigate(`#/t/${myTile.id}`); }) },
    { done: myTile?.status === 'ACCEPTED', text: myTile?.status === 'REVISION' ? 'Fix it and resubmit' : 'Watch it get checked and paid', hint: myTile?.status === 'REVISION'
      ? 'A check sent it back. The failed criteria say why; fix those parts (or start from your last round) and resubmit.'
      : 'Automatic checks, the LLM Reviewer, then a peer reviewer for a newcomer’s first tiles. Pay lands the moment it’s accepted.', go: myTile && (() => navigate(myTile.status === 'ACCEPTED' ? '#/earnings' : `#/t/${myTile.id}`)) },
    { done: c?.status === 'ACCEPTED', text: 'Sign off as the requester', hint: waitingOnYou
      ? `${me.name.split(' ')[0]} has ${waitingOnYou} more offer${waitingOnYou > 1 ? 's' : ''} on this commission. Take ${waitingOnYou > 1 ? 'them' : 'it'}, or switch to ${db.get('User', requester).name.split(' ')[0]} and the crowd will finish the rest.`
      : 'The crowd finishes the other tiles; then accept the delivery and see the credits manifest.', go: c && (() => { setPersona(T, requester); navigate(`#/c/${c.id}/${c.status === 'DELIVERED' || c.status === 'ACCEPTED' ? 'delivery' : 'progress'}`); }) },
    { done: !!g.exported, text: 'Export a signed reputation record', hint: 'Yours to take anywhere; verify it on the Verify page.', go: worker && (() => { setPersona(T, worker.id); navigate('#/reputation'); }) },
  ];
}

export function Guide() {
  const T = useT();
  useDbVersion();
  const [all, setAll] = useState(false);
  const g = T.db.meta.guide || {};
  if (!g.startedAt || g.dismissed) return null;
  const steps = stepsFor(T);
  const current = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const setG = (patch) => T.db.tx((tx) => tx.setMeta({ guide: { ...(tx.meta.guide || {}), ...patch } }));
  if (g.minimized) {
    return html`<div class="guide-mini"><button class="btn primary" onClick=${() => setG({ minimized: false })}>Guide · ${current < 0 ? 'done' : `step ${current + 1} of ${steps.length}`}</button></div>`;
  }
  const s = steps[current];
  return html`<aside class="guide" aria-label="Guided demo">
    <div class="guide-head"><b>${current < 0 ? 'You ran the whole loop 🎉' : `Guided demo · step ${current + 1} of ${steps.length}`}</b><span><button onClick=${() => setG({ minimized: true })}>Minimize</button> · <button onClick=${() => setG({ dismissed: true })}>Close</button></span></div>
    <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax=${steps.length} aria-valuenow=${doneCount}><div style=${{ width: `${(doneCount / steps.length) * 100}%` }}></div></div>
    ${s ? html`<div class="now"><b>${s.text}</b><p>${s.hint}</p>${s.go ? html`<button class="btn small primary" onClick=${s.go}>${s.goLabel || 'Go'}</button>` : ''}</div>`
      : html`<div class="now"><p>Posted, scoped, planned, funded, claimed, briefed, submitted, verified, paid, assembled, signed off and exported. Try the dashboard commission, dispute a delivery, or connect Claude in Settings.</p></div>`}
    <button class="more" aria-expanded=${all} onClick=${() => setAll(!all)}>${all ? 'Hide steps' : 'All steps'}</button>
    ${all ? html`<ol>${steps.map((x, i) => html`<li class=${x.done ? 'done' : i === current ? 'current' : ''}><span class="ck" aria-hidden="true">${x.done ? '✓' : ''}</span><span>${x.text}<span class="sr-only">${x.done ? ' (done)' : ''}</span></span></li>`)}</ol>` : ''}
  </aside>`;
}
