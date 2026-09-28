// Vocabulary the disaggregation engine reads jobs with: number words, units of work,
// languages, audiences, formats, and the cues that identify each kind of work.

export const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, dozen: 12, couple: 2, few: 3, several: 4, handful: 5,
};

/**
 * Units of work. `noun` matches singular or plural. `kind` says what a count of them means:
 *   items    - many similar things, done in batches (responses, listings, invoices)
 *   assets   - distinct pieces, one or a few per tile (episodes, charts, lessons)
 *   length   - the size of a document (pages, words)
 *   duration - hours or minutes of media
 *   period   - a span of time that data can be split along (years, months)
 *   region   - places data can be split along
 *   scale    - context only, not a split axis (guests, attendees)
 */
export const UNITS = [
  { key: 'response', noun: /(?:open[- ]ended\s+|survey\s+)?(?:responses?|answers?|comments?|submissions?)/, kind: 'items' },
  { key: 'record', noun: /records?|rows?|entries|entry|cases?|filings?|observations?/, kind: 'items' },
  { key: 'listing', noun: /(?:product\s+)?listings?|products?|skus?/, kind: 'items' },
  { key: 'item', noun: /(?:donated\s+|auction\s+)?items?/, kind: 'items' },
  { key: 'photo', noun: /photos?|photographs?|images?|pictures?/, kind: 'items' },
  { key: 'transaction', noun: /transactions?|invoices?|receipts?|expenses?|bills?/, kind: 'items' },
  { key: 'paper', noun: /papers?|studies|study|abstracts?|citations?/, kind: 'items' },
  { key: 'document', noun: /documents?|contracts?|files?|forms?|policies/, kind: 'items' },
  { key: 'contact', noun: /contacts?|leads?|donors?|prospects?|sponsors?|vendors?|venues?|businesses|organizations?|schools?|partners?|stores?|foundations?|funders?|nonprofits?|agencies|companies|restaurants?|landlords?|employers?|churches|clinics?|libraries|hospitals?|shops?|teams?|clubs?|artists?|speakers?|influencers?|journalists?|reporters?|podcasts?/, kind: 'items' },
  { key: 'interview', noun: /interviews?|focus groups?/, kind: 'assets' },
  { key: 'question', noun: /questions?/, kind: 'assets' },
  { key: 'episode', noun: /episodes?/, kind: 'assets' },
  { key: 'video', noun: /videos?|clips?|reels?/, kind: 'assets' },
  { key: 'lesson', noun: /lessons?|modules?|units?|sessions?|workshops?/, kind: 'assets' },
  { key: 'chapter', noun: /chapters?/, kind: 'assets' },
  { key: 'section', noun: /sections?|parts?/, kind: 'assets' },
  { key: 'post', noun: /(?:blog\s+|social(?:\s+media)?\s+)?posts?|articles?|newsletters?|emails?/, kind: 'assets' },
  { key: 'slide', noun: /slides?/, kind: 'assets' },
  { key: 'chart', noun: /charts?|graphs?|maps?|visuali[sz]ations?|infographics?/, kind: 'assets' },
  { key: 'screen', noun: /screens?|features?|endpoints?|pages?(?=\s+(?:of|for)\s+(?:the|our)\s+(?:site|app|website))/, kind: 'assets' },
  { key: 'recipe', noun: /recipes?/, kind: 'assets' },
  { key: 'page', noun: /pages?/, kind: 'length' },
  { key: 'word', noun: /words?/, kind: 'length' },
  { key: 'hour-media', noun: /hours?\s+of\s+(?:[a-z-]+\s+){0,3}?(?:audio|video|footage|recordings?|interviews?|tapes?|podcasts?|meetings?|lectures?|calls?|testimony)/, kind: 'duration' },
  { key: 'minute', noun: /minutes?|min/, kind: 'duration' },
  { key: 'language', noun: /languages?/, kind: 'languages' },
  { key: 'year', noun: /years?/, kind: 'period' },
  { key: 'month', noun: /months?/, kind: 'period' },
  { key: 'quarter', noun: /quarters?/, kind: 'period' },
  { key: 'region', noun: /count(?:y|ies)|states?|cities|city|countries|country|regions?|neighbou?rhoods?|districts?|locations?|sites?|branches?|campuses?/, kind: 'region' },
  { key: 'person', noun: /guests?|attendees?|participants?|people|students?|clients?|members?|residents?|volunteers?|employees?|staff|workers?|respondents?|users?|households?|customers?|shoppers?|visitors?|families|family|teens?|kids|children/, kind: 'scale' },
];

