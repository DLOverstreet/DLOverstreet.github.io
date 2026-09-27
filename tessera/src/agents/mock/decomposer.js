// Mock Decomposer: turns a commission into a tile graph from templates per kind of job.
// Every template tile carries a priority `p` (1 = essential). When the Decomposer is asked
// for a smaller scope, the least essential tiles are cut until the priced graph fits.
import { detectDomain, commissionContext } from './context.js';
import { priceGraph } from '../../domain/pricing.js';

function crit(list) {
  return list.map(([check, text, rule], i) => ({ id: `c${i + 1}`, text, check, ...(rule ? { rule } : {}) }));
}

function T(key, kind, title, spec, deliverableFormat, criteria, skillTags, tier, estMinutes, dependsOn = [], extra = {}) {
  return {
    key, kind, title, spec, deliverableFormat, acceptanceCriteria: crit(criteria), skillTags, tier, estMinutes, dependsOn,
    sensitiveInputs: extra.sensitiveInputs || [], languages: extra.languages || [], p: extra.p ?? 1,
  };
}

const context = (x) => `Context: this tile is one piece of "${x.title}". The requester's goal: ${x.goal}`;

const TEMPLATES = {
  dashboard(x) {
    const tiles = [
      T('collect-records', 'WORK', `Collect the ${x.topic}`,
        `${context(x)}\n\nWrite a script that collects the ${x.topic} for ${x.place} from the public source named in the goal. Save one row per case in raw_records.csv with the columns case_id, filed_date, case_type, address, zip. Put a comment at the top of the script with the source URL and the command to rerun it. Do not collect the names of any people.`,
        'Python script (.py) plus raw_records.csv',
        [['AUTO', 'The submission includes the collection script', 'file_ext(py)'],
          ['AUTO', 'raw_records.csv has case_id, filed_date, case_type, address and zip', 'csv_columns(case_id, filed_date, case_type, address, zip)'],
          ['AUTO', 'At least 50 records were collected', 'csv_min_rows(50)'],
          ['LLM', 'The script states its source URL and how to rerun it']],
        ['python', 'web-scraping'], 3, 90, [], { sensitiveInputs: ['address'] }),
      T('clean-records', 'WORK', 'Clean and standardize the records',
        `${context(x)}\n\nYou receive raw_records.csv from the collection tile. Produce clean_records.csv: one row per unique case_id, filed_date as YYYY-MM-DD, case_type upper-cased and trimmed, zip as five digits. Drop exact duplicates. Write cleaning_notes.md listing every rule you applied and how many rows each one changed.`,
        'clean_records.csv plus cleaning_notes.md',
        [['AUTO', 'clean_records.csv keeps case_id, filed_date, case_type and zip', 'csv_columns(case_id, filed_date, case_type, zip)'],
          ['AUTO', 'Every case_id appears once', 'csv_unique(case_id)'],
          ['AUTO', 'No filed_date is blank', 'csv_no_blank(filed_date)'],
          ['LLM', 'The cleaning notes list every rule applied and its row count']],
        ['python', 'data-cleaning'], 2, 60, ['collect-records']),
      T('geocode-records', 'WORK', 'Geocode addresses to census tracts',
        `${context(x)}\n\nUsing clean_records.csv, geocode each address to latitude, longitude and census tract with the free Census Geocoder batch service (or an equivalent). Output geocoded.csv with case_id, lat, lon, tract and match_quality. Report the match rate in a short note. Addresses are sensitive: keep them out of every output file.`,
        'geocoded.csv plus a short note on the match rate',
        [['AUTO', 'geocoded.csv has case_id, lat, lon and tract', 'csv_columns(case_id, lat, lon, tract)'],
          ['AUTO', 'Every row has a tract', 'csv_no_blank(tract)'],
          ['LLM', 'The note reports the match rate and how unmatched rows were handled']],
        ['geocoding', 'gis'], 3, 75, ['clean-records'], { sensitiveInputs: ['address'] }),
      T('check-case-types', 'WORK', 'Check the case-type codes',
        `${context(x)}\n\nThe court uses short case-type codes in clean_records.csv. Build case_types.csv mapping every code to a plain-language description and a yes/no is_eviction flag, using the court's published code list. Write a memo of 150 to 600 words explaining any ambiguous codes and how you decided.`,
        'case_types.csv plus memo.md (150–600 words)',
        [['AUTO', 'case_types.csv has case_type, description and is_eviction', 'csv_columns(case_type, description, is_eviction)'],
          ['AUTO', 'The memo is 150 to 600 words', 'word_count(150, 600)'],
          ['LLM', 'The memo explains each ambiguous code and the decision made']],
        ['legal-research'], 3, 45, ['clean-records']),
      T('chart-trend', 'WORK', 'Design the monthly trend chart',
        `${context(x)}\n\nDesign a line chart of filings per month from clean_records.csv, for ${x.audience}. Deliver the chart as an SVG and a JSON spec with title, source and series (an array of {month, filings}). The title should state the finding in plain words.`,
        'chart-trend.svg plus chart-trend.json',
        [['AUTO', 'The chart is delivered as SVG', 'file_ext(svg)'],
          ['AUTO', 'The JSON spec has title, source and series', 'json_keys(title, source, series)'],
          ['LLM', 'The title states the finding rather than naming the metric'],
          ['PEER', 'The chart is legible for a general audience at phone width']],
        ['data-viz', 'svg'], 2, 60, ['clean-records'], { p: 1 }),
      T('chart-map', 'WORK', 'Design the tract map',
        `${context(x)}\n\nMap filings per 1,000 renter households by census tract, using geocoded.csv. Deliver an SVG choropleth and a JSON spec with title, source and series (an array of {tract, rate}). Use a colorblind-safe sequential palette and a legend.`,
        'chart-map.svg plus chart-map.json',
        [['AUTO', 'The map is delivered as SVG', 'file_ext(svg)'],
          ['AUTO', 'The JSON spec has title, source and series', 'json_keys(title, source, series)'],
          ['LLM', 'The legend explains the rate and its units']],
        ['data-viz', 'gis'], 2, 75, ['geocode-records'], { p: 2 }),
      T('chart-by-type', 'WORK', 'Design the case-type breakdown',
        `${context(x)}\n\nMake a bar chart of filings by case type, using the descriptions in case_types.csv. Deliver an SVG and a JSON spec with title, source and series (an array of {case_type, filings}).`,
        'chart-by-type.svg plus chart-by-type.json',
        [['AUTO', 'The chart is delivered as SVG', 'file_ext(svg)'],
          ['AUTO', 'The JSON spec has title, source and series', 'json_keys(title, source, series)'],
          ['LLM', 'Bars use the plain-language descriptions, not the raw codes']],
        ['data-viz', 'svg'], 2, 45, ['check-case-types'], { p: 3 }),
      T('methodology-note', 'WORK', 'Write the methodology note',
        `${context(x)}\n\nWrite methodology.md (400 to 700 words) for ${x.audience}: where the data comes from, how it was cleaned and geocoded, what the case-type flags mean, and the limits of the data. Use the cleaning notes and the case-type memo as inputs. End with a "Sources" heading.`,
        'methodology.md, 400–700 words',
        [['AUTO', 'The note is 400 to 700 words', 'word_count(400, 700)'],
          ['AUTO', 'The note ends with a Sources section', 'has_heading("Sources")'],
          ['LLM', 'Data limitations are explained in plain language']],
        ['technical-writing', 'methodology'], 2, 60, ['clean-records', 'check-case-types']),
      T('qa-data', 'REVIEW', 'QA the data pipeline',
        `${context(x)}\n\nRe-run the cleaning and geocoding outputs against the raw records and check row counts, duplicate case_ids, date ranges and the tract match rate. Write qa-data.md with a "Findings" section listing every check with pass or fail.`,
        'qa-data.md with a Findings section',
        [['AUTO', 'The report has a Findings section', 'contains("Findings")'],
          ['LLM', 'Every check is listed with pass or fail and a count']],
        ['qa-review', 'python'], 2, 45, ['geocode-records', 'check-case-types'], { p: 4 }),
      T('integrate-dashboard', 'INTEGRATION', 'Assemble the dashboard page',
        `${context(x)}\n\nBuild a single static index.html that shows the charts with short captions, links the methodology note, and works on a phone. Use the SVGs and JSON specs from the chart tiles as they are. Include a "Methodology" link or section.`,
        'index.html plus any assets',
        [['AUTO', 'The page is delivered as HTML', 'file_ext(html)'],
          ['AUTO', 'The page links or includes the methodology', 'contains("Methodology")'],
          ['LLM', 'Every chart has a caption that states what it shows']],
        ['web-dev', 'html-css', 'project-integration'], 3, 120, ['chart-trend', 'chart-map', 'chart-by-type', 'methodology-note', 'qa-data']),
    ];
    if (x.wantsTranslation) {
      tiles.splice(8, 0, T(`translate-${x.targetLang}`, 'WORK', `Translate the page text into ${x.langName}`,
        `${context(x)}\n\nTranslate methodology.md and the chart titles and captions into ${x.langName} for ${x.audience}. Keep headings and numbers as they are. Deliver methodology.${x.targetLang}.md.`,
        `methodology.${x.targetLang}.md`,
        [['AUTO', 'The translation is 350 to 900 words', 'word_count(350, 900)'],
          ['LLM', `The translation is faithful and written in plain ${x.langName}`]],
        [`translation-${x.targetLang}`], 2, 60, ['methodology-note'], { languages: ['en', x.targetLang], p: 3 }));
      tiles[tiles.length - 1].dependsOn.push(`translate-${x.targetLang}`);
    }
    return { rationale: `Split the dashboard into a data pipeline (collect → clean → geocode, with the case-type check in parallel), independent chart designs, a methodology note${x.wantsTranslation ? `, a ${x.langName} translation` : ''}, a QA pass, and a human integration tile that assembles the page. Charts run in parallel once the clean data exists.`, tiles };
  },

  translation(x) {
    return {
      rationale: `A shared glossary comes first so every translator uses the same terms. The two documents are translated in parallel, a proofreader checks both, and one person lays out the final version.`,
      tiles: [
        T('build-glossary', 'WORK', `Build a ${x.langName} glossary`,
          `${context(x)}\n\nRead the source text and list the 10 or more terms that must be translated the same way everywhere (program names, legal terms, form labels). Deliver glossary.csv with the columns term_en, term_${x.targetLang} and note, using plain ${x.langName} a reader with an eighth-grade reading level understands.`,
          'glossary.csv',
          [['AUTO', `glossary.csv has term_en, term_${x.targetLang} and note`, `csv_columns(term_en, term_${x.targetLang}, note)`],
            ['AUTO', 'At least 10 terms are listed', 'csv_min_rows(10)'],
            ['LLM', `Terms use plain, widely understood ${x.langName}`]],
          [`translation-${x.targetLang}`, 'copywriting'], 2, 30, [], { languages: ['en', x.targetLang] }),
        T('translate-main', 'WORK', `Translate the main document`,
          `${context(x)}\n\nTranslate the main document (the first attached file or the text in the goal) into ${x.langName}, using glossary.csv for every listed term. Keep the headings and structure. Deliver main.${x.targetLang}.md.`,
          `main.${x.targetLang}.md`,
          [['AUTO', 'The translation is delivered as Markdown', 'file_ext(md)'],
            ['AUTO', 'The translation is 150 to 900 words', 'word_count(150, 900)'],
            ['LLM', 'Every glossary term is used consistently']],
          [`translation-${x.targetLang}`], 2, 60, ['build-glossary'], { languages: ['en', x.targetLang] }),
        T('translate-faq', 'WORK', `Translate the FAQ`,
          `${context(x)}\n\nTranslate the FAQ (the second attached file, or the questions listed in the goal) into ${x.langName}, using glossary.csv. Keep one question per heading. Deliver faq.${x.targetLang}.md.`,
          `faq.${x.targetLang}.md`,
          [['AUTO', 'The translation is delivered as Markdown', 'file_ext(md)'],
            ['AUTO', 'The translation is 150 to 900 words', 'word_count(150, 900)'],
            ['LLM', 'Questions keep their meaning and every glossary term is used consistently']],
          [`translation-${x.targetLang}`], 2, 60, ['build-glossary'], { languages: ['en', x.targetLang], p: 2 }),
        T('proofread', 'REVIEW', 'Proofread both translations',
          `${context(x)}\n\nRead both translations against the source and the glossary. Deliver proofread.md with a "Findings" section listing each correction you recommend, and a corrected copy of each file if you changed anything.`,
          'proofread.md with a Findings section',
          [['AUTO', 'The report has a Findings section', 'contains("Findings")'],
            ['LLM', 'Each finding quotes the original and the suggested fix']],
          [`translation-${x.targetLang}`, 'editing'], 2, 30, ['translate-main', 'translate-faq'], { languages: ['en', x.targetLang], p: 3 }),
        T('lay-out-final', 'INTEGRATION', 'Lay out the final version',
          `${context(x)}\n\nApply the proofreader's fixes and lay out the final ${x.langName} version so it matches the original's structure. Deliver final.${x.targetLang}.md (or .html) with a line at the end crediting the translation.`,
          `final.${x.targetLang}.md or .html`,
          [['AUTO', 'The final version is Markdown or HTML', 'file_ext(md|html)'],
            ['LLM', 'The layout keeps the original structure and applies the proofreader’s fixes']],
          ['copywriting', `translation-${x.targetLang}`], 2, 45, ['proofread'], { languages: ['en', x.targetLang] }),
      ],
    };
  },

  survey(x) {
    return {
      rationale: 'A codebook comes first. The responses are then coded in three parallel batches, an agreement check compares the coders, and a short memo summarizes the themes before a final integration pass.',
      tiles: [
        T('draft-codebook', 'WORK', 'Draft the codebook',
          `${context(x)}\n\nRead a sample of about 60 open-ended responses and draft a codebook of 8 to 15 codes. Deliver codebook.csv with code, label, definition and example (a short, anonymized quote).`,
          'codebook.csv',
          [['AUTO', 'codebook.csv has code, label, definition and example', 'csv_columns(code, label, definition, example)'],
            ['AUTO', 'At least 8 codes are defined', 'csv_min_rows(8)'],
            ['LLM', 'Codes are distinct and each definition says what is excluded']],
          ['survey-coding', 'statistics'], 3, 60, [], { sensitiveInputs: ['responses'] }),
        ...[1, 2, 3].map((b) => T(`code-batch-${b}`, 'WORK', `Code response batch ${b}`,
          `${context(x)}\n\nApply codebook.csv to batch ${b} of the responses (about 40 rows). Deliver coded_batch_${b}.csv with response_id and code, one row per response. Use the "OTHER" code when nothing fits and explain it in the notes.`,
          `coded_batch_${b}.csv`,
          [['AUTO', 'The file has response_id and code', 'csv_columns(response_id, code)'],
            ['AUTO', 'Every response has a code', 'csv_no_blank(code)'],
            ['AUTO', 'At least 40 responses are coded', 'csv_min_rows(40)']],
          ['survey-coding'], 2, 90, ['draft-codebook'], { sensitiveInputs: ['responses'], p: b === 3 ? 3 : 1 })),
        T('agreement-check', 'REVIEW', 'Check coder agreement',
          `${context(x)}\n\nDouble-code 30 responses from across the batches and compute Cohen's kappa per code. Deliver agreement.md reporting kappa for each code and recommending codebook fixes where it is below 0.6.`,
          'agreement.md',
          [['AUTO', 'The report states kappa', 'contains("kappa")'],
            ['LLM', 'Agreement is reported per code with a recommendation where it is low']],
          ['statistics', 'survey-coding'], 3, 45, ['code-batch-1', 'code-batch-2', 'code-batch-3'], { p: 2 }),
        T('themes-memo', 'WORK', 'Write the themes memo',
          `${context(x)}\n\nUsing the coded batches and the agreement report, write themes.md (500 to 900 words) for ${x.audience}: the main themes, how often each appeared, and two anonymized quotes per theme. Include a "Themes" heading.`,
          'themes.md, 500–900 words',
          [['AUTO', 'The memo is 500 to 900 words', 'word_count(500, 900)'],
            ['AUTO', 'The memo has a Themes section', 'has_heading("Themes")'],
            ['LLM', 'Every theme reports a count and quotes are anonymized']],
          ['technical-writing'], 2, 60, ['agreement-check']),
        T('integrate-report', 'INTEGRATION', 'Assemble the coding report',
          `${context(x)}\n\nCombine the codebook, the merged coded responses and the themes memo into report.md with a "Codebook" section, and attach coded_all.csv.`,
          'report.md plus coded_all.csv',
          [['AUTO', 'The report includes the codebook', 'contains("Codebook")'],
            ['AUTO', 'The merged file has response_id and code', 'csv_columns(response_id, code)'],
            ['LLM', 'The report reads as one document, not pasted pieces']],
          ['project-integration', 'editing'], 2, 45, ['themes-memo']),
      ],
    };
  },

  literature(x) {
    return {
      rationale: 'A search protocol comes first, then screening in two parallel batches, data extraction, two synthesis sections written in parallel, a citation check, and an integration pass.',
      tiles: [
        T('search-protocol', 'WORK', 'Write the search protocol',
          `${context(x)}\n\nDefine databases, search strings, date range and inclusion criteria, then run the searches. Deliver protocol.md and candidates.csv with id, title, year, source and url.`,
          'protocol.md plus candidates.csv',
          [['AUTO', 'candidates.csv has id, title, year, source and url', 'csv_columns(id, title, year, source, url)'],
            ['AUTO', 'At least 40 candidate papers were found', 'csv_min_rows(40)'],
            ['LLM', 'Inclusion criteria are specific enough for two screeners to agree']],
          ['literature-review', 'research'], 3, 90),
        ...['a', 'b'].map((b, i) => T(`screen-batch-${b}`, 'WORK', `Screen batch ${b.toUpperCase()}`,
          `${context(x)}\n\nScreen half ${i + 1} of candidates.csv against the inclusion criteria in protocol.md. Deliver screened_${b}.csv with id, decision (include/exclude) and reason.`,
          `screened_${b}.csv`,
          [['AUTO', 'The file has id, decision and reason', 'csv_columns(id, decision, reason)'],
            ['AUTO', 'Every paper has a decision', 'csv_no_blank(decision)']],
          ['literature-review'], 2, 60, ['search-protocol'])),
        T('extract-data', 'WORK', 'Extract study details',
          `${context(x)}\n\nFor every included paper, record design, sample, setting and main finding. Deliver extraction.csv with id, design, sample, setting and finding.`,
          'extraction.csv',
          [['AUTO', 'extraction.csv has id, design, sample, setting and finding', 'csv_columns(id, design, sample, setting, finding)'],
            ['LLM', 'Findings are stated as the paper states them, without overreach']],
          ['research', 'literature-review'], 3, 90, ['screen-batch-a', 'screen-batch-b']),
        T('synthesis-findings', 'WORK', 'Write the findings synthesis',
          `${context(x)}\n\nUsing extraction.csv, write findings.md (500 to 900 words) grouping results by theme, with in-text citations by id.`,
          'findings.md',
          [['AUTO', 'The synthesis is 500 to 900 words', 'word_count(500, 900)'],
            ['LLM', 'Every claim cites at least one included paper']],
          ['technical-writing', 'research'], 3, 90, ['extract-data']),
        T('citation-check', 'REVIEW', 'Check the citations',
          `${context(x)}\n\nCheck that every citation in findings.md matches an included paper and that the reference list is complete. Deliver citation-check.md with a "Findings" section.`,
          'citation-check.md',
          [['AUTO', 'The report has a Findings section', 'contains("Findings")'],
            ['LLM', 'Each problem names the citation and the fix']],
          ['citation-management'], 2, 45, ['synthesis-findings'], { p: 2 }),
        T('integrate-review', 'INTEGRATION', 'Assemble the review',
          `${context(x)}\n\nCombine the protocol, a PRISMA-style count of papers screened and included, the synthesis and a reference list into review.md with a "References" heading.`,
          'review.md',
          [['AUTO', 'The review has a References section', 'has_heading("References")'],
            ['LLM', 'Counts of screened and included papers are consistent']],
          ['editing', 'project-integration'], 2, 60, ['citation-check']),
      ],
    };
  },

  website(x) {
    return {
      rationale: 'Copy and a visual mockup are made in parallel, the page is built from both, an accessibility audit checks it, and one person integrates the fixes.',
      tiles: [
        T('write-copy', 'WORK', 'Write the page copy',
          `${context(x)}\n\nWrite copy.md (300 to 700 words) for ${x.audience}: a headline, three short sections and a call to action. Plain language, eighth-grade reading level.`,
          'copy.md',
          [['AUTO', 'The copy is 300 to 700 words', 'word_count(300, 700)'],
            ['LLM', 'The copy has one clear call to action']],
          ['copywriting'], 2, 60),
        T('design-mockup', 'WORK', 'Design the page mockup',
          `${context(x)}\n\nDesign a mobile-first mockup of the page as an SVG, with a style.json listing colors and fonts (keys: colors, fonts).`,
          'mockup.svg plus style.json',
          [['AUTO', 'The mockup is an SVG', 'file_ext(svg)'],
            ['AUTO', 'style.json lists colors and fonts', 'json_keys(colors, fonts)'],
            ['PEER', 'The design is clear and readable on a phone']],
          ['figma', 'svg'], 2, 90),
        T('build-page', 'WORK', 'Build the page',
          `${context(x)}\n\nBuild index.html from copy.md and the mockup, using semantic HTML and no external dependencies.`,
          'index.html',
          [['AUTO', 'The page is HTML', 'file_ext(html)'],
            ['LLM', 'The page uses semantic landmarks and headings']],
          ['html-css', 'web-dev'], 3, 120, ['write-copy', 'design-mockup']),
        T('accessibility-audit', 'REVIEW', 'Audit accessibility',
          `${context(x)}\n\nAudit index.html against WCAG 2.2 AA. Deliver audit.md with a "Findings" section listing each issue, where it is and the fix.`,
          'audit.md',
          [['AUTO', 'The audit has a Findings section', 'contains("Findings")'],
            ['LLM', 'Each finding cites the WCAG criterion']],
          ['accessibility', 'qa-review'], 2, 45, ['build-page'], { p: 2 }),
        T('integrate-site', 'INTEGRATION', 'Apply fixes and publish',
          `${context(x)}\n\nApply the audit fixes to index.html and deliver the final page with a short changelog.md.`,
          'index.html plus changelog.md',
          [['AUTO', 'The final page is HTML', 'file_ext(html)'],
            ['LLM', 'Every audit finding is addressed or explained in the changelog']],
          ['web-dev', 'project-integration'], 2, 60, ['accessibility-audit']),
      ],
    };
  },

  report(x) {
    return {
      rationale: 'An outline sets the argument, a data pull and analysis run alongside the drafting of the background section, a chart and the findings section follow the analysis, an editor checks the whole, and one person assembles it.',
      tiles: [
        T('outline', 'WORK', 'Outline the report',
          `${context(x)}\n\nWrite outline.md: the question, the audience (${x.audience}), the 3 to 5 sections with one-sentence summaries, and the data each needs.`,
          'outline.md',
          [['AUTO', 'The outline is 150 to 500 words', 'word_count(150, 500)'],
            ['LLM', 'Each section names the data it needs']],
          ['technical-writing', 'research'], 2, 45),
        T('pull-data', 'WORK', 'Pull the data',
          `${context(x)}\n\nCollect the data named in outline.md from public sources. Deliver data.csv with year, measure and value, and sources.md listing each source with a URL.`,
          'data.csv plus sources.md',
          [['AUTO', 'data.csv has year, measure and value', 'csv_columns(year, measure, value)'],
            ['AUTO', 'At least 10 rows of data', 'csv_min_rows(10)'],
            ['LLM', 'Every series has a named public source']],
          ['research', 'excel'], 2, 60, ['outline']),
        T('analyze', 'WORK', 'Run the analysis',
          `${context(x)}\n\nAnalyze data.csv: trends, comparisons and any simple models the outline calls for. Deliver analysis.md with the numbers each section will cite, and the script you used.`,
          'analysis.md plus the script',
          [['AUTO', 'The analysis includes its script', 'file_ext(py|r|sql)'],
            ['LLM', 'Every number in analysis.md can be traced to the script']],
          ['statistics', 'python'], 3, 90, ['pull-data']),
        T('chart', 'WORK', 'Make the key chart',
          `${context(x)}\n\nMake the one chart that carries the main finding, as SVG plus a JSON spec with title, source and series.`,
          'chart.svg plus chart.json',
          [['AUTO', 'The chart is SVG', 'file_ext(svg)'],
            ['AUTO', 'The spec has title, source and series', 'json_keys(title, source, series)']],
          ['data-viz'], 2, 60, ['analyze'], { p: 2 }),
        T('draft-findings', 'WORK', 'Draft the findings section',
          `${context(x)}\n\nWrite findings.md (500 to 900 words) from analysis.md for ${x.audience}.`,
          'findings.md',
          [['AUTO', 'The section is 500 to 900 words', 'word_count(500, 900)'],
            ['LLM', 'Every number matches analysis.md']],
          ['technical-writing'], 2, 90, ['analyze']),
        T('edit', 'REVIEW', 'Edit for clarity',
          `${context(x)}\n\nEdit findings.md for plain language and consistency with outline.md. Deliver edit-notes.md with a "Findings" section and a revised findings.md.`,
          'edit-notes.md plus revised findings.md',
          [['AUTO', 'The notes have a Findings section', 'contains("Findings")'],
            ['LLM', 'Edits keep every number unchanged']],
          ['editing'], 2, 45, ['draft-findings'], { p: 3 }),
        T('assemble-report', 'INTEGRATION', 'Assemble the report',
          `${context(x)}\n\nCombine the outline, findings, chart and sources into report.md with a "Sources" heading.`,
          'report.md',
          [['AUTO', 'The report has a Sources section', 'has_heading("Sources")'],
            ['LLM', 'The report reads as one document']],
          ['editing', 'project-integration'], 2, 60, ['chart', 'edit']),
      ],
    };
  },

  generic(x) {
    return {
      rationale: 'The job is planned first, split into two parts that can be done in parallel, reviewed, and brought together by one person.',
      tiles: [
        T('plan-approach', 'WORK', 'Plan the approach',
          `${context(x)}\n\nWrite plan.md (200 to 600 words): what "done" looks like, the two parts the work splits into, and the inputs each needs.`,
          'plan.md',
          [['AUTO', 'The plan is 200 to 600 words', 'word_count(200, 600)'],
            ['LLM', 'The plan defines two parts that can be done independently']],
          ['research', 'technical-writing'], 2, 45),
        T('part-one', 'WORK', 'Produce part one',
          `${context(x)}\n\nProduce the first part described in plan.md. Deliver part-one.md (300 to 900 words) plus any files it refers to.`,
          'part-one.md',
          [['AUTO', 'Part one is 300 to 900 words', 'word_count(300, 900)'],
            ['LLM', 'Part one covers everything plan.md assigns to it']],
          ['research'], 2, 90, ['plan-approach']),
        T('part-two', 'WORK', 'Produce part two',
          `${context(x)}\n\nProduce the second part described in plan.md. Deliver part-two.md (300 to 900 words) plus any files it refers to.`,
          'part-two.md',
          [['AUTO', 'Part two is 300 to 900 words', 'word_count(300, 900)'],
            ['LLM', 'Part two covers everything plan.md assigns to it']],
          ['research'], 2, 90, ['plan-approach']),
        T('review-parts', 'REVIEW', 'Review both parts',
          `${context(x)}\n\nCheck both parts against plan.md. Deliver review.md with a "Findings" section.`,
          'review.md',
          [['AUTO', 'The review has a Findings section', 'contains("Findings")'],
            ['LLM', 'Each finding names the part and the fix']],
          ['qa-review'], 2, 30, ['part-one', 'part-two'], { p: 2 }),
        T('integrate', 'INTEGRATION', 'Bring the parts together',
          `${context(x)}\n\nMerge both parts into final.md, applying the review's fixes.`,
          'final.md',
          [['AUTO', 'The final document is Markdown', 'file_ext(md)'],
            ['LLM', 'The final document reads as one piece']],
          ['editing', 'project-integration'], 2, 45, ['review-parts']),
      ],
    };
  },
};

