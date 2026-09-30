// The browser database mirrors the blueprint's tables. Each table is a map of rows by id.
// LedgerEntry, ReputationEvent, StatusChange and the supervision logs (attempts, scores,
// supervisor actions, lesson trials, agents' wire notes) are append-only: the database refuses updates and deletes.

export const TABLES = Object.freeze([
  'User', 'ContributorProfile', 'Commission', 'Tile', 'TileEdge', 'Offer', 'Submission', 'Review',
  'LedgerEntry', 'ReputationEvent', 'AgentRun', 'Job',
  // Additions the static prototype needs: an audit trail of status changes, the briefs
  // contributors' models write, and dispute panels.
  'StatusChange', 'Brief', 'Dispute',
  // The swarm's competition and supervision layer: task specs written before the work, one
  // attempt per worker per round, the supervisor's scores and actions, worker configs and their
  // record, the lesson store with its trials, and an audit of each supervisor.
  'TaskSpec', 'Attempt', 'Score', 'SupervisorAction', 'WorkerStats', 'WorkerConfig', 'Lesson', 'LessonTrial', 'SupervisorAudit',
  // The wire: short notes agents post to the other tiles of a job, or to their rivals on a task.
  'AgentMessage',
]);

export const APPEND_ONLY = Object.freeze(['LedgerEntry', 'ReputationEvent', 'StatusChange', 'Attempt', 'Score', 'SupervisorAction', 'LessonTrial', 'AgentMessage']);

export const ID_PREFIX = Object.freeze({
  User: 'usr', ContributorProfile: 'prf', Commission: 'com', Tile: 'til', TileEdge: 'edg', Offer: 'ofr',
  Submission: 'sub', Review: 'rev', LedgerEntry: 'led', ReputationEvent: 'rep', AgentRun: 'run', Job: 'job',
  StatusChange: 'chg', Brief: 'brf', Dispute: 'dsp',
  TaskSpec: 'tsp', Attempt: 'att', Score: 'scr', SupervisorAction: 'sac', WorkerStats: 'wst', WorkerConfig: 'wcf', Lesson: 'les', LessonTrial: 'ltr', SupervisorAudit: 'sau',
  AgentMessage: 'msg',
});

export const ENUMS = Object.freeze({
  Privacy: ['PUBLIC', 'NEED_TO_KNOW', 'RESTRICTED'],
  TileKind: ['WORK', 'REVIEW', 'INTEGRATION'],
  CriterionCheck: ['AUTO', 'LLM', 'PEER'],
  LlmMode: ['OWN_KEY', 'OLLAMA', 'SHARED'],
  BriefStyle: ['CONCISE', 'STEP_BY_STEP', 'TEACH_ME'],
  OfferResponse: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'],
  ReviewSource: ['AUTO', 'LLM', 'PEER', 'REQUESTER'],
  Verdict: ['PASS', 'FAIL'],
  JobStatus: ['PENDING', 'RUNNING', 'DONE', 'FAILED'],
});

export const WORLD_VERSION = 1;

export function emptyWorld({ seed = 'tessera', now = Date.now() } = {}) {
  const tables = {};
  for (const t of TABLES) tables[t] = {};
  return {
    version: WORLD_VERSION,
    meta: {
      seed,
      idCounter: 0,
      createdAt: now,
      clock: { mode: 'running', offsetMs: 0, frozenAt: null },
      settings: {
        llm: { provider: 'mock', heavyModel: 'claude-opus-5-5', lightModel: 'claude-haiku-4-5', openai: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' } },
        crowd: true,
      },
      activePersonaId: null,
      signingKey: null,
      settingsVersion: 2,
      guide: { dismissed: false, done: [] },
    },
    tables,
  };
}
