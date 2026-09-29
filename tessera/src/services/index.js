// createTessera wires the database, clock, storage, LLM router, worker and crowd together.
// The browser app and the Node tests both start here; only the storage adapters differ.
import { createDb } from '../db/db.js';
import { emptyWorld, WORLD_VERSION } from '../db/schema.js';
import { createClock } from '../lib/clock.js';
import { createMockProvider } from '../llm/mock.js';
import { createLlmRouter } from '../llm/router.js';
import { mockBrains } from '../agents/mock/index.js';
import { createWorker } from '../jobs/worker.js';
import { createCrowd } from './crowd.js';
import { createSwarm, runWithAgents, pauseSwarmJob, resumeSwarmJob } from './swarm.js';
import { seedWorld } from './seed.js';
import { config } from '../domain/config.js';
import * as commissions from './commissions.js';
import * as market from './market.js';
import * as work from './work.js';
import * as delivery from './delivery.js';
import * as profiles from './profiles.js';

const API = {
  postCommission: commissions.postCommission,
  answerScoping: commissions.answerScoping,
  updateDraftTile: commissions.updateDraftTile,
  addDraftTile: commissions.addDraftTile,
  deleteDraftTile: commissions.deleteDraftTile,
  redecompose: commissions.redecompose,
  replacePlan: commissions.replacePlan,
  applyPlanFix: commissions.applyPlanFix,
  breakdown: (T, job, opts) => commissions.breakdown(T, job, opts),
  fundCommission: commissions.fundCommission,
  setHighStakes: commissions.setHighStakes,
  cancelCommission: commissions.cancelCommission,
  respondToOffer: market.respondToOffer,
  claimFromBoard: market.claimFromBoard,
  releaseClaim: market.releaseClaim,
  generateBrief: work.generateBrief,
  askCopilot: work.askCopilot,
  submitWork: work.submitWork,
  submitPeerReview: work.submitPeerReview,
  requesterReview: work.requesterReview,
  grantPartialPay: work.grantPartialPay,
  declinePartialPay: work.declinePartialPay,
  acceptDelivery: delivery.acceptDelivery,
  disputeDelivery: delivery.disputeDelivery,
  castPanelVote: delivery.castPanelVote,
  buildDeliverableZip: delivery.buildDeliverableZip,
  runWithAgents, pauseSwarmJob, resumeSwarmJob,
  updateProfile: profiles.updateProfile,
  exportReputation: profiles.exportReputation,
  ensureSigningKey: profiles.ensureSigningKey,
};

/**
 * @param {object} o
 * @param {{load: Function, save: Function, clear?: Function, kind?: string}} o.worldStore
 * @param {any} o.blobs
 * @param {any} o.keystore
 * @param {any} o.secrets
 * @param {string} [o.seed] id seed for a fresh world
 * @param {number|null} [o.frozenAt] freeze a fresh world's clock at this instant
 * @param {boolean} [o.autoSeed]
 * @param {object} [o.fixtures] recorded LLM fixtures for the mock
 * @param {object} [o.providerFactory] provider constructors (tests inject fakes)
 * @param {boolean} [o.debug]
 * @param {number} [o.persistDelayMs]
 * @param {boolean} [o.crowd] start with the crowd simulation on or off
 * @param {number} [o.swarmPaceMs] with the mock, how long each swarm task waits, so the swarm is watchable
 * @returns {Promise<any>}
 */
export async function createTessera({ worldStore, blobs, keystore, secrets, seed = 'tessera', frozenAt = null, autoSeed = true, fixtures = {}, providerFactory = {}, debug = false, persistDelayMs = 200, crowd = undefined, swarmPaceMs = 0 }) {
  let world = await worldStore.load();
  const fresh = !world || world.version !== WORLD_VERSION;
  if (fresh) world = emptyWorld({ seed, now: frozenAt ?? Date.now() });
  const clock = createClock(world.meta.clock);
  const db = createDb(world, clock);
  const mock = createMockProvider({ brains: mockBrains, fixtures });
  const llm = createLlmRouter({ getSettings: () => db.meta.settings.llm, secrets, mock, providerFactory });
  /** @type {any} */
  const T = { db, clock, blobs, keystore, secrets, llm, mock, debug };
  T.log = (row) => db.tx((tx) => tx.insert('AgentRun', row));
  if (!fresh) migrateSettings(db);
  T.api = Object.fromEntries(Object.entries(API).map(([name, fn]) => [name, (...args) => fn(T, ...args)]));
  T.crowd = createCrowd(T);
  T.swarm = createSwarm(T, { paceMs: swarmPaceMs });
  T.worker = createWorker(T);

  let saveTimer = null;
  let saving = Promise.resolve();
  const save = () => { saving = saving.then(() => worldStore.save(db.snapshot())).catch((e) => console.error('save failed', e)); return saving; };
  db.subscribe(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, persistDelayMs);
  });
  T.flush = async () => { clearTimeout(saveTimer); await save(); };
  clock.onChange((st) => db.tx((tx) => tx.setMeta({ clock: st })));

  if (fresh && autoSeed) {
    const now = frozenAt ?? Date.now();
    await seedWorld(T, { now });
    if (frozenAt) clock.freeze(frozenAt); else clock.run(0);
    if (crowd !== undefined) db.tx((tx) => tx.setMeta({ settings: { ...db.meta.settings, crowd } }));
    await T.flush();
  }
  T.fresh = fresh;
  return T;
}

/**
 * Settings saved by an earlier version: the old default heavy model (Claude Sonnet 5) moves to
 * the current default, and the swarm's heavy/light worker tier becomes an explicit model.
 * A model someone picked on purpose is kept.
 */
function migrateSettings(db) {
  if ((db.meta.settingsVersion || 1) >= 2) return;
  const s = db.meta.settings;
  const llm = { ...s.llm };
  if (llm.heavyModel === 'claude-sonnet-5') llm.heavyModel = config.llm.heavyModel;
  const { workerTier, ...swarm } = s.swarm || {};
  if (workerTier === 'light') swarm.workerModel = llm.lightModel;
  db.tx((tx) => tx.setMeta({ settings: { ...s, llm, swarm }, settingsVersion: 2 }));
}

export { commissions, market, work, delivery, profiles };
