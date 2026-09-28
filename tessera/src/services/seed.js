// The seed: a platform admin, 2 requesters, 12 contributors with varied skills and pay
// floors, and 3 commissions. History is created by driving the real services with the
// crowd simulation, so every ledger entry, reputation event and review in the seed obeys
// the same rules as live play.
import { DAY, HOUR } from '../lib/util.js';

const weekdays = (start, end) => [1, 2, 3, 4, 5].map((day) => ({ day, start, end }));
const everyDay = (start, end) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start, end }));

export const PERSONAS = [
  { id: 'usr_admin', name: 'Tessera Platform', role: 'admin', blurb: 'Runs the demo instance: agent logs, jobs, ledger, costs and the signing key.', isAdmin: true },
  { id: 'usr_marisol', name: 'Marisol Reyes', org: 'Casa Vecina Housing Coalition', role: 'requester', blurb: 'Housing nonprofit in Phoenix. Commissions data work for tenant advocacy.', isRequester: true },
  { id: 'usr_tom', name: 'Tom Adeyemi', org: 'Riverbend Public Library', role: 'requester', blurb: 'Outreach librarian. Commissions translations and small web projects.', isRequester: true },
  {
    id: 'usr_ruth', name: 'Ruth Kowalski', role: 'contributor', blurb: 'Retired paralegal in Tucson. Knows court codes cold.',
    profile: { skills: [['legal-research', 5], ['qa-review', 4], ['data-entry', 3], ['editing', 3], ['transcription', 3], ['project-management', 3]], languages: ['en'], tools: ['word', 'excel'], timezone: 'America/Phoenix', availability: weekdays('09:00', '12:00'), weeklyHoursCap: 12, payFloorCents: 2400, llmMode: 'SHARED', briefStyle: 'STEP_BY_STEP' },
  },
  {
    id: 'usr_jaewon', name: 'Jae-won Park', role: 'contributor', blurb: 'Design student in Chicago, working evenings.',
    profile: { skills: [['data-viz', 4], ['svg', 4], ['figma', 5], ['gis', 2], ['graphic-design', 4], ['ux-design', 3], ['video-editing', 2]], languages: ['en', 'ko'], tools: ['figma', 'vscode'], timezone: 'America/Chicago', availability: everyDay('18:00', '22:00'), weeklyHoursCap: 15, payFloorCents: 2600, llmMode: 'SHARED', briefStyle: 'TEACH_ME' },
  },
  {
    id: 'usr_lucia', name: 'Lucía Hernández', role: 'contributor', blurb: 'Community interpreter in El Paso. Bilingual English and Spanish.',
    profile: { skills: [['translation-es', 5], ['copywriting', 4], ['editing', 4], ['qa-review', 3], ['outreach', 3]], languages: ['en', 'es'], tools: ['word', 'google-docs'], timezone: 'America/Denver', availability: weekdays('08:00', '17:00'), weeklyHoursCap: 20, payFloorCents: 3000, llmMode: 'SHARED', briefStyle: 'STEP_BY_STEP', briefLanguage: 'es' },
  },
  {
    id: 'usr_dev', name: 'Dev Patel', role: 'contributor', blurb: 'Data engineer in Austin. Brings his own Claude key.',
    profile: { skills: [['python', 5], ['web-scraping', 4], ['data-cleaning', 4], ['sql', 4], ['testing', 3]], languages: ['en'], tools: ['vscode', 'jupyter', 'git'], timezone: 'America/Chicago', availability: everyDay('19:00', '23:00'), weeklyHoursCap: 10, payFloorCents: 4500, llmMode: 'OWN_KEY', briefStyle: 'CONCISE', llm: { provider: 'anthropic', model: 'claude-sonnet-5' } },
  },
  {
    id: 'usr_amara', name: 'Amara Okafor', role: 'contributor', blurb: 'Survey methodologist in Atlanta.',
    profile: { skills: [['statistics', 4], ['r', 5], ['survey-coding', 5], ['methodology', 4], ['research', 3]], languages: ['en', 'fr'], tools: ['rstudio', 'excel'], timezone: 'America/New_York', availability: weekdays('12:00', '18:00'), weeklyHoursCap: 12, payFloorCents: 4000, llmMode: 'SHARED', briefStyle: 'STEP_BY_STEP' },
  },
  {
    id: 'usr_sam', name: 'Sam Whitehorse', role: 'contributor', blurb: 'GIS analyst in Albuquerque. Runs a local model through Ollama.',
    profile: { skills: [['geocoding', 5], ['gis', 5], ['python', 3], ['data-viz', 3]], languages: ['en'], tools: ['qgis', 'vscode'], timezone: 'America/Denver', availability: everyDay('07:00', '10:00'), weeklyHoursCap: 15, payFloorCents: 3500, llmMode: 'OLLAMA', briefStyle: 'CONCISE', llm: { provider: 'openai', ollamaUrl: 'http://localhost:11434/v1', ollamaModel: 'llama3.1' } },
  },
  {
    id: 'usr_priya', name: 'Priya Raman', role: 'contributor', blurb: 'Technical writer in Seattle.',
    profile: { skills: [['technical-writing', 5], ['methodology', 4], ['editing', 5], ['copywriting', 3], ['grant-writing', 4], ['instructional-design', 3]], languages: ['en', 'hi'], tools: ['google-docs', 'markdown'], timezone: 'America/Los_Angeles', availability: weekdays('09:00', '15:00'), weeklyHoursCap: 20, payFloorCents: 3000, llmMode: 'SHARED', briefStyle: 'CONCISE' },
  },
  {
    id: 'usr_marco', name: 'Marco Bianchi', role: 'contributor', blurb: 'Front-end developer in Milan who takes integration work.',
    profile: { skills: [['web-dev', 5], ['html-css', 5], ['javascript', 4], ['accessibility', 4], ['project-integration', 4], ['mobile-dev', 3]], languages: ['en', 'it'], tools: ['vscode', 'git'], timezone: 'Europe/Rome', availability: everyDay('08:00', '20:00'), weeklyHoursCap: 8, payFloorCents: 5000, llmMode: 'OWN_KEY', briefStyle: 'CONCISE', llm: { provider: 'anthropic', model: 'claude-opus-5' } },
  },
  {
    id: 'usr_grace', name: 'Grace Liu', role: 'contributor', blurb: 'Bookkeeper in Phoenix, new to Tessera, learning as she goes.',
    profile: { skills: [['excel', 5], ['data-entry', 5], ['data-cleaning', 3], ['survey-coding', 2], ['research', 2], ['bookkeeping', 4], ['transcription', 3], ['outreach', 2]], languages: ['en', 'zh'], tools: ['excel', 'google-sheets'], timezone: 'America/Phoenix', availability: everyDay('06:00', '09:00'), weeklyHoursCap: 25, payFloorCents: 2000, llmMode: 'SHARED', briefStyle: 'TEACH_ME' },
  },
  {
    id: 'usr_kofi', name: 'Kofi Mensah', role: 'contributor', blurb: 'Public health graduate student in Accra.',
    profile: { skills: [['literature-review', 4], ['research', 4], ['citation-management', 5], ['survey-coding', 3], ['technical-writing', 3], ['audio-editing', 3], ['event-planning', 3]], languages: ['en', 'fr'], tools: ['zotero', 'word'], timezone: 'Africa/Accra', availability: everyDay('10:00', '16:00'), weeklyHoursCap: 20, payFloorCents: 2200, llmMode: 'SHARED', briefStyle: 'STEP_BY_STEP' },
  },
  {
    id: 'usr_mateo', name: 'Mateo Ruiz', role: 'contributor', blurb: 'Bilingual QA tester in Tucson.',
    profile: { skills: [['qa-review', 4], ['testing', 4], ['translation-es', 4], ['accessibility', 3], ['event-planning', 4], ['project-management', 3]], languages: ['en', 'es'], tools: ['vscode', 'browser-devtools'], timezone: 'America/Phoenix', availability: weekdays('13:00', '21:00'), weeklyHoursCap: 15, payFloorCents: 3200, llmMode: 'SHARED', briefStyle: 'STEP_BY_STEP' },
  },
  {
    id: 'usr_noah', name: 'Noah Fischer', role: 'contributor', blurb: 'Econometrician in Boston with a $90/h floor. Shows the floor filter at work.',
    profile: { skills: [['statistics', 5], ['econometrics', 5], ['r', 5], ['python', 4]], languages: ['en', 'de'], tools: ['rstudio', 'vscode'], timezone: 'America/New_York', availability: weekdays('09:00', '17:00'), weeklyHoursCap: 5, payFloorCents: 9000, llmMode: 'OWN_KEY', briefStyle: 'CONCISE', llm: { provider: 'anthropic', model: 'claude-sonnet-5' } },
  },
];