export const LANGUAGES = {
  spanish: 'es', 'español': 'es', french: 'fr', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', vietnamese: 'vi',
  arabic: 'ar', portuguese: 'pt', german: 'de', korean: 'ko', japanese: 'ja', russian: 'ru', hindi: 'hi',
  tagalog: 'tl', somali: 'so', navajo: 'nv', italian: 'it', haitian: 'ht', swahili: 'sw', ukrainian: 'uk',
};
export const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', zh: 'Chinese', vi: 'Vietnamese', ar: 'Arabic', pt: 'Portuguese', de: 'German', ko: 'Korean', ja: 'Japanese', ru: 'Russian', hi: 'Hindi', tl: 'Tagalog', so: 'Somali', nv: 'Navajo', it: 'Italian', ht: 'Haitian Creole', sw: 'Swahili', uk: 'Ukrainian' };

export const AUDIENCE_NOUNS = /\b(teens|teenagers|small businesses|policy committee|committee|city council|council|board|board members|families|parents|tenants|renters|reporters|journalists|students|teachers|donors|funders|customers|clients|patients|staff|volunteers|investors|residents|members|policymakers|legislators|voters|the public|general public|seniors|youth|kids|children|employees|managers|executives|partners|researchers|community|neighbors|users|visitors|attendees|guests)\b/g;

/** @type {[string, RegExp][]} */
export const FORMAT_CUES = [
  ['phone', /\b(phone|mobile|on a phone|smartphone|responsive)\b/],
  ['print', /\b(print|printable|printed|ready to print|hand ?out|paper copy)\b/],
  ['pdf', /\bpdf\b/],
  ['web', /\b(web|online|website|web page|webpage|browser)\b/],
  ['slides', /\b(slides?|slide deck|deck|powerpoint|presentation)\b/],
  ['video', /\b(video|film|youtube)\b/],
  ['audio', /\b(audio|podcast)\b/],
  ['spreadsheet', /\b(spreadsheet|excel|google sheets?|csv)\b/],
  ['accessible', /\b(accessib|screen reader|wcag|ada\b|plain language|plain english|easy to read)/],
];

export const SENSITIVE_CUES = /\b(names?|addresses?|phone numbers?|emails? addresses|ssn|social security|date of birth|dob|medical|health|patients?|student records?|students'? (?:names|records)|children'?s|minors?|immigration|income|salary|salaries|personal data|personally identifiable|pii|confidential|private|sensitive|hipaa|ferpa|donor names|criminal)\b/;

/** Words that make a clause a constraint or quality rather than a piece of work. */
export const QUALITY_CUES = /^(?:it\s+)?(?:should|must|needs? to|has to|keep|make sure|be)\b|\b(friendly|plain|simple|clear|concise|professional|accessible|readable|fast|secure|consistent|on[- ]brand|ready to print|work on a phone|mobile[- ]friendly|bilingual)\b/;

/**
 * Kinds of work. Each has verb and noun cues, a stage in the usual order of work, the
 * artifact kinds it consumes and produces (used to wire dependencies), skills and tier.
 */
