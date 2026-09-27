import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTessera } from '../helpers/harness.js';
import { createMemoryWorldStore } from '../../src/storage/stores.js';
import { commissionBalance, userEarnings, PAYOUT_TYPES } from '../../src/domain/ledger.js';
import { summarizeReputation } from '../../src/domain/reputation.js';
import { generateSampleWork } from '../../src/agents/mock/sample-work.js';
import { explainFit } from '../../src/services/market.js';
import { SAMPLE_COMMISSIONS } from '../../src/services/seed.js';
import { DAY } from '../../src/lib/util.js';

async function postAndPlan(T, who = 'usr_tom', sample = SAMPLE_COMMISSIONS.flyer, extra = {}) {
  const c = await T.api.postCommission(who, { ...sample, deadline: T.clock.now() + sample.days * DAY, ...extra });
  await T.worker.drain();
  const cur = T.db.get('Commission', c.id);
  T.api.answerScoping(who, c.id, Object.fromEntries(cur.clarifications.questions.map((q) => [q.id, q.suggestedAnswer])));
  await T.worker.drain();
  assert.equal(T.db.get('Commission', c.id).status, 'PLANNED');
  return c.id;
}

async function playUntil(T, pred, rounds = 60) {
  for (let i = 0; i < rounds && !pred(); i++) {
    await T.worker.drain({ crowd: true });
    if (!pred()) T.clock.advance(60 * 60 * 1000);
  }
  assert.ok(pred(), 'condition never reached');
}

test('the end-to-end loop reaches ACCEPTED on the mock provider, and the manifest names everyone', async () => {
  const T = await makeTessera();
  const id = await postAndPlan(T);
  T.api.fundCommission('usr_tom', id);
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  T.api.acceptDelivery('usr_tom', id);
  const c = T.db.get('Commission', id);
  assert.equal(c.status, 'ACCEPTED');
  assert.equal(commissionBalance(T.db.all('LedgerEntry'), id), 0);
  const tiles = T.db.filter('Tile', (t) => t.commissionId === id && t.status === 'ACCEPTED');
  for (const t of tiles) assert.ok(c.delivery.manifest.some((m) => m.tileKey === t.key && m.contributorId === t.claimedById));
  const zip = await T.api.buildDeliverableZip(id);
  assert.ok(zip.length > 500);
});

test('a deliberately failing submission loops twice, then reopens to others; partial pay is possible', async () => {
  const T = await makeTessera({ crowd: false });
  const id = await postAndPlan(T);
  T.api.fundCommission('usr_tom', id);
  await T.worker.drain();
  const tile = T.db.find('Tile', (t) => t.commissionId === id && t.status === 'OFFERED');
  const offer = T.db.find('Offer', (o) => o.tileId === tile.id && o.response === 'PENDING');
  const who = offer.contributorId;
  T.api.respondToOffer(who, offer.id, true);
  const statuses = [];
  for (let round = 1; round <= 3; round++) {
    const work = generateSampleWork(T.db.get('Tile', tile.id), { quality: 'bad', seed: `r${round}` });
    await T.api.submitWork(who, tile.id, { ...work, notes: `${work.notes} #fail` });
    await T.worker.drain();
    statuses.push(T.db.get('Tile', tile.id).status);
  }
  assert.deepEqual(statuses.slice(0, 2), ['REVISION', 'REVISION']);
  assert.ok(['OPEN', 'OFFERED'].includes(statuses[2]), 'reopened, and possibly already re-offered to others');
  assert.ok(T.db.find('StatusChange', (x) => x.entityId === tile.id && x.from === 'IN_REVIEW' && x.to === 'OPEN'));
  const t = T.db.get('Tile', tile.id);
  assert.ok(t.excludedUserIds.includes(who));
  assert.equal(t.claimedById, null);
  assert.equal(T.db.count('Submission', (s) => s.tileId === tile.id), 3);
  assert.equal(T.db.count('ReputationEvent', (e) => e.userId === who && e.reason === 'REVIEW_FAILED' && e.tileId === tile.id), 3 * tile.skillTags.length);
  assert.equal(explainFit(T.db, tile.id, who, T.clock.now()).eligible, false, 'the previous contributor is not re-offered the tile');
  const before = userEarnings(T.db.all('LedgerEntry'), who);
  T.api.grantPartialPay('usr_tom', tile.id, 500);
  assert.equal(userEarnings(T.db.all('LedgerEntry'), who) - before, 500);
  assert.throws(() => T.api.grantPartialPay('usr_tom', tile.id, 500), /no reopened submission/);
  T.db.tx((tx) => tx.setMeta({ settings: { ...T.db.meta.settings, crowd: true } }));
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  T.api.acceptDelivery('usr_tom', id);
  assert.equal(commissionBalance(T.db.all('LedgerEntry'), id), 0);
});

