// Revise-and-respond jobs: a manuscript (or paper, chapter, proposal, report) revised in answer
// to reviewers' or editors' critiques, with a letter saying how each was addressed. The general
// reader splits a job by its sentences, and on these jobs that misreads the work ("You can learn
// from those edits" became an analysis tile, "keep the numbers" a data-cleaning one). This plan
// follows how a revision is actually done: every comment triaged into one matrix first, the
// manuscript revised section by section against it at the same time, each comment answered in
// the letter, the whole checked against the reviews, then assembled.

const DOC = /\b(manuscript|paper|article|chapter|proposal|submission|thesis|dissertation|report|draft|book|monograph)\b/i;
const REVISE = /\b(revis(?:e|ed|es|ing|ion|ions)|resubmi\w*|r\s*&\s*r)\b/i;
const CRITIQUE = /\b(reviewers?|referees?|critiques?|editors?['’]?s? (?:comments?|decision|letter|concerns?)|decision letter|response to (?:the )?reviewers?|reviewer comments?)\b/i;

/** Whether the job is a revision of a document in answer to reviewers' or editors' comments. */
export function isRevisionJob(job) {
  const text = `${job.title || ''} ${job.goal || ''}`;
  return DOC.test(text) && REVISE.test(text) && CRITIQUE.test(text);
}

/** Sections a revision is split into when the manuscript's own headings aren't known. */
const DEFAULT_SECTIONS = ['the abstract and introduction', 'the theory and literature review', 'the data and methods', 'the results', 'the discussion and conclusion'];
const BACK_MATTER = /^(references|bibliography|works cited|appendix|appendices|tables?|figures?|acknowledg\w*|notes|endnotes|footnotes|supplementary|online appendix)\b/i;

/** The manuscript among the attachments: a document with headings, not a response, memo, tracker or letter. */
function manuscriptOf(files) {
  const docs = (files || []).filter((f) => f.summary?.headings?.length >= 3);
  const other = /\b(respon|memo|tracker|letter|decision|review(?:er)?s?\b|comments?)\b/i;
  return docs.find((f) => /\b(manuscript|paper|article|draft|chapter)\b/i.test(f.name) && !/revis/i.test(f.name) && !other.test(f.name))
    || docs.find((f) => !other.test(f.name)) || null;
}

/** The manuscript's headings in up to five groups of similar size, or the usual sections of a paper. */
export function revisionSections(files) {
  const m = manuscriptOf(files);
  const heads = (m?.summary?.headings || []).slice(1).filter((h) => h.length <= 120 && !BACK_MATTER.test(h));
  if (heads.length < 3) return { sections: DEFAULT_SECTIONS.map((s) => ({ label: s, headings: [] })), from: null };
  const n = Math.min(5, heads.length);
  const sections = Array.from({ length: n }, (_, i) => heads.slice(Math.floor((i * heads.length) / n), Math.floor(((i + 1) * heads.length) / n)));
  return {
    sections: sections.map((hs) => ({ label: hs.length > 1 ? `${hs[0]} through ${hs[hs.length - 1]}` : hs[0], headings: hs })),
    from: m.name,
  };
}

const slug = (s, i) => `${String(i + 1).padStart(2, '0')}_${String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28)}`;
const A = (text, rule) => ({ check: 'AUTO', text, rule });
const L = (text) => ({ check: 'LLM', text });
const ids = (list) => list.map((c, i) => ({ id: `c${i + 1}`, ...c }));

/**
 * The plan for a revise-and-respond job, in the engine's tile format.
 * @param {any} a the engine's analysis of the job
 * @param {{ title?: string, goal?: string, files?: any[] }} job
 */
export function revisionTiles(a, job) {
  const text = a.text || `${job.title || ''} ${job.goal || ''}`;
  const keepNumbers = /\b(keep (?:the )?numbers|numbers (?:stay|remain)|should remain the same|analys\w+ (?:portion|results?|numbers?)[^.]*\b(?:remain|stay|unchanged|same))\b/i.test(text);
  const voice = /\b(same voice|my voice|author'?s voice|in my (?:own )?voice|my (?:writing )?style)\b/i.test(text);
  const tracked = /\btracked[- ]changes?\b/i.test(text);
  const clean = /\bclean (?:copy|version)\b/i.test(text);
  const limit = /\b(word limit|page limit|\d+\s*%\s*longer|no more than about)\b/i.test(text);
  const attached = (job.files || []).length > 0;
  const source = attached ? 'the files the requester attached (manuscript, reviews, and any drafts, memos or trackers)' : 'the manuscript and reviews the requester provides';
  const { sections, from } = revisionSections(job.files);
  const reqs = a.requirements || [];
  const respondReqs = reqs.filter((r) => /respon|reviewer|editor|each concern|point[- ]by[- ]point/i.test(r.text)).map((r) => r.id);
  const numbers = keepNumbers ? [L('Every number from the requester’s revised analyses is kept exactly as given')] : [];
  const voiced = voice ? [L('It reads in the author’s own voice, as the style sheet describes it')] : [L('It keeps the manuscript’s tone and terminology, as the style sheet describes them')];
  const base = { sensitiveInputs: [], languages: [], priority: 1, stream: 'Revision' };

  const matrix = {
    ...base, key: 'revision-plan', kind: 'WORK', phase: 'conventions', archetype: 'edit', stream: 'Setup',
    title: 'Triage every comment into a revision plan',
    spec: [
      `The job: ${job.title || 'revise a manuscript in answer to its reviews'}. Read ${source}.`,
      'Your piece: one row per comment from every reviewer, the editor and any advisor named in the job, in comment_matrix.csv with the columns comment_id (R1.1, R1.2, E.1…), source, comment (quoted or closely paraphrased), decision (revise, clarify or rebut, following any priority the requester set in a memo, tracker or their answers), section (exactly one of the section names below), and plan (what will change, or the reasoned case for not changing it).',
      `Sections, one tile each, working at the same time: ${sections.map((s, i) => `${i + 1}. ${s.label}`).join('; ')}.`,
      `Also write style_sheet.md: the author's voice (sentence length, person, hedging, favored terms), the citation style, spelling conventions, ${keepNumbers ? 'the numbers from the requester’s revised analyses that must not change, ' : ''}and any length limit.`,
      'Everyone else works from these two files, so be complete: a comment missing here is missed everywhere.',
    ].join('\n\n'),
    deliverableFormat: 'comment_matrix.csv and style_sheet.md',
    acceptanceCriteria: ids([
      A('The matrix has the planned columns', 'csv_columns(comment_id, source, comment, decision, section, plan)'),
      A('The style sheet names the voice', 'has_heading("Voice")'),
      L('Every comment from every reviewer, the editor and any named advisor in the attached files has its own row'),
      L('Each decision follows the requester’s stated priorities, and each rebuttal has a reason'),
    ]),
    skillTags: ['editing', 'methodology'], tier: 3, estMinutes: 90, dependsOn: [],
    inputs: ['the source file the requester attached'], outputs: ['comment_matrix.csv', 'style_sheet.md'], covers: [],
  };

  const sectionTiles = sections.map((s, i) => {
    const f = slug(s.label, i);
    return {
      ...base, key: `revise-section-${i + 1}`, kind: 'WORK', phase: 'work', archetype: 'edit',
      title: `Revise ${s.label}`.slice(0, 80),
      spec: [
        `Revise ${s.label}${s.headings.length ? ` (the headings ${s.headings.map((h) => `“${h}”`).join(', ')}${from ? ` in ${from}` : ''})` : ''} of the manuscript, in answer to every row of comment_matrix.csv whose section is “${s.label}”.`,
        `You receive the matrix, style_sheet.md and ${source}. Where the requester has already drafted edits, use them where they're right${keepNumbers ? ', and keep every number from their revised analyses exactly as it is' : ''}.`,
        `Deliver revised_${f}.md, the full revised text of your section, and changes_${f}.csv with the columns comment_id, change, location and new_text (the passage as revised, quoted), one row per comment you addressed. Change only what a comment or the requester asks for; other sections are revised by other people at the same time.`,
      ].join('\n\n'),
      deliverableFormat: `revised_${f}.md and changes_${f}.csv`,
      acceptanceCriteria: ids([
        A('Each change is logged against its comment', 'csv_columns(comment_id, change, location, new_text)'),
        L('Every matrix row assigned to this section is addressed as planned, or its rebuttal is noted'),
        ...numbers,
        ...voiced,
        L('Nothing outside the comments and the requester’s instructions is changed'),
      ]),
      skillTags: ['editing', 'technical-writing'], tier: 3, estMinutes: 100, dependsOn: ['revision-plan'],
      inputs: ['comment_matrix.csv', 'style_sheet.md', 'the source file the requester attached'], outputs: [`revised_${f}.md`, `changes_${f}.csv`], covers: [],
    };
  });
  const changeFiles = sectionTiles.flatMap((t) => t.outputs);

  // A revision answering reviews always comes with a letter saying how each comment was handled.
  const response = {
    ...base, key: 'response-letter', kind: 'WORK', phase: 'work', archetype: 'write', stream: 'Response',
    title: 'Write the response to the reviewers and editors',
    spec: [
      'Write response_to_reviewers.md: the letter telling the editor and each reviewer how every comment was addressed.',
      'Point by point, in comment_matrix.csv order: the comment in italics, then the response, the page and line or section where the change was made, and the new text quoted where it helps. For a rebuttal, give the reasoned case respectfully.',
      `You receive the matrix, the style sheet, every section's changes_*.csv and revised text, and ${source}; build on the requester's own draft response if there is one, in their voice. Every change you describe must match a logged change.`,
    ].join('\n\n'),
    deliverableFormat: 'response_to_reviewers.md',
    acceptanceCriteria: ids([
      A('The letter is Markdown', 'file_ext(md)'),
      A('It opens with a note to the editor', 'has_heading("Editor")'),
      L('Every row of the matrix has a response, in the point-by-point layout'),
      L('Each response matches the change actually logged for that comment'),
      ...(voice ? [L('It reads in the author’s voice')] : []),
    ]),
    skillTags: ['technical-writing', 'editing'], tier: 3, estMinutes: 110, dependsOn: ['revision-plan', ...sectionTiles.map((t) => t.key)],
    inputs: ['comment_matrix.csv', 'style_sheet.md', ...changeFiles, 'the source file the requester attached'], outputs: ['response_to_reviewers.md'], covers: respondReqs,
  };

  const check = {
    ...base, key: 'revision-check', kind: 'WORK', phase: 'check', archetype: 'review', stream: 'Checks',
    title: 'Check the revision against every comment',
    spec: [
      'Read the matrix, every revised section, every change log and the response letter against the reviews themselves, and write revision_check.md.',
      `List any comment not addressed, any response that claims a change not made, any section that contradicts another${keepNumbers ? ', any number that differs from the requester’s revised analyses' : ''}, any citation that looks invented${limit ? ', and whether the manuscript is within the length limit' : ''}. For each, say exactly what to fix and where.`,
    ].join('\n\n'),
    deliverableFormat: 'revision_check.md',
    acceptanceCriteria: ids([
      A('The report has a findings section', 'has_heading("Findings")'),
      L('Every comment in the matrix is checked against the revised text and the letter'),
      L('Each problem names the file and passage to fix'),
    ]),
    skillTags: ['qa-review', 'editing'], tier: 3, estMinutes: 60, dependsOn: [...sectionTiles.map((t) => t.key), 'response-letter'],
    inputs: ['comment_matrix.csv', ...changeFiles, 'response_to_reviewers.md'], outputs: ['revision_check.md'], covers: [],
  };

  const allReqs = reqs.map((r) => r.id);
  const integrate = {
    ...base, key: 'assemble-revision', kind: 'INTEGRATION', phase: 'integrate', archetype: 'edit', stream: 'Assembly',
    title: 'Assemble the revised manuscript and the letter',
    spec: [
      `Put the revised sections together, in order, into revised_manuscript.md, the clean full text, and fix what revision_check.md found. Keep the manuscript's headings, tables and reference list${keepNumbers ? '; don’t change any reported number' : ''}.`,
      `Finalize response_to_reviewers.md so its locations match the assembled manuscript.${tracked ? ' The requester wants a tracked-changes version too: the platform adds Word copies of the finished files to the download, and handoff.md says how to make the tracked version with Word’s Compare against the original manuscript.' : ''}${clean ? ' The clean version is revised_manuscript.md (and its Word copy).' : ''}`,
      'Write handoff.md: every file, who made it, and what the requester must still do (submit, check any flagged citation, make the tracked-changes copy).',
    ].join('\n\n'),
    deliverableFormat: 'revised_manuscript.md, response_to_reviewers.md and handoff.md',
    acceptanceCriteria: ids([
      A('The deliverables are Markdown', 'file_ext(md)'),
      A('It includes the handoff', 'contains("handoff")'),
      L('The manuscript reads as one paper, with every section revised and nothing dropped'),
      L('Every problem in revision_check.md is fixed or explained in handoff.md'),
      ...(a.constraints || []).slice(0, 4).map((c) => L(`Covers: ${c}`.slice(0, 200))),
    ]),
    skillTags: ['editing', 'project-integration'], tier: 2, estMinutes: 75, dependsOn: ['revision-check', ...sectionTiles.map((t) => t.key), 'response-letter'],
    inputs: [...changeFiles, 'response_to_reviewers.md', 'revision_check.md', 'style_sheet.md'],
    // The letter's locations change when the sections come together, so the final letter is a new file.
    outputs: ['revised_manuscript.md', 'response_to_reviewers_final.md', 'handoff.md'], covers: allReqs.filter((id) => !respondReqs.includes(id)),
    handoff: tracked ? 'Open the original manuscript in Word, then Review → Compare → Compare…, with the original as the original document and revised_manuscript.docx from the download as the revised one; save the result as the tracked-changes version.' : undefined,
  };
  if (!integrate.handoff) delete integrate.handoff;

  const tiles = [matrix, ...sectionTiles, response, check, integrate];
  const rationale = [
    `Read as a revise-and-respond job: ${sectionTiles.length} sections of the manuscript${from ? ` (from the headings of ${from})` : ''} are revised at the same time against one matrix of every reviewer and editor comment, then answered point by point in the response letter.`,
    'Contract first: “Triage every comment into a revision plan” fixes which section answers which comment, and how, in comment_matrix.csv and the style sheet, so no comment is answered twice or missed.',
    `Then a check of the whole revision against the reviews, and one person assembles the clean manuscript and the final letter${tracked ? ' (the tracked-changes copy is made in Word from the download)' : ''}.`,
    keepNumbers ? 'Every tile keeps the numbers from the requester’s revised analyses exactly.' : '',
  ].filter(Boolean).join(' ');
  return { tiles, rationale };
}