export const SAMPLE_COMMISSIONS = {
  flyer: {
    title: 'Spanish version of our library card flyer and FAQ',
    goal: 'Translate our one-page library card signup flyer and the six-question FAQ that goes with it into Spanish, so families who read Spanish can sign up without help at the desk. Keep it friendly and plain. The final version should be ready to print.',
    budgetCents: 40000, days: 10, privacy: 'PUBLIC',
  },
  dashboard: {
    title: 'Eviction filings dashboard for Maricopa County',
    goal: 'Build a public dashboard of eviction filings in Maricopa County from the justice courts’ public calendar: monthly trends, a map by census tract, and a breakdown by case type, with a plain-language methodology note. The page should be in English and Spanish and work on a phone, because tenants and reporters will read it there.',
    budgetCents: 240000, days: 21, privacy: 'NEED_TO_KNOW',
  },
  survey: {
    title: 'Code 120 open-ended tenant survey responses',
    goal: 'We ran a tenant survey with an open-ended question about housing problems and have about 120 responses. We need a codebook, every response coded, a check that coders agree, and a short memo on the main themes for our board. Responses include some names and addresses, so contributors should only see redacted text.',
    budgetCents: 90000, days: 14, privacy: 'RESTRICTED',
  },
};

export function personaProfile(p) {
  const { skills, ...rest } = p.profile;
  return { skills: skills.map(([tag, selfLevel]) => ({ tag, selfLevel })), llm: { provider: 'anthropic' }, ...rest };
}