test('earnings and reputation recompute exactly from the event tables', async () => {
  const T = await makeTessera();
  const id = await postAndPlan(T, 'usr_marisol', SAMPLE_COMMISSIONS.survey);
  T.api.fundCommission('usr_marisol', id);
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  const now = T.clock.now();
  const ledger = T.db.all('LedgerEntry');
  // Earnings: the ledger agrees with what accepted tiles and partial payments say was paid.
  for (const u of T.db.filter('User', (x) => x.isContributor)) {
    const fromTiles = T.db.filter('Tile', (t) => t.status === 'ACCEPTED' && t.claimedById === u.id).reduce((n, t) => n + t.payCents, 0);
    const partial = ledger.filter((e) => e.type === 'PARTIAL_PAYOUT' && e.userId === u.id).reduce((n, e) => n - e.amountCents, 0);
    assert.equal(userEarnings(ledger, u.id), fromTiles + partial, u.name);
  }
  assert.ok(ledger.some((e) => PAYOUT_TYPES.includes(e.type)));
  // Reputation and earnings from a reloaded copy of the tables match exactly.
  const store = createMemoryWorldStore(T.db.snapshot());
  const copy = await makeTessera({ worldStore: store });
  for (const u of T.db.filter('User', (x) => x.isContributor)) {
    assert.deepEqual(summarizeReputation(copy.db.all('ReputationEvent'), u.id, now), summarizeReputation(T.db.all('ReputationEvent'), u.id, now));
    assert.equal(userEarnings(copy.db.all('LedgerEntry'), u.id), userEarnings(ledger, u.id));
  }
  // Reputation counts match accepted tiles tag by tag.
  for (const u of T.db.filter('User', (x) => x.isContributor)) {
    const rep = summarizeReputation(T.db.all('ReputationEvent'), u.id, now);
    const expected = {};
    for (const t of T.db.filter('Tile', (x) => x.status === 'ACCEPTED' && x.claimedById === u.id)) {
      const tags = t.reviewOf ? T.db.get('Tile', t.reviewOf.tileId).skillTags : t.skillTags;
      for (const tag of tags) expected[tag] = (expected[tag] || 0) + 1;
    }
    for (const [tag, n] of Object.entries(expected)) assert.equal(rep.skills[tag].accepted, n, `${u.name} ${tag}`);
  }
});

test('offers lapse to the open board; a first expired claim has no penalty, a second one counts', async () => {
  const T = await makeTessera({ crowd: false });
  const id = await postAndPlan(T);
  T.api.fundCommission('usr_tom', id);
  await T.worker.drain();
  const tile = T.db.find('Tile', (t) => t.commissionId === id && t.status === 'OFFERED');
  T.clock.advance(2 * 60 * 60 * 1000 + 1);
  await T.worker.drain();
  assert.equal(T.db.get('Tile', tile.id).status, 'OPEN');
  assert.ok(T.db.filter('Offer', (o) => o.tileId === tile.id).every((o) => o.response === 'EXPIRED'));
  const who = T.db.filter('Offer', (o) => o.tileId === tile.id)[0].contributorId;
  T.api.claimFromBoard(who, tile.id);
  T.clock.advance(49 * 60 * 60 * 1000);
  await T.worker.drain();
  assert.equal(T.db.get('Tile', tile.id).status, 'OPEN');
  const first = T.db.filter('ReputationEvent', (e) => e.userId === who && e.tileId === tile.id);
  assert.deepEqual(first.map((e) => e.reason), ['CLAIM_EXPIRED_FIRST']);
  const other = T.db.find('Tile', (t) => t.commissionId === id && ['OPEN', 'OFFERED'].includes(t.status) && t.id !== tile.id && explainFit(T.db, t.id, who, T.clock.now()).eligible);
  if (other) {
    T.api.claimFromBoard(who, other.id);
    T.clock.advance(49 * 60 * 60 * 1000);
    await T.worker.drain();
    assert.ok(T.db.filter('ReputationEvent', (e) => e.userId === who && e.reason === 'CLAIM_EXPIRED').length >= 1);
  }
});

