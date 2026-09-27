// Assembly and delivery: the Assembler merges accepted outputs into a deliverable with a
// credits manifest, the requester accepts or disputes named tiles (silence for seven days
// counts as acceptance), and a three-person panel settles disputes.
import { UserError, must, getUser, tilesOf, transitionTile, transitionCommission, postLedger, postReputation, commissionWorkers, platformUser, upstreamIds } from './core.js';
import { loadFileTexts, excerptFor } from './files.js';
import { AGENTS } from '../agents/index.js';
import { runAgent } from '../llm/run-agent.js';
import { topoSort } from '../domain/graph.js';
import { summarizeReputation } from '../domain/reputation.js';
import { reviewPayCents, feeCents } from '../domain/pricing.js';
import { fundingEntry } from '../domain/ledger.js';
import { config } from '../domain/config.js';
import { createZip } from '../lib/zip.js';
import { textToBytes, fmtMoney, canonicalJson } from '../lib/util.js';

function deliveredTiles(db, commissionId) {
  const tiles = tilesOf(db, commissionId).filter((t) => t.status === 'ACCEPTED' && !t.dynamic);
  const keyById = new Map(tiles.map((t) => [t.id, t.key]));
  const order = topoSort(tiles.map((t) => ({ key: t.key, dependsOn: upstreamIds(db, t.id).map((id) => keyById.get(id)).filter(Boolean) })));
  return order.map((k) => tiles.find((t) => t.key === k));
}

export async function runAssembleJob(T, { commissionId }) {
  const c = T.db.get('Commission', commissionId);
  if (!c || c.status !== 'ASSEMBLING') return;
  const restricted = c.privacy === 'RESTRICTED';
  const tiles = deliveredTiles(T.db, commissionId);
  const inputTiles = [];
  for (const t of tiles) {
    const sub = T.db.get('Submission', t.acceptedSubmissionId);
    const files = await loadFileTexts(T, sub?.files || [], { maxChars: 20000 });
    const u = T.db.get('User', t.claimedById);
    inputTiles.push({
      key: t.key, title: t.title, kind: t.kind, contributor: { id: u.id, name: u.name },
      notes: sub?.notes || '', files: files.map((f) => ({ name: f.name, excerpt: excerptFor(f, { restricted, max: 3000 }) })),
    });
  }
  const input = { commission: { title: c.title, goal: c.goal }, tiles: inputTiles };
  const { output, model } = await runAgent({ agent: AGENTS.assembler, input, route: T.llm.platform('heavy'), log: T.log, meta: { commissionId } });

  // Integration checks run on the real files, not on the model's word.
  const gaps = [...output.gaps];
  const conflicts = [...output.conflicts];
  for (const it of inputTiles) if (!it.files.length && !gaps.some((g) => g.includes(it.key))) gaps.push(`${it.title} (${it.key}) delivered no files.`);
  const reviewers = tilesOf(T.db, commissionId).filter((t) => t.dynamic && t.status === 'ACCEPTED').map((t) => ({
    tileKey: t.key, contributorId: t.claimedById, files: [], role: `Peer review of ${T.db.get('Tile', t.reviewOf.tileId)?.title || 'a tile'}`,
  }));
  const manifest = [...output.manifest, ...reviewers].map((m) => ({ ...m, contributorName: T.db.get('User', m.contributorId)?.name || m.contributorId, tileTitle: tilesOf(T.db, commissionId).find((t) => t.key === m.tileKey)?.title || m.tileKey }));
  const report = renderReport(c, output, manifest, gaps, conflicts);
  const key = `deliverables/${commissionId}/${Date.now().toString(36)}/deliverable.md`;
  await T.blobs.put(key, textToBytes(report));
  T.db.tx((tx) => {
    const cur = tx.get('Commission', commissionId);
    if (cur.status !== 'ASSEMBLING') return;
    const history = [...(cur.delivery?.history || []), ...(cur.delivery ? [{ deliveredAt: cur.deliveredAt, deliverableKey: cur.deliverableKey }] : [])];
    tx.update('Commission', commissionId, {
      deliverableKey: key,
      delivery: { title: output.title, summary: output.summary, sections: output.sections, manifest, gaps, conflicts, model, history },
    });
    transitionCommission(tx, commissionId, 'DELIVERED', 'assembler', { note: gaps.length || conflicts.length ? `${gaps.length} gap(s), ${conflicts.length} conflict(s) flagged` : 'Assembled' });
  });
}

