// Reads a commission the way the mock agents need it: what kind of job it is, where,
// in which language, and what the requester said during scoping.

export const DOMAINS = ['translation', 'survey', 'literature', 'dashboard', 'website', 'report', 'generic'];

export function detectDomain(commission) {
  const t = `${commission.title || ''} ${commission.goal || ''}`.toLowerCase();
  const has = (re) => re.test(t);
  if (has(/translat|spanish version|locali[sz]|en español|french version/) && !has(/dashboard|survey/)) return 'translation';
  if (has(/survey|open-ended|open ended|codebook|interview transcript|qualitative cod/)) return 'survey';
  if (has(/literature|systematic review|scoping review|annotated bibliograph|evidence review/)) return 'literature';
  if (has(/dashboard|tracker|explorer|interactive|visuali[sz]ation tool/)) return 'dashboard';
  if (has(/report|policy brief|white paper|memo|analysis|fact sheet/)) return 'report';
  if (has(/website|landing page|web page|webpage|microsite|\bsite\b/)) return 'website';
  if (has(/visuali[sz]|chart|map\b/)) return 'dashboard';
  return 'generic';
}

export function commissionContext(input) {
  const c = input.commission || {};
  const text = `${c.title || ''} ${c.goal || ''}`;
  const answers = Object.values(input.clarifications?.answers || {}).join(' ');
  const all = `${text} ${answers}`;
  const place = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*\sCounty)\b/.exec(text)?.[1]
    || /\bin ([A-Z][a-z]+(?:,?\s[A-Z][a-zA-Z]+)?)\b/.exec(text)?.[1]
    || 'the service area';
  const targetLang = /french|français/i.test(all) ? 'fr' : 'es';
  const langName = targetLang === 'fr' ? 'French' : 'Spanish';
  const wantsTranslation = /spanish|bilingual|español|translat|french/i.test(all) && !/no translation|english only/i.test(all);
  const topic = /evict/i.test(all) ? 'eviction filings' : /tenant/i.test(all) ? 'tenant records' : /budget|spending|revenue/i.test(all) ? 'budget records' : 'source records';
  const audience = /\baudience\b[^.]*?(?:is|are|:)\s*([^.;]+)/i.exec(answers)?.[1]?.trim() || 'a general public audience';
  return {
    title: c.title || 'Untitled commission',
    goal: c.goal || '',
    place,
    targetLang,
    langName,
    wantsTranslation,
    topic,
    audience,
    answers,
    restricted: c.privacy === 'RESTRICTED',
    files: input.files || [],
  };
}
