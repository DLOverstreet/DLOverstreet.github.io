// Every tunable constant lives here. Change a number and the pricing, matching,
// verification and demo limits all follow.
import { HOUR, DAY, MINUTE } from '../lib/util.js';

export const config = Object.freeze({
  /** Hourly rate per tier, in cents. */
  tierRates: Object.freeze({ 1: 2200, 2: 3200, 3: 5000, 4: 8000 }),
  tierLabels: Object.freeze({ 1: 'General computer skills', 2: 'Practiced skill', 3: 'Specialist', 4: 'Licensed or expert judgment' }),
  rushPremium: 0.25,
  rushWindowMs: 72 * HOUR,
  /** Platform fee as a share of each tile, paid by the requester on top of tile pay. */
  feeRate: 0.10,
  /** No tile may pay less than this effective hourly rate, in cents. */
  platformFloorCents: 2000,

  tileMinutes: Object.freeze({ min: 15, max: 120 }),

  offersPerTile: 3,
  offerWindowMs: 2 * HOUR,
  claimMultiplier: 3,
  claimMinMs: 48 * HOUR,

  maxRevisionRounds: 2,
  peerReview: Object.freeze({ firstN: 5, sampleRate: 0.2 }),
  reviewTileMinutes: 15,
  reviewConfidenceFloor: 0.7,
  /** Until someone has earned reputation in a skill, a self-rated level this high qualifies them to review it. */
  reviewerBootstrapLevel: 3,

  autoAcceptMs: 7 * DAY,
  disputePanelSize: 3,

  matchWeights: Object.freeze({ S: 0.45, R: 0.25, A: 0.15, F: 0.10, G: 0.05 }),
  reputationPrior: Object.freeze({ accepted: 2, attempts: 4 }),
  reputationHalfWeightMs: 365 * DAY,
  fairnessWindowMs: 7 * DAY,

  calibration: Object.freeze({ minSamples: 3, minRatio: 0.5, maxRatio: 2 }),

  llm: Object.freeze({
    maxRetries: 2,
    /** Planning, assembly and escalated reviews: the current Opus. */
    heavyModel: 'claude-opus-5-5',
    /** First-pass reviews and offer notes: the current Haiku. */
    lightModel: 'claude-haiku-4-5',
    /** A contributor's own key when they haven't picked a model. */
    contributorModel: 'claude-sonnet-5-5',
  }),

  scoping: Object.freeze({ maxQuestions: 5 }),
  budgetRetries: 2,

  limits: Object.freeze({
    maxFileBytes: 5 * 1024 * 1024,
    maxFilesPerSubmission: 10,
    maxSubmissionBytes: 20 * 1024 * 1024,
    allowedExtensions: Object.freeze(['csv', 'tsv', 'json', 'geojson', 'md', 'markdown', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg',
      'py', 'r', 'js', 'ts', 'html', 'css', 'sql', 'ipynb', 'yaml', 'yml', 'xml', 'xlsx', 'docx', 'zip']),
    commissionsPerHour: 6,
    submissionsPerHour: 20,
    llmCallsPerWindow: 40,
    llmWindowMs: 10 * MINUTE,
    /** The agent swarm has its own, larger allowance so a big job doesn't starve the platform agents. */
    swarmCallsPerWindow: 300,
  }),

  /** Defaults for the agent swarm; Settings can change them. */
  swarm: Object.freeze({
    size: 12,
    concurrency: 4,
    /** The model each agent works with: the current Sonnet, fast and a fraction of Opus's price. */
    workerModel: 'claude-sonnet-5-5',
    /** Consistency and agreement checks run on a different model from the work they check. */
    checkModel: 'claude-opus-5-5',
    spendCapUsd: 15,
    /** What a worker reads, in characters: whole documents fit (a 10,000-word manuscript is about 60,000). The prompt cache makes rereading them cheap. */
    maxInputChars: 150000,
    maxFileChars: 60000,
    /** Agents may search and read the web when a tile needs current or outside facts. */
    web: true,
    maxSearchesPerTile: 5,
    maxFetchesPerTile: 5,
    /** A tile expected to take one agent longer than splitAboveSeconds may be split into parts done at once. */
    split: true,
    splitAboveSeconds: 60,
    maxParts: 4,
    /** Most a split may add to the tile's model cost, in percent (the parts reread the cached context and write their own notes). */
    splitMaxExtraPct: 40,
    /**
     * Competing workers: 'on' gives each work tile to several worker configs and a supervisor keeps
     * the best; 'auto' also lets a config that wins nearly every task of a type work alone (still
     * supervised); 'off' gives each tile to one agent, checked by the Reviewer as before.
     */
    competition: 'on',
    competitors: 3,
    /** The second round, where workers revise after the blind one: 'auto' (only when the blind round wasn't a clean accept), 'always' or 'never'. */
    reveal: 'auto',
    /**
     * What workers see in that round: 'notes' (the supervisor's scores and summaries, the notes they
     * posted, each one's approach; cheap) or 'drafts' (every blind draft in full).
     */
    exchange: 'notes',
    /** How many of the best attempts revise after a scored round (0: all of them). The rest count as losses. */
    finalists: 0,
    /** A cheaper challenger in every competition: 'off', 'free' (the free providers in Settings), 'haiku' or 'sonnet'. */
    challenger: 'off',
    /** When a config wins over half its tasks, try its strategy on the next cheaper Claude model; routing keeps whichever does the work for less. */
    cheaperClones: true,
    /** Effort for the workers and the supervisor (the model's own default when empty). */
    workerEffort: 'medium',
    checkEffort: 'medium',
    /** Agents post short notes to the job's wire and read the others' before they work. */
    wire: true,
    /** An agent doing a tile alone (no competition) tries the free providers in Settings before Claude. */
    freeSolo: false,
    /** Send the swarm's worker, supervisor and reflection calls through Anthropic's Message Batches API: half price, slower. */
    batch: false,
    /** The rubric score (0 to 1) the best attempt must reach. */
    threshold: 0.7,
    /** Two compete instead of three on a task type one config clearly dominates. */
    routing: true,
    /** Reflection writes lessons after each task; lessons stay only if they raise scores over lessonTrials tasks. */
    learning: true,
    lessonTrials: 20,
    /** Share of accepted tasks sampled for your review, in percent, to measure how often you agree with the supervisors. */
    reviewSamplePct: 15,
    /** Most re-splits per job, and how deep a re-split task may be split again. */
    maxResplitsPerJob: 3,
    maxDepth: 2,
  }),
});

/** The skill vocabulary the Decomposer is asked to reuse. New kebab-case tags are allowed. */
export const skillVocabulary = Object.freeze([
  'python', 'r', 'sql', 'javascript', 'html-css', 'web-scraping', 'data-cleaning', 'data-entry', 'excel',
  'geocoding', 'gis', 'statistics', 'econometrics', 'survey-coding', 'data-viz', 'figma', 'svg',
  'technical-writing', 'copywriting', 'editing', 'methodology', 'translation-es', 'translation-fr',
  'legal-research', 'literature-review', 'research', 'citation-management', 'qa-review', 'testing',
  'accessibility', 'web-dev', 'project-integration', 'graphic-design', 'ux-design', 'mobile-dev', 'grant-writing',
  'instructional-design', 'event-planning', 'project-management', 'outreach', 'bookkeeping', 'transcription',
  'audio-editing', 'video-editing',
]);