export const ARCHETYPES = {
  collect: { label: 'Collect data', stage: 1, verbs: /\b(collect|gather|scrape|pull|download|compile|extract|export|harvest|assemble data|obtain|count)\b/, nouns: /\b(data ?set|dataset|raw data|records|filings|calendar|database extract|source data|(?:contact|mailing|donor|segment|prospect|email) list|segment list|counts|public data)\b/, needs: [], provides: ['data'], skills: ['research', 'data-entry'], tier: 2 },
  clean: { label: 'Clean and standardize', stage: 2, verbs: /\b(clean(?: up)?|standardi[sz]e|normali[sz]e|dedupe|de-?duplicate|fix|correct|tidy|reformat|validate)\b/, nouns: /\b(inconsistent|duplicates?|missing values|messy)\b/, needs: ['data'], provides: ['clean-data'], skills: ['data-cleaning', 'excel'], tier: 2 },
  enrich: { label: 'Fill in and enrich', stage: 2, verbs: /\b(fill (?:in )?missing|enrich|look up|match|geocode|append|tag with|add attributes)\b/, nouns: /\b(missing (?:sizes|attributes|fields|data)|attributes)\b/, needs: ['data'], provides: ['clean-data'], skills: ['data-entry', 'research'], tier: 1 },
  code: { label: 'Code and categorize', stage: 2, verbs: /\b(code|label|annotate|categori[sz]e|classify|tag|sort into)\b/, nouns: /\b(codebook|coding|themes|categories|labels)\b/, needs: ['data'], provides: ['coded'], skills: ['survey-coding'], tier: 2 },
  transcribe: { label: 'Transcribe', stage: 2, verbs: /\b(transcribe)\b/, nouns: /\b(transcripts?|transcription)\b/, needs: ['media'], provides: ['text-raw'], skills: ['transcription'], tier: 1 },
  catalog: { label: 'Catalog', stage: 2, verbs: /\b(catalog(?:ue)?(?:ed)?|inventory|list out|document each|record each|photograph and list|scan|digiti[sz]e|photograph)\b/, nouns: /\b(catalog(?:ue)?|inventory|auction items?|donated items?)\b/, needs: [], provides: ['data'], skills: ['data-entry'], tier: 1 },
  analyze: { label: 'Analyze', stage: 3, verbs: /\b(analy[sz]e|model|estimate|forecast|compare|test whether|measure|calculate|evaluate|assess|quantify|benchmark)\b/, nouns: /\b(analysis|regression|statistics|trends?|comparison|evaluation|impact|outcomes|tracker|metrics|kpis?|results|response times?)\b/, needs: ['clean-data', 'data', 'coded'], provides: ['findings'], skills: ['statistics', 'python'], tier: 3 },
  visualize: { label: 'Visualize', stage: 4, verbs: /\b(chart|graph|map|plot|visuali[sz]e)\b/, nouns: /\b(charts?|graphs?|maps?|trends?|trend lines?|breakdown|visuali[sz]ation|infographic|dashboard view)\b/, needs: ['clean-data', 'data', 'findings'], provides: ['visuals'], skills: ['data-viz'], tier: 2 },
  write: { label: 'Write', stage: 4, verbs: /\b(write|draft|compose|author|summari[sz]e|describe|explain|document)\b/, nouns: /\b(packet|booklet|pamphlet|welcome kit|manuscript|story|memo|notes?|show notes|emails?|email copy|social (?:media )?posts?|captions?|report|section|narrative|statement|summary|bio|copy|text|faq|article|post|essay|letter|script|story|description|guide|instructions|methodology|chapter|proposal|abstract|announcement|press release|newsletter|content)\b/, needs: [], provides: ['text'], skills: ['technical-writing'], tier: 2 },
  edit: { label: 'Edit and proofread', stage: 5, verbs: /\b(edit|proofread|copyedit|polish|revise|tighten)\b/, nouns: /\b(proofreading|copy ?editing)\b/, needs: ['text'], provides: ['text-final'], skills: ['editing'], tier: 2 },
  translate: { label: 'Translate', stage: 5, verbs: /\b(translate|locali[sz]e)\b/, nouns: /\b(translation|spanish version|french version|bilingual)\b/, needs: ['text'], provides: ['text-translated'], skills: ['translation'], tier: 2 },
  design: { label: 'Design', stage: 4, verbs: /\b(design|illustrate|lay ?out|brand)\b/, nouns: /\b(logo|brand(?:ing)?|poster|flyer|brochure|invitations?|slides?|graphics?|cover art|artwork|illustrations?|mockup|packaging|signage|banner|business cards?|templates?|slide deck|deck|visual identity|thumbnails?)\b/, needs: ['text'], provides: ['design'], skills: ['graphic-design'], tier: 2 },
  web: { label: 'Build web page', stage: 6, verbs: /\b(build|code|publish|set up|launch)\b/, nouns: /\b(website|web ?site|web page|webpage|landing page|(?:online )?registration(?: page| form)?|sign-?up (?:page|form|link)|online form|portal|microsite|donation page|dashboard)\b/, needs: ['text', 'design', 'visuals', 'text-translated', 'text-final'], provides: ['build'], skills: ['web-dev', 'html-css'], tier: 3 },
  software: { label: 'Build software', stage: 6, verbs: /\b(build|develop|code|program|implement|automate|integrate)\b/, nouns: /\b(app|application|ios|android|mobile|tool|software|plugin|extension|bot|api|script|pipeline|integration|automation|admin (?:screen|panel)|push (?:notifications?|reminders?)|database)\b/, needs: ['design', 'text'], provides: ['build'], skills: ['javascript', 'mobile-dev'], tier: 3 },
  research: { label: 'Research options', stage: 1, verbs: /\b(research|find|identify|shortlist|source|scout|compare options|get quotes|look into|survey the|review options|investigate|map out)\b/, nouns: /\b(surveys?|questionnaires?|polls?|shortlist|quotes?|options|vendors?|venues?|catering|suppliers?|competitors?|landscape|market|providers?|candidates|grants? to apply|funders?|sources)\b/, needs: [], provides: ['research'], skills: ['research'], tier: 2 },
  outreach: { label: 'Reach out', stage: 5, verbs: /\b(contact|call|email|reach out|recruit|invite|follow up|solicit|pitch|ask for|request)\b/, nouns: /\b(outreach|campaign|recruitment|donations|sponsorships?|rsvps?|invitations? to|letters? of (?:support|commitment|intent)|support letters?)\b/, needs: ['text', 'research'], provides: ['outreach-log'], skills: ['outreach', 'copywriting'], tier: 1 },
  schedule: { label: 'Plan logistics', stage: 4, verbs: /\b(schedule|plan|organi[sz]e|coordinate|book|arrange)\b/, nouns: /\b(run[- ]of[- ]show|schedule|timeline|agenda|itinerary|rota|roster|checklist|logistics|seating|floor plan|volunteer schedule|shifts?)\b/, needs: ['research'], provides: ['logistics'], skills: ['event-planning', 'project-management'], tier: 2 },
  media: { label: 'Produce media', stage: 3, verbs: /\b(record|film|shoot|produce|edit (?:the )?(?:video|audio|episode|footage)|mix|narrate|host)\b/, nouns: /\b(episodes?|podcast|videos?|footage|recordings?|audio|b-roll|voice ?over|narration|sound)\b/, needs: ['text'], provides: ['media'], skills: ['audio-editing', 'video-editing'], tier: 2 },
  teach: { label: 'Create learning material', stage: 4, verbs: /\b(teach|train|develop (?:a )?(?:course|curriculum|lesson))\b/, nouns: /\b(course|curriculum|lessons?|modules?|quiz(?:zes)?|training|workshop|lesson plans?|worksheets?)\b/, needs: [], provides: ['text'], skills: ['instructional-design'], tier: 2 },
  finance: { label: 'Finance and budget', stage: 4, verbs: /\b(reconcile|budget|categori[sz]e (?:expenses|transactions)|bookkeep|forecast (?:revenue|costs)|price|cost out)\b/, nouns: /\b(budget|bookkeeping|books|reconciliation|financial statements?|profit and loss|p&l|cash flow|projections|expenses|invoices|taxes|budget narrative|budget tracker)\b/, needs: ['research'], provides: ['finance'], skills: ['bookkeeping', 'excel'], tier: 2 },
  legal: { label: 'Legal and policy review', stage: 3, verbs: /\b(review (?:the )?(?:contracts?|terms|lease|policy|policies)|check compliance|audit (?:for )?compliance)\b/, nouns: /\b(contracts?|terms of service|privacy policy|compliance|legal|lease|bylaws|regulations?|ordinance|statutes?)\b/, needs: [], provides: ['text'], skills: ['legal-research'], tier: 3 },
  test: { label: 'Test and QA', stage: 6, verbs: /\b(test|qa|quality[- ]check|audit|verify|check)\b/, nouns: /\b(testing|test plan|bugs?|accessibility audit|usability test|qa)\b/, needs: ['build'], provides: ['qa'], skills: ['qa-review', 'testing'], tier: 2 },
  migrate: { label: 'Migrate data', stage: 2, verbs: /\b(migrate|convert|import|move|port|transfer|copy over)\b/, nouns: /\b(migration|conversion)\b/, needs: ['data'], provides: ['clean-data'], skills: ['sql', 'data-cleaning'], tier: 3 },
};

