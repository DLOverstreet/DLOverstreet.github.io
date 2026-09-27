// Mock Scoping: picks up to five questions from a bank per kind of job, skipping any the
// goal already answers, each with a suggested answer the requester can accept.
import { detectDomain, commissionContext } from './context.js';

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
  const pool = [...(BANK[domain] || []), ...BANK.common];
  const questions = [];
  for (const [id, question, why, suggestedAnswer, answered] of pool) {
    if (answered && answered.test(text)) continue;
    questions.push({ id, question, why, suggestedAnswer });
    if (questions.length === 5) break;
  }
  return { questions };
}
