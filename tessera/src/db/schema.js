// The browser database mirrors the blueprint's tables. Each table is a map of rows by id.
// LedgerEntry and ReputationEvent are append-only: the database refuses updates and deletes.

export const TABLES = Object.freeze([
  'User', 'ContributorProfile', 'Commission', 'Tile', 'TileEdge', 'Offer', 'Submission', 'Review',
  'LedgerEntry', 'ReputationEvent', 'AgentRun', 'Job',
  // Additions the static prototype needs: an audit trail of status changes, the briefs
  // contributors' models write, and dispute panels.
  'StatusChange', 'Brief', 'Dispute',
]);

export const APPEND_ONLY = Object.freeze(['LedgerEntry', 'ReputationEvent', 'StatusChange']);

export const ID_PREFIX = Object.freeze({
  User: 'usr', ContributorProfile: 'prf', Commission: 'com', Tile: 'til', TileEdge: 'edg', Offer: 'ofr',
  Submission: 'sub', Review: 'rev', LedgerEntry: 'led', ReputationEvent: 'rep', AgentRun: 'run', Job: 'job',
  StatusChange: 'chg', Brief: 'brf', Dispute: 'dsp',
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