/** Kinds of job. The frame supplies the shared-conventions tile, default parts, and the final assembly. */
export const FRAMES = {
  event: /\b(event|conference|gala|wedding|(?<!third[- ])party|fundraiser|festival|summit|retreat|meetup|ceremony|reunion|banquet|fair|tournament|open house|launch party|celebration)\b/,
  translation: /\b(translat\w*|locali[sz]\w*|spanish version|french version|in (?:spanish|french|vietnamese|chinese|arabic))\b/,
  coding: /\b(code (?:the |our )?(?:open[- ]ended )?responses|qualitative coding|codebook|open[- ]ended (?:survey )?responses|interview transcripts)\b/,
  literature: /\b(literature review|systematic review|scoping review|annotated bibliography|evidence review|meta-analysis)\b/,
  dataproduct: /\b(dashboard|tracker|explorer|interactive (?:map|chart)|data ?set|database of|data portal|open data)\b/,
  software: /\b(app|application|ios|android|software|tool|plugin|extension|bot|api|automation|script|platform|system)\b/,
  web: /\b(website|web ?site|landing page|web page|webpage|microsite|online store|portal)\b/,
  media: /\b(podcast|video series|documentary|film|youtube|episodes?|videos?|audio series|radio)\b/,
  course: /\b(course|curriculum|training program|workshop series|lesson plans?|online class|bootcamp)\b/,
  campaign: /\b(campaign|outreach|fundraising drive|social media|marketing|recruitment drive|newsletter series|email series|advocacy)\b/,
  bulk: /\b(\d[\d,]*\s+(?:[a-z-]+\s+){0,2}(?:listings?|products?|records?|rows?|photos?|photographs?|images?|entries|items|invoices|receipts|transactions|documents|files|contacts|addresses|artifacts|objects|books|recipes))\b/,
  finance: /\b(bookkeeping|books|reconcil\w*|financial statements?|budget (?:for|of)|tax (?:prep|return)|audit (?:our|the) (?:finances|books))\b/,
  research: /\b(market research|user research|needs assessment|feasibility study|competitive analysis|landscape (?:scan|analysis)|interviews? with|focus groups?)\b/,
  document: /\b(report|analysis|proposal|grant|brief|white paper|memo|handbook|manual|guide|business plan|strategic plan|plan|policy|book|ebook|novel|memoir|toolkit|playbook|documentation|fact sheet|case study|essay|article|newsletter|annual report|application)\b/,
};