function renderReport(c, out, manifest, gaps, conflicts) {
  const lines = [`# ${out.title}`, '', out.summary, ''];
  for (const s of out.sections) lines.push(`## ${s.heading}`, '', s.body, '', `*From tile${s.tileKeys.length > 1 ? 's' : ''}: ${s.tileKeys.join(', ')}*`, '');
  if (gaps.length || conflicts.length) {
    lines.push('## Flagged for the requester', '');
    for (const g of gaps) lines.push(`- Gap: ${g}`);
    for (const x of conflicts) lines.push(`- Conflict: ${x}`);
    lines.push('');
  }
  lines.push('## Credits', '', '| Tile | Contributor | Role | Files |', '| --- | --- | --- | --- |');
  for (const m of manifest) lines.push(`| ${m.tileTitle} | ${m.contributorName} | ${m.role} | ${m.files.join(', ') || '—'} |`);
  lines.push('', `Commissioned by ${c.title ? 'the requester' : ''} through Tessera. Every contributor above was paid when their tile was accepted.`, '');
  return lines.join('\n');
}

/** The deliverable as a ZIP: the assembled report, the manifest and every accepted file by tile. */
export async function buildDeliverableZip(T, commissionId) {
  const c = must(T.db.get('Commission', commissionId), 'Commission not found.');
  if (!c.deliverableKey) throw new UserError('Nothing has been delivered yet.');
  const files = [];
  const report = await T.blobs.get(c.deliverableKey);
  if (report) files.push({ name: 'deliverable.md', data: report });
  files.push({ name: 'credits.json', data: textToBytes(JSON.stringify({ commission: c.title, deliveredAt: new Date(c.deliveredAt).toISOString(), manifest: c.delivery.manifest }, null, 2)) });
  for (const t of deliveredTiles(T.db, commissionId)) {
    const sub = T.db.get('Submission', t.acceptedSubmissionId);
    for (const f of sub?.files || []) {
      const bytes = await T.blobs.get(f.key);
      if (bytes) files.push({ name: `tiles/${t.key}/${f.name}`, data: bytes });
    }
  }
  return createZip(files);
}

function requireRequester(tx, commissionId, actorId) {
  const c = must(tx.get('Commission', commissionId), 'Commission not found.');
  if (c.requesterId !== actorId) throw new UserError('Only the requester can sign off on this commission.');
  return c;
}

export function acceptDelivery(T, actorId, commissionId) {
  return T.db.tx((tx) => {
    const c = requireRequester(tx, commissionId, actorId);
    if (c.status !== 'DELIVERED') throw new UserError('There is no delivery waiting for sign-off.');
    return transitionCommission(tx, commissionId, 'ACCEPTED', actorId, { note: 'Signed off by the requester' });
  }, { actor: actorId });
}

/** Picks three panelists with the most reputation in the disputed skills who never worked on the commission. */
export function pickPanel(db, commissionId, tileIds, now) {
  const c = db.get('Commission', commissionId);
  const workers = commissionWorkers(db, commissionId);
  const tags = [...new Set(tileIds.flatMap((id) => db.get('Tile', id)?.skillTags || []))];
  const events = db.all('ReputationEvent');
  const ranked = db.filter('User', (u) => u.isContributor && u.id !== c.requesterId && !workers.has(u.id)).map((u) => {
    const rep = summarizeReputation(events, u.id, now);
    const skillScore = tags.reduce((n, t) => n + (rep.skills[t]?.accepted || 0), 0);
    return { id: u.id, skillScore, total: rep.totalAccepted };
  }).sort((a, b) => b.skillScore - a.skillScore || b.total - a.total || a.id.localeCompare(b.id));
  return ranked.slice(0, config.disputePanelSize).map((r) => r.id);
}

export function disputeDelivery(T, actorId, commissionId, { tileIds, reason }) {
  return T.db.tx((tx) => {
    const c = requireRequester(tx, commissionId, actorId);
    if (c.status !== 'DELIVERED') throw new UserError('Only a delivered commission can be disputed.');
    const ids = [...new Set(tileIds || [])];
    if (!ids.length) throw new UserError('Name at least one tile you are disputing.');
    for (const id of ids) {
      const t = tx.get('Tile', id);
      if (!t || t.commissionId !== commissionId || t.status !== 'ACCEPTED' || t.dynamic) throw new UserError('You can only dispute accepted tiles of this commission.');
    }
    if (String(reason || '').trim().length < 20) throw new UserError('Explain what is wrong in at least a sentence (20+ characters); the panel reads it.');
    const panel = pickPanel(tx, commissionId, ids, tx.now());
    if (panel.length < config.disputePanelSize) throw new UserError('Not enough independent contributors are available to form a panel.');
    const d = tx.insert('Dispute', { commissionId, tileIds: ids, reason: String(reason).trim(), panel, votes: {}, status: 'OPEN', outcome: null });
    transitionCommission(tx, commissionId, 'DISPUTED', actorId, { note: `${ids.length} tile(s) disputed` });
    return d;
  }, { actor: actorId });
}