test('silence for seven days counts as acceptance', async () => {
  const T = await makeTessera();
  const id = await postAndPlan(T);
  T.api.fundCommission('usr_tom', id);
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  T.clock.advance(6 * DAY);
  await T.worker.drain();
  assert.equal(T.db.get('Commission', id).status, 'DELIVERED');
  T.clock.advance(DAY + 1000);
  await T.worker.drain();
  assert.equal(T.db.get('Commission', id).status, 'ACCEPTED');
  assert.equal(commissionBalance(T.db.all('LedgerEntry'), id), 0);
});

test('a dispute panel can reopen tiles as platform-funded rework, and the ledger still nets to zero', async () => {
  const T = await makeTessera();
  const id = await postAndPlan(T);
  T.api.fundCommission('usr_tom', id);
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  const disputed = T.db.find('Tile', (t) => t.commissionId === id && t.status === 'ACCEPTED' && !t.dynamic);
  const d = T.api.disputeDelivery('usr_tom', id, { tileIds: [disputed.id], reason: 'The translation is missing two of the FAQ answers and has a wrong phone number.' });
  assert.equal(d.panel.length, 3);
  for (const p of d.panel) assert.ok(!T.db.filter('Submission', (s) => s.commissionId === id).some((s) => s.contributorId === p && !T.db.get('Tile', s.tileId).dynamic));
  T.api.castPanelVote(d.panel[0], d.id, 'REOPEN');
  T.api.castPanelVote(d.panel[1], d.id, 'REOPEN');
  assert.equal(T.db.get('Commission', id).status, 'ACTIVE');
  const rework = T.db.find('Tile', (t) => t.reworkOf === disputed.id);
  assert.ok(rework);
  assert.ok(T.db.all('LedgerEntry').some((e) => e.type === 'ESCROW_FUND' && e.userId === 'usr_admin' && e.commissionId === id));
  assert.ok(T.db.all('ReputationEvent').some((e) => e.reason === 'DISPUTE_REOPENED' && e.tileId === disputed.id));
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  T.api.acceptDelivery('usr_tom', id);
  assert.equal(commissionBalance(T.db.all('LedgerEntry'), id), 0);
});

test('the crowd finishes only work it claimed, and falls back to idle personas you played', async () => {
  const T = await makeTessera();
  const id = await postAndPlan(T);
  T.api.fundCommission('usr_tom', id);
  await T.worker.drain();
  const tile = T.db.find('Tile', (t) => t.commissionId === id && t.status === 'OFFERED');
  const offer = T.db.find('Offer', (o) => o.tileId === tile.id && o.response === 'PENDING');
  T.api.respondToOffer(offer.contributorId, offer.id, true); // you claim it yourself
  // Then you switch to the requester, having played every contributor at some point.
  const everyone = T.db.filter('User', (u) => u.isContributor).map((u) => u.id);
  T.db.tx((tx) => tx.setMeta({ activePersonaId: 'usr_tom', humanPersonaIds: ['usr_tom', ...everyone] }));
  for (let i = 0; i < 4; i++) await T.worker.drain({ crowd: true });
  assert.equal(T.db.get('Tile', tile.id).status, 'CLAIMED', 'the crowd never submits a tile you claimed');
  assert.equal(T.db.get('Tile', tile.id).crowdClaimed, false);
  await T.api.submitWork(offer.contributorId, tile.id, generateSampleWork(T.db.get('Tile', tile.id)));
  await playUntil(T, () => T.db.get('Commission', id).status === 'DELIVERED');
  const others = T.db.filter('Tile', (t) => t.commissionId === id && t.id !== tile.id && t.status === 'ACCEPTED');
  assert.ok(others.length >= 4);
  assert.ok(others.every((t) => t.crowdClaimed), 'everything else was picked up by the crowd on behalf of idle personas');
});
