// The worker: polls the Job table and runs each job's handler, retrying with backoff and
// marking a job FAILED for a person to look at after three attempts. It also runs the
// timer sweep and the crowd simulation. In the browser it runs inside the page.
import { runScopingJob, runDecomposeJob } from '../services/commissions.js';
import { runMatchJob, runMatcherNoteJob, runTick } from '../services/market.js';
import { runVerifyJob } from '../services/work.js';
import { runAssembleJob } from '../services/delivery.js';

export const HANDLERS = {
  scope: { run: runScopingJob, label: 'Scoping questions', onFail: flagCommission('Scoping failed') },
  decompose: { run: runDecomposeJob, label: 'Decomposition', onFail: flagCommission('Decomposition failed') },
  match: { run: (T, p) => runMatchJob(T, p), label: 'Matching' },
  matcherNote: { run: runMatcherNoteJob, label: 'Offer notes' },
  verify: { run: runVerifyJob, label: 'Verification', onFail: flagTile('Verification failed') },
  assemble: { run: runAssembleJob, label: 'Assembly', onFail: flagCommission('Assembly failed') },
};

function flagCommission(prefix) {
  return (T, job, err) => {
    const id = job.payload.commissionId;
    if (id && T.db.get('Commission', id)) T.db.tx((tx) => tx.update('Commission', id, { planError: `${prefix}: ${err.message}`, planState: null }));
  };
}
function flagTile(prefix) {
  return (T, job, err) => {
    const id = job.payload.tileId;
    if (id && T.db.get('Tile', id)) T.db.tx((tx) => tx.update('Tile', id, { jobError: `${prefix}: ${err.message}` }));
  };
}

const MAX_ATTEMPTS = 3;

export function createWorker(T, { concurrency = 3, pollMs = 300, tickMs = 2500 } = {}) {
  const running = new Set();
  let timer = null;
  let lastTick = 0;
  // A job still marked running belongs to a page that was closed or reloaded mid-job: nothing will
  // finish it, so it starts again.
  const stale = T.db.filter('Job', (j) => j.status === 'RUNNING');
  if (stale.length) {
    T.db.tx((tx) => { for (const j of stale) tx.update('Job', j.id, { status: 'PENDING', runAfter: tx.now(), lastError: 'Restarted: the page closed or reloaded while it ran.' }); });
  }

  function dueJobs() {
    const now = T.clock.now();
    return T.db.filter('Job', (j) => j.status === 'PENDING' && j.runAfter <= now && !running.has(j.id)).sort((a, b) => a.runAfter - b.runAfter || a.createdAt - b.createdAt);
  }

  async function runJob(job) {
    running.add(job.id);
    const handler = HANDLERS[job.type];
    T.db.tx((tx) => tx.update('Job', job.id, { status: 'RUNNING', attempts: job.attempts + 1, startedAt: tx.now() }));
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler.run(T, job.payload);
      T.db.tx((tx) => tx.update('Job', job.id, { status: 'DONE', finishedAt: tx.now(), lastError: null }));
    } catch (err) {
      const attempts = job.attempts + 1;
      // An AgentFailure has already been retried twice inside runAgent, so it goes straight
      // to a person. Unexpected errors (storage hiccups and the like) get job-level retries.
      const retryable = !['UserError', 'TransitionError', 'AgentFailure'].includes(err.name);
      const final = attempts >= MAX_ATTEMPTS || !retryable;
      T.db.tx((tx) => tx.update('Job', job.id, {
        status: final ? 'FAILED' : 'PENDING', lastError: String(err.message || err), finishedAt: final ? tx.now() : null,
        runAfter: tx.now() + (final ? 0 : 1000 * 2 ** attempts),
      }));
      if (final && handler?.onFail) handler.onFail(T, job, err);
      if (T.debug) console.warn(`job ${job.type} failed:`, err);
    } finally {
      running.delete(job.id);
    }
  }

  async function pump() {
    const jobs = dueJobs();
    const starts = [];
    for (const j of jobs) {
      if (running.size >= concurrency) break;
      starts.push(runJob(j));
    }
    await Promise.all(starts);
    return starts.length;
  }

  async function tick({ force = false } = {}) {
    runTick(T);
    if (T.crowd) await T.crowd.step({ force });
    prune();
  }

  function prune() {
    const done = T.db.filter('Job', (j) => j.status === 'DONE').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    if (done.length > 300) T.db.tx((tx) => { for (const j of done.slice(300)) tx.remove('Job', j.id); });
  }

  /** Runs jobs, ticks and (optionally forced) crowd steps until nothing is left to do. For seeding and tests. */
  async function drain({ crowd = false, maxRounds = 400 } = {}) {
    for (let i = 0; i < maxRounds; i++) {
      let n = 0;
      while (dueJobs().length) n += await pump();
      runTick(T);
      let acted = 0;
      if (crowd && T.crowd) acted = await T.crowd.step({ force: true });
      if (!n && !acted && !dueJobs().length) return i;
    }
    throw new Error('drain() did not settle');
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(async () => {
        try {
          await pump();
          if (Date.now() - lastTick > tickMs) { lastTick = Date.now(); await tick(); }
        } catch (e) { console.error(e); }
      }, pollMs);
    },
    stop() { clearInterval(timer); timer = null; },
    pump, tick, drain, runJob,
    retry(jobId) { T.db.tx((tx) => tx.update('Job', jobId, { status: 'PENDING', runAfter: tx.now(), attempts: 0, lastError: null })); },
    get running() { return running.size; },
  };
}