export function castPanelVote(T, actorId, disputeId, vote, note = '') {
  if (!['UPHOLD', 'REOPEN'].includes(vote)) throw new UserError('Vote to uphold the delivery or reopen the tiles.');
  return T.db.tx((tx) => {
    const d = must(tx.get('Dispute', disputeId), 'Dispute not found.');
    if (d.status !== 'OPEN') throw new UserError('This dispute is settled.');
    if (!d.panel.includes(actorId)) throw new UserError('You are not on this panel.');
    if (d.votes[actorId]) throw new UserError('You have already voted.');
    const votes = { ...d.votes, [actorId]: { vote, note: String(note).slice(0, 1000), at: tx.now() } };
    tx.update('Dispute', disputeId, { votes });
    const tally = Object.values(votes).reduce((n, v) => ({ ...n, [v.vote]: (n[v.vote] || 0) + 1 }), {});
    const majority = Math.floor(config.disputePanelSize / 2) + 1;
    if ((tally.UPHOLD || 0) >= majority) {
      tx.update('Dispute', disputeId, { status: 'RESOLVED', outcome: 'UPHOLD', resolvedAt: tx.now() });
      transitionCommission(tx, d.commissionId, 'ACCEPTED', 'panel', { note: 'Dispute panel upheld the delivery' });
    } else if ((tally.REOPEN || 0) >= majority) {
      tx.update('Dispute', disputeId, { status: 'RESOLVED', outcome: 'REOPEN', resolvedAt: tx.now() });
      reopenForRework(tx, d);
    }
    return tx.get('Dispute', disputeId);
  }, { actor: actorId });
}

/**
 * Accepted tiles stay accepted (their pay is already released). The panel's decision
 * creates rework tiles instead, funded by the platform's quality guarantee, and records
 * a reputation event against the original work.
 */
function reopenForRework(tx, dispute) {
  const c = tx.get('Commission', dispute.commissionId);
  const platform = platformUser(tx);
  const rework = [];
  for (const id of dispute.tileIds) {
    const t = tx.get('Tile', id);
    postReputation(tx, { userId: t.claimedById, tags: t.skillTags, reason: 'DISPUTE_REOPENED', tileId: t.id, tier: t.tier });
    const n = tilesOf(tx, c.id).filter((x) => x.reworkOf === t.id).length + 1;
    rework.push(tx.insert('Tile', {
      commissionId: c.id, key: `${t.key}-rework-${n}`, kind: t.kind, title: `Rework: ${t.title}`.slice(0, 80),
      spec: `${t.spec}\n\nRework requested by a dispute panel. The requester said: "${dispute.reason}". The previous accepted output is attached as an input; fix what the requester describes.`,
      deliverableFormat: t.deliverableFormat, acceptanceCriteria: t.acceptanceCriteria, skillTags: t.skillTags, tier: t.tier,
      estMinutes: t.estMinutes, payCents: t.payCents, rush: t.rush, languages: t.languages || [], sensitiveInputs: t.sensitiveInputs || [],
      status: 'DRAFT', claimedById: null, claimExpiresAt: null, revisionCount: 0, highStakes: true, dynamic: false, reviewOf: null,
      reworkOf: t.id, excludedUserIds: [],
    }));
  }
  const total = rework.reduce((n, t) => {
    const reserve = t.kind === 'REVIEW' ? 0 : reviewPayCents(t.tier, { rush: !!t.rush });
    return n + t.payCents + feeCents(t.payCents) + reserve + feeCents(reserve);
  }, 0);
  postLedger(tx, [fundingEntry({ commissionId: c.id, funderId: platform.id, amountCents: total, memo: `Platform quality guarantee: rework of ${rework.length} tile(s) (${fmtMoney(total)})` })]);
  transitionCommission(tx, c.id, 'ACTIVE', 'panel', { note: `Panel reopened ${rework.length} tile(s) as rework` });
  for (const t of rework) transitionTile(tx, t.id, 'OPEN', 'panel', { note: 'Rework after dispute' });
}

/** Stable JSON of the manifest, for tests and exports. */
export function manifestJson(c) {
  return canonicalJson(c.delivery?.manifest || []);
}

export { getUser };
