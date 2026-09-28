// Mock Scoping: picks up to five questions from a bank per kind of job, skipping any the
// goal already answers, each with a suggested answer the requester can accept. The kind of
// job comes from the disaggregation engine's reading, and a job that names no parts is
// asked for them first, since the parts are what the Decomposer splits.
import { detectDomain, commissionContext } from './context.js';
import { analyzeJob } from '../../decompose/analyze.js';
import { FRAME_DEFAULTS } from '../../decompose/lexicon.js';

/** Questions for kinds of job the older bank doesn't cover, keyed by the engine's frame. */
const FRAME_BANK = {
  event: [
    ['event-budget', 'What is the budget ceiling for the venue and catering, and is the date fixed?', 'Goes into the event brief every vendor and volunteer tile works from.', 'Up to $8,000 for venue and catering; the date is fixed.', /\$\d|budget|date is/i],
    ['event-look', 'Is there a look the invitations and registration page should follow?', 'Sets colors, fonts and tone once, so separate designers match.', 'Use our logo colors, navy and gold, and a warm, formal tone.', /colors?|brand|logo/i],
  ],
  software: [
    ['platforms', 'Which platforms, and is there an existing back end or database?', 'Decides the API contract that front-end and back-end tiles build against in parallel.', 'iOS and Android from one codebase; there is no existing back end.', /react native|flutter|existing (?:api|back ?end)/i],
    ['accounts', 'Who signs in, and how?', 'Adds or removes a sign-in feature and its tests.', 'Volunteers sign in with email; staff have a separate admin login.', /sign[- ]in|login|account/i],
  ],
  media: [
    ['length', 'How long should each episode run, and are guests lined up?', 'Sets the edit length and whether the research tiles also book guests.', 'About 30 minutes each; we have a list of possible guests.', /\d+[- ]minute|guests? (?:are|is) (?:lined|booked)/i],
  ],
  course: [
    ['lesson-length', 'How long is each lesson, and who will teach it?', 'Sets lesson length and how detailed the facilitator guide must be.', 'About 45 minutes each, taught by a volunteer facilitator.', /\d+[- ]minute|facilitat/i],
  ],
  campaign: [
    ['channels', 'When does it launch, and which channels matter most?', 'Orders the send calendar and decides which copy tiles come first.', 'Launches December 1; email first, then Instagram and Facebook.', /launch|instagram|facebook|linkedin|email first/i],
  ],
  bulk: [
    ['format', 'What format is the source file, and does it have an id column?', 'The batch spec keys every batch on one id column, so batches can be merged back without guesswork.', 'A CSV export with a product_id column.', /csv|xlsx|export|_id|id column/i],
  ],
  finance: [
    ['software', 'Which accounting software do you use, and how many bank accounts?', 'Sets the chart of accounts and how many reconciliation tiles are needed.', 'QuickBooks Online, with two bank accounts and one credit card.', /quickbooks|xero|wave|accounts?\b.*\d/i],
  ],
  research: [
    ['decision', 'What decision will this research inform?', 'Every piece is written to answer it, and the summary ends with a recommendation.', 'Whether to open in the spring, and where.', /decide|decision|go\/no-go/i],
  ],
};

const BANK = {
  common: [
    ['audience', 'Who is the main audience, and how will they use the result?', 'Sets the reading level, format and what "done" looks like for every tile.', 'The audience is residents and local reporters reading on their phones.', /audience|residents|readers|for (?:our|the) (?:staff|board|members)/i],
    ['must-have', 'Is there anything the result must include, or must avoid?', 'Becomes acceptance criteria so reviewers can check it.', 'It must cite its sources and must not include anyone’s name.', /must (?:include|have|not)/i],
    ['out-of-scope', 'What is out of scope for this job?', 'Keeps the Decomposer from adding tiles you don’t want to pay for.', 'Ongoing maintenance and printing are out of scope.', /out of scope|not needed/i],
  ],
  dashboard: [
    ['source', 'Where does the data come from, and can a contributor reach it without logging in?', 'Decides whether the first tile is a scraper, a download or a manual export.', 'The county court’s public calendar site; no login is needed.', /court|portal|public (?:site|data)|api/i],
    ['update', 'Should the dashboard update on a schedule, or is a one-time snapshot enough?', 'A scheduled refresh adds an automation tile.', 'A one-time snapshot is enough for now.', /snapshot|monthly|weekly|update/i],
    ['language', 'Which languages should the page be in?', 'Adds a translation tile for each extra language.', 'English and Spanish.', /spanish|bilingual|english only/i],
  ],
  translation: [
    ['register', 'How formal should the translation be, and which regional variety?', 'Goes into the glossary and every translator’s brief.', 'Informal, plain Mexican Spanish at an eighth-grade reading level.', /formal|regional|mexican|plain language/i],
    ['layout', 'Does the final version need to match a printed layout?', 'Decides whether the last tile is layout work or plain text.', 'Plain text is fine; our staff will lay it out.', /layout|print|flyer design/i],
  ],
  survey: [
    ['codebook', 'Do you have an existing codebook, or should contributors build one?', 'An existing codebook removes the first tile.', 'Build a new one from the responses.', /codebook/i],
    ['count', 'About how many responses are there?', 'Sets how many coding batches the job needs.', 'About 120 responses.', /\b\d{2,5}\s+responses/i],
  ],
  literature: [
    ['question', 'What is the exact research question?', 'Every screening decision is made against it.', 'What happens to eviction rates when a city adds right-to-counsel?', /question/i],
    ['years', 'Which years and study types count?', 'Becomes the inclusion criteria.', 'Peer-reviewed studies and government reports from 2010 onward.', /since|from \d{4}|peer-reviewed/i],
  ],
  website: [
    ['hosting', 'Where will the page be hosted?', 'Decides the build tile’s format.', 'GitHub Pages, as a single static page.', /host|github pages|wordpress/i],
  ],
  report: [
    ['length', 'How long should the report be?', 'Sets word counts in the acceptance criteria.', 'About four pages plus one chart.', /pages|words/i],
  ],
  generic: [],
};

export function mockScoping(input) {
  const domain = detectDomain(input.commission || {});
  const x = commissionContext(input);
  const text = `${x.title} ${x.goal}`;
  const a = analyzeJob({ title: x.title, goal: x.goal, privacy: input.commission?.privacy });
  const gaps = [];
  if (a.vague) {
    const defaults = (FRAME_DEFAULTS[a.frame] || []).slice(0, 4);
    gaps.push(['pieces', 'What are the separate pieces of work you need?', 'Each piece becomes one or more tiles that different people can do at the same time. List them with counts where you know them.', defaults.length ? `We need ${defaults.join(', ')}.` : 'We need a plan, a first draft of each part, and a final edited version.', null]);
  }
  const pool = [...gaps, ...(BANK[domain] || []), ...(domain === 'generic' || !BANK[domain]?.length ? FRAME_BANK[a.frame] || [] : []), ...BANK.common];
  const questions = [];
  for (const [id, question, why, suggestedAnswer, answered] of pool) {
    if (answered && answered.test(text)) continue;
    questions.push({ id, question, why, suggestedAnswer });
    if (questions.length === 5) break;
  }
  return { questions };
}