/** Removes a tile and reconnects its dependents to its own upstream tiles. */
function dropTile(tiles, key) {
  const gone = tiles.find((t) => t.key === key);
  const rest = tiles.filter((t) => t.key !== key);
  for (const t of rest) {
    if (t.dependsOn.includes(key)) {
      t.dependsOn = [...new Set([...t.dependsOn.filter((d) => d !== key), ...gone.dependsOn])];
    }
  }
  return rest;
}

export function mockDecompose(input) {
  const x = commissionContext(input);
  const domain = detectDomain(input.commission || {});
  const plan = TEMPLATES[domain](x);
  let tiles = plan.tiles.map((t) => ({ ...t, dependsOn: [...t.dependsOn] }));
  let rationale = plan.rationale;
  const cuts = [];
  const max = input.scopeInstruction?.maxTotalCents;
  if (max) {
    const rush = !!input.scopeInstruction.rush;
    const order = [...tiles].filter((t) => t.p > 1).sort((a, b) => b.p - a.p);
    for (const t of order) {
      if (priceGraph(tiles, { rush }).total <= max) break;
      tiles = dropTile(tiles, t.key);
      cuts.push(t.title);
    }
    // Still over: drop optional REVIEW tiles, then parallel work tiles, but keep the first WORK tile and the integration tile.
    const work = tiles.filter((t) => t.kind === 'WORK');
    for (const t of [...work].reverse().slice(0, Math.max(0, work.length - 1))) {
      if (priceGraph(tiles, { rush }).total <= max) break;
      if (tiles.some((o) => o.dependsOn.includes(t.key) && o.kind === 'WORK')) continue;
      tiles = dropTile(tiles, t.key);
      cuts.push(t.title);
    }
    if (cuts.length) rationale += ` To fit the budget, cut: ${cuts.join('; ')}. Rates are unchanged.`;
  }
  return { rationale, tiles: tiles.map(({ p, ...t }) => t) };
}