/** Standard parts for documents when the job doesn't list its own. */
export const DOCUMENT_SECTIONS = [
  { match: /\b(?:grant|annual|progress|impact|outcomes?|program) report\b/, sections: ['Program overview', 'Participation', 'Outcomes', 'Challenges and lessons', 'Plans for next year'], summary: 'Executive summary', skills: ['grant-writing', 'technical-writing'] },
  { match: /\bgrant|proposal|application\b/, sections: ['Statement of need', 'Goals and objectives', 'Program design and methods', 'Evaluation plan', 'Budget narrative', 'Organizational capacity'], summary: 'Project summary', skills: ['grant-writing', 'technical-writing'] },
  { match: /\bbusiness plan\b/, sections: ['Market analysis', 'Competitive landscape', 'Operations plan', 'Marketing plan', 'Financial projections'], summary: 'Executive summary', skills: ['technical-writing', 'research'] },
  { match: /\bstrategic plan|strategy\b/, sections: ['Situation analysis', 'Vision and priorities', 'Goals and strategies', 'Implementation plan', 'Measures of success'], summary: 'Executive summary', skills: ['technical-writing', 'research'] },
  { match: /\bpolicy brief|white paper|brief\b/, sections: ['Background', 'The problem in numbers', 'Policy options', 'Recommendations'], summary: 'Key takeaways', skills: ['technical-writing', 'research'] },
  { match: /\bhandbook|manual|guide|toolkit|playbook|documentation\b/, sections: ['Getting started', 'Roles and responsibilities', 'Procedures', 'Policies and safety', 'FAQ and contacts'], summary: 'Welcome and how to use this guide', skills: ['technical-writing', 'editing'] },
  { match: /\bannual report\b/, sections: ['Year in review', 'Programs and outcomes', 'Stories and quotes', 'Financial summary', 'Supporters and thanks'], summary: 'Letter from the director', skills: ['copywriting', 'technical-writing'] },
  { match: /\b(?:picture|children'?s|board) book\b/, sections: [], summary: null, skills: ['copywriting', 'editing'] },
  { match: /\bbook|ebook|novel|memoir\b/, sections: ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5', 'Chapter 6'], summary: null, skills: ['copywriting', 'editing'] },
  { match: /\breport|assessment|evaluation|study|analysis\b/, sections: ['Background and questions', 'Data and methods', 'Findings', 'Recommendations'], summary: 'Executive summary', skills: ['technical-writing', 'research'] },
  { match: /.*/, sections: ['Background', 'Main content', 'Recommendations and next steps'], summary: 'Summary', skills: ['technical-writing'] },
];

/** Default parts per frame when the job gives no list. Each is a short phrase run back through the archetype classifier. */
export const FRAME_DEFAULTS = {
  event: ['venue shortlist with quotes', 'catering quotes', 'invitations', 'registration page', 'run-of-show', 'volunteer schedule', 'budget tracker'],
  web: ['page copy', 'visual design and style tokens', 'build the pages', 'accessibility and phone testing'],
  software: ['data model and API', 'main user screens', 'admin screen', 'notifications', 'automated tests'],
  media: ['episode outlines and scripts', 'record and edit episodes', 'show notes', 'transcripts', 'cover art'],
  course: ['lessons', 'quizzes', 'slides', 'facilitator guide'],
  campaign: ['audience and message brief', 'contact list', 'email and social copy', 'graphics', 'outreach', 'results tracker'],
  research: ['desk research by topic', 'interview guide', 'interviews', 'synthesis of findings', 'final report'],
  finance: ['categorize transactions by month', 'reconcile accounts', 'financial statements', 'summary memo'],
  generic: [],
};

export const STOPWORDS = new Set('a an the and or of for to in on at by with from our my your their its this that these those we us you it is are be as into about over under per each every all any some such than then so also just very more most less least can could should would will may might must need needs our own new'.split(' '));