function createPeople(T) {
  T.db.tx((tx) => {
    for (const p of PERSONAS) {
      tx.insert('User', {
        id: p.id, githubId: `demo-${p.id}`, name: p.name, email: null, org: p.org || null, blurb: p.blurb, persona: true,
        isRequester: !!p.isRequester, isContributor: !!p.profile, isAdmin: !!p.isAdmin,
      });
      if (p.profile) tx.insert('ContributorProfile', { userId: p.id, ...personaProfile(p) });
    }
  });
}

async function post(T, requesterId, sample, now) {
  const c = await T.api.postCommission(requesterId, { ...sample, deadline: now + sample.days * DAY });
  await T.worker.drain();
  const cur = T.db.get('Commission', c.id);
  const answers = Object.fromEntries(cur.clarifications.questions.map((q) => [q.id, q.suggestedAnswer]));
  if (cur.clarifications.questions.length) T.api.answerScoping(requesterId, c.id, answers);
  await T.worker.drain();
  return c.id;
}

/** Runs rounds of jobs, timers and the crowd, moving the clock between rounds, until `until()` holds. */
async function play(T, until, { stepMs = 2 * HOUR, maxRounds = 80 } = {}) {
  for (let i = 0; i < maxRounds; i++) {
    // Let everyone act on what is in front of them before any time passes.
    for (let k = 0; k < 20; k++) {
      await T.worker.drain();
      const acted = await T.crowd.step({ force: true });
      await T.worker.drain();
      if (until() || !acted) break;
    }
    if (until()) return;
    T.clock.advance(stepMs);
  }
}

export async function seedWorld(T, { now }) {
  createPeople(T);
  const status = (id) => T.db.get('Commission', id).status;

  // 1. A finished commission, three weeks ago: the library flyer, delivered and signed off.
  T.clock.freeze(now - 21 * DAY);
  const flyer = await post(T, 'usr_tom', SAMPLE_COMMISSIONS.flyer, T.clock.now());
  T.api.fundCommission('usr_tom', flyer);
  await play(T, () => status(flyer) === 'DELIVERED');
  T.clock.advance(DAY);
  if (status(flyer) === 'DELIVERED') T.api.acceptDelivery('usr_tom', flyer);

  // 2. A commission in progress: the eviction dashboard from the blueprint, partly done.
  // It starts a few hours back with short steps, so the offers still pending at the end
  // are inside their two-hour window when the page loads.
  T.clock.freeze(now - 90 * 60 * 1000);
  const dash = await post(T, 'usr_marisol', SAMPLE_COMMISSIONS.dashboard, T.clock.now());
  T.api.fundCommission('usr_marisol', dash);
  const accepted = () => T.db.filter('Tile', (t) => t.commissionId === dash && t.status === 'ACCEPTED' && !t.dynamic).length;
  await play(T, () => accepted() >= 4, { stepMs: 10 * 60 * 1000, maxRounds: 8 });

  // 3. A commission waiting for the requester: planned and priced, not yet funded.
  T.clock.freeze(now - HOUR);
  await post(T, 'usr_marisol', SAMPLE_COMMISSIONS.survey, T.clock.now());
  T.crowd.reset();
}
