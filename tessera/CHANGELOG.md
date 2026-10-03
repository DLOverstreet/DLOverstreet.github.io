# Changelog

## 2026-10-03
- **Free models keep working when a provider retires one.** Google stopped serving
  `gemini-2.5-flash` to new keys (404 "no longer available"), so every free-only call failed. A
  model a provider no longer serves is now replaced by the best one its model list offers (a Flash
  model, newest first), the call is retried, and the new name is saved in Settings. Gemini's default
  is now `gemini-flash-latest`, Google's alias that follows the current Flash model.

## 2026-09-30 (later)
- **Free models only.** A new platform provider in Settings runs every agent (scoping, planning,
  workers, supervisors, reviewers, assembly) on the free providers you set up (Gemini, Groq,
  OpenRouter, Ollama), with no Claude fallback, so you can see what free models produce. A provider
  at its per-minute limit is waited for (up to three minutes a call); when every provider has used
  its daily quota the job stops with that message. Web research is off (it needs Claude's tools).
  Private jobs use only a local model unless you allow the free cloud models. A button sets the
  swarm to fit free-tier limits (one agent per tile, one call at a time). Replies are capped at each
  provider's maximum length.
- Fixed: a contributor route's explanatory note shared a name with the new fallback route and could
  have been mistaken for one.

## 2026-09-30
- **Cheaper runs.** The biggest costs on a swarm job were the competitors each writing whole drafts
  two or three times and every tile re-sending the requester's files. Now:
  - *More of each prompt is cached.* The worker prompt (`worker.v5`) caches the system prompt for an
    hour, puts the requester's whole files in the hour-long job layer (the same bytes for every tile,
    so a long manuscript is written to the cache once per job and reread at a tenth of the price or
    less), and moves the playbook out of the shared prefix so the control worker shares the task
    layer too. Every worker call caches, including agents working alone.
  - *Revisions by edits.* A worker revising its own draft can hand back edits (find, replace) instead
    of the whole file, and gets its own draft in full to edit.
  - *A notes round instead of whole drafts.* After a blind round that isn't a clean win, workers read
    the supervisor's scores and summaries, each other's notes and approaches (one shared, cached
    block) and revise. Whole drafts are still a setting. With **finalists**, only the best go on.
  - *Cheaper models where they're enough.* A cheaper challenger (free models, Haiku or Sonnet) can
    compete on every task; a winning config is first cloned onto the next cheaper Claude model;
    configs that score about the same are ranked cheapest first. Worker and supervisor effort are
    settings. An **Economy** preset sets all of this at once.
  - *Free models first.* Gemini's, Groq's and OpenRouter's free tiers, or Ollama, can take light
    work, a challenger slot and agents working alone before Claude; on a quota, an error or an
    answer that fails its checks, the call goes to Claude. Only jobs marked Public go to cloud free
    tiers (Google's free tier may learn from what you send).
  - *Half-price batches.* An opt-in mode sends the swarm's calls through Anthropic's Message
    Batches API at half price; jobs take longer.
  - Admin → Cost per commission shows what the cache, batches and free models saved.
- **Agents talk on the wire.** Agents post short notes to the agents on the job's other tiles or to
  their rivals on the same task, read the others' before they work, and say which notes they used.
  A note that accepted work relied on earns its author an assist, shown on the leaderboard and
  counted in the rankings. The Supervision page lists the wire and who used each note.

## 2026-09-29 (night)
- Word copies no longer print `****` in empty table header cells.
- **Planning the manuscript revision, take two.** The run showed three more ways planning failed:
  - A complete 27-tile plan (46,000 tokens, 6.5 minutes, $1.04) was rejected because some tile
    titles ran past 80 characters. Model plans now use a looser tile schema; long titles are clipped
    and bad keys, stray dependencies, loops, oversized tiles and criteria ids are fixed by graph
    repair, as they always could be, instead of sending the whole plan back.
  - The retry asked the model to write the whole plan again, which ran past the SDK's 10-minute
    limit twice (18.5 minutes). A failed one-shot plan is no longer retried: planning goes to stages.
    Long calls get 30 minutes and no silent SDK retries; a timed-out reply retries with less thinking.
  - The staged calls failed within seconds with no reply (most likely rate limits after that
    burst). Rate-limit and overload errors now carry the API's retry-after, and runAgent waits it out
    (at least 5 s, longer each time) before the next try; the error reason shows in the Agent runs list.
  - A job with long attachments (more than 20,000 characters of text), or an engine plan of more
    than 12 tiles, is planned in stages from the start: a short skeleton, then the workstreams at once.
- **Unsticking a job.** A job left running when the page closed or reloaded starts again; Resume
  replans a job whose planning stopped, and the Swarm tab shows why planning stopped with a
  Plan again button.
- Tests: 187 unit and integration tests and 9 end-to-end tests.

## 2026-09-29 (evening)
- **The Decomposer no longer stalls on a big job.** In the second real swarm run, every Decomposer
  call spent about 2.5 minutes and was cut off at the 16,000-token reply limit (adaptive thinking at
  high effort plus a whole plan in JSON), and each retry repeated the same call. Now:
  - The Decomposer and its refine pass get 64,000 tokens, the Assembler 32,000; requests allowed
    more than 16,000 tokens stream (as Anthropic recommends), so no HTTP timeout cuts them off.
  - A reply cut off at max_tokens retries at the next lower effort instead of repeating itself, and
    the tokens it spent are logged and priced (those runs showed $0.00 before).
  - **Staged planning.** When one reply can't hold the plan (after one retry), or the engine's plan
    has more than 20 tiles, the Decomposer plans in stages: a skeleton of workstreams, tile keys,
    files and dependencies first (`decomposer-outline.v1`), then every workstream's tiles in full,
    four at a time, reading the shared job and skeleton from the prompt cache
    (`decomposer-stream.v1`). The skeleton's wiring holds the streams together.
  - If staged planning fails too, the engine's own plan is used with a note, so the swarm carries on.
- **Word, Excel and PDF attachments are read.** The Scoping agent, the Decomposer and the agents
  used to get "binary file, not shown" for .docx, .xlsx and .pdf files. Their text is now read in
  the browser with no library: Word documents with headings, lists, tables, footnotes, comments
  and tracked changes (marked `{+inserted+}` and `[-deleted-]`); every Excel sheet as CSV; PDF text
  in reading order, with fonts' character maps and real word gaps. The text is stored beside each
  upload, summarized (headings, sheets, pages, tracked changes, comments), redacted on restricted
  jobs, and given to the Scoping agent and the Decomposer (the opening of each document) and to the
  agents in full. File previews show it. Agents now read up to 60,000 characters a file and 150,000
  in all, so a whole manuscript fits.
- **Revise-and-respond jobs are planned as revisions.** A manuscript (or paper, chapter, proposal,
  report) revised in answer to reviewers, with a response letter, was read sentence by sentence
  ("You can learn from those edits" became an analysis tile, "keep the numbers" a data-cleaning
  one). The engine now plans it as a revision: triage every reviewer and editor comment into one
  matrix and a style sheet, revise the manuscript's sections at the same time (from the attached
  manuscript's own headings), answer every comment point by point, check the whole against the
  reviews, and assemble. "Keep the numbers" and "in my voice" become criteria on every section.
- **Word copies in the download.** The deliverable and the final assembly's documents come as .docx
  too, written with no library; `{+inserted+}` and `[-deleted-]` marks become real tracked changes.
  A requested tracked-changes version is made with Word's Compare, as the handoff says.
- Tests: 182 unit and integration tests and 9 end-to-end tests; the revision job joins the corpus.

## 2026-09-29 (later)
- **Competing workers and supervisors on swarm jobs**, from the swarm blueprint. Each tile becomes a
  task with a spec written before any work (hard checks, a weighted rubric, a threshold). Three
  worker configs (one model, three strategy hints) do it blind; a supervisor on the check model
  scores every draft after the checks, and a draft that fails a check can't win. When the blind
  round isn't a clean accept the workers see each other's drafts and revise, and the swarm tracks
  herding toward the weakest draft. The supervisor accepts, flags a sharp disagreement (it reaches
  later supervisors, the root supervisor and the deliverable), sends back with feedback (twice),
  re-splits a task that fails a third time into parts that each compete, or escalates to you.
- **Supervision page** (`#/supervision`): settle escalated tasks (accept an attempt, send back with
  your note, or give it to one agent), and see the leaderboard by config and task type, lessons with
  their measured lift, each supervisor's agreement with the checks and with your reviews of sampled
  accepted tasks, the configs' lineage, the latest actions, the cache hit rate and the herding rate.
  Tiles show their competition, and the Swarm tab says who won and what needs you.
- **Learning.** A reflection agent writes lessons after each task; shared lessons form a cached
  playbook per task type that one competitor per task runs without, so each lesson is promoted or
  retired on its lift after 20 trials. Losing configs are retired and winners cloned with a new
  strategy; a config that dominates a task type gets one rival (or, on "auto", works alone).
- **Root supervisor** judges the whole delivery with every flag before the autopilot signs off, and
  can hold it for you (resuming overrides it).
- **Layered prompt cache.** The worker prompt (`worker.v4`) is laid out job (1-hour cache), playbook
  (1 hour), task (5 minutes), round (5 minutes), then an uncached suffix; the first competitor starts
  alone and the rest start once its response begins streaming, so they read the cache. Hour-long
  writes are logged and priced at 2×. A long tile's lead decides whether to split before anyone works.
- New prompts `supervisor.v1`, `reflection.v1`, `resplit.v1`, `supervisor-root.v1`; nine new tables.
  Settings: competition (on, auto, off), competitors, reveal round, score to accept, learning, and
  the share of tasks sampled for your review. Where this departs from the blueprint is in
  docs/PROTOTYPE.md.
- Tests: 167 unit and integration tests and 8 end-to-end tests; all 26 corpus jobs reach sign-off
  with competition on.

## 2026-09-29
- **Long tiles split among agents working at once.** When a tile would take one agent much longer
  than the rest (60 s by default), its agent is offered a split: it either does the tile or returns
  a plan (rows of a table, sections of a document), and each part runs as its own worker call at the
  same time. The offer is made only when the time saved is real and the extra cost stays within an
  allowance (40% of the tile's model cost by default, within the spend cap). The parts read the
  tile's shared context from Anthropic's prompt cache, written by the lead's call, at about a tenth
  of the input price; they're joined by code, checked like one agent's work, and fixed by the lead
  in one pass if the joined files fail a check. A plan that doesn't hold up, or a part that fails,
  falls back to one agent doing the whole tile. Revisions, conventions, checks, kits and final
  assembly never split. Worker prompt `worker.v3`; settings for the target time, the most parts and
  the extra cost allowed.
- **Plans tuned to agents' speed.** Every tile gets an expected agent time from what it writes and
  the model's writing speed (measured from this browser's own runs once there are enough), and a
  swarm job shows its expected time along the longest chain. Drafts that a plan split page by page
  for people fold into one tile, or into chunks near the target time (the handbook translation goes
  from 40 two-page tiles to 20), so they read as one document and cost fewer reviews.
- **Prompt-cache costs.** Runs log cache writes and reads apart from plain input, and costs price
  them at 1.25× input and each model's cache-read price.
- Letter tiles ask for their own share of the letters (two letters in a batch of two, not all ten).
- Tests: 145 unit and integration tests.

## 2026-09-28
- **Long jobs read cleanly.** The engine no longer turns the details of a long sentence into tiles of
  their own ("Code the definition", "Code the response_id", "Prepare the each with a rough cost…"):
  a "with" list ending in "for each" is a detail of the piece before it; a data file named with its
  columns ("a coded_all.csv with response_id, branch and theme(s)") sets the id and code columns of
  every coding batch and of the merge; "…, each with …" stays with its part; "no more than 3
  recommendations" is a part capped at three (checked with `csv_max_rows`); "Then" and "Finally,"
  are dropped. A consistency check on coding becomes the agreement check, and a table of counts by
  group is analysis that waits for the coded data. The parts listed for a short document are what
  its writer covers (shared out page by page), while costs, charts and counts stay tiles of their
  own; costed recommendations follow the findings and show their arithmetic. A piece that names
  its language ("a one-page Spanish summary") is written in that language with no translator, and
  a summary of the report waits for the report. Word ranges follow the length asked for (a 2-page
  report asks 270–590 words a page; this also fixes a 900-word post that asked for 11,250+ words).
  Lists no longer split inside a number ("12,000 donor records" was read as "000 donor records").
  The first swarm test job is now in the corpus with these expectations.
- **Agents can use the web.** Tiles that need outside facts (prices, venues, caterers, funders,
  public data sources, rules, research) get a research step first: the new research agent
  (prompt `researcher.v1`) runs Anthropic's server-side web search and web fetch
  (`web_search_20260318` / `web_fetch_20260318`, with dynamic filtering; the basic versions on
  Haiku), the provider resumes paused turns, and the notes and sources go to the worker, which
  cites them. Searches are logged and billed at $10 per 1,000 in every cost view. If web search is
  switched off for the key's organization, research stops once with a note and agents mark outside
  facts "(verify)". Settings: web on or off, searches and page reads per tile.
- **Current models.** Heavy is now Claude Opus 5.5 (cheaper than Opus 5), swarm workers run on
  Claude Sonnet 5.5, checks on Opus 5.5, light stays Claude Haiku 4.5; prices added for Opus 5.5 and
  Sonnet 5.5; old default settings migrate. Each agent sets its effort, and 5.5-generation requests
  opt into the server-side refusal fallback.
- **Fixes from the first real run.** A tile that counts from upstream data is no longer treated as
  live-data collection; merges follow the plan's batch groups (not file names) and every merge tile
  reports what was merged; SAMPLE or placeholder output is refused when the real data is in the
  inputs; recommendations, costs and budgets must name each number's source and show cost arithmetic,
  and the Reviewer sees a swarm tile's inputs and sources; the deliverable leads with the finished
  document and puts how it was made in an appendix (Assembler `assembler.v2`); agreement checks,
  spot checks and peer reviews run on a different model from the work.
- Worker prompt `worker.v2`. Tests: 130 unit and integration tests and 7 end-to-end tests.
- **Agent swarm.** Any job can be handed to a swarm of AI agents that do every step after the
  submission: the autopilot (prompt `autopilot.v1`) answers the scoping questions and marks its
  assumptions, adapts the plan for agents and funds it; agent accounts (`isAgent`, matched only
  to swarm jobs) take the tiles and do them with the worker agent (prompt `worker.v1`, output
  checked against the tile's AUTO rules before hand-in), peer-review each other on PEER and
  high-stakes tiles, revise with the failed checks in hand, and the autopilot signs off.
- `src/decompose/agents.js` adapts a plan for agents: real-world steps (interviews, recording,
  editing audio or video, transcription, outreach, physical work) become kits with a handoff,
  repetitive real-world batches collapse into one kit, live-data batches into one collection
  script on a labeled sample, and with no file attached parallel batches over the requester's
  material run once on a sample. Fact-finding tiles mark unchecked facts "(verify)".
- The swarm merges numbered batch files and joins batch outputs on their id column by code,
  gives batch tiles only their rows of an attachment, feeds each tile the files its inputs
  name from any earlier layer, and keeps merged files out of prompts and logs.
- New **Agent swarm** page, a **Swarm** tab on swarm jobs (agents at work, activity, what a
  person still needs to do, spend, pause and resume), **Run it with agents** on the breakdown
  page, and swarm settings (worker model, agents at once, spend cap per job, swarm size).
- Commissions carry `workforce` (`people` or `agents`) and `autopilot`; tiles carry `archetype`,
  `handoff`, `agentMode` and `agentActivity`; submissions carry `handoff`. The router gained a
  swarm rate-limit pool (300 calls per 10 minutes) used by every agent on a swarm job.
- `runAgent` gained `bestEffort`: after the retries, output that parses but still fails the
  validator is returned with its problems (the swarm hands it in and lets review decide).
- Agents are exempt from the per-contributor submission limit, and their minutes don't feed
  estimate calibration. Peer review of agent work covers PEER criteria and high-stakes tiles;
  the first-five and sampling rules stay for people. Dispute panels are people only.
- Tests: 120 unit and integration tests and 7 end-to-end tests.
- Made disaggregation the center of the product: a rule-based engine in `src/decompose` reads
  any job and splits it into tiles separate people can do at the same time. It finds the kind of
  job, the pieces it names and their counts, languages, audiences, formats and sensitive data;
  puts a shared-conventions tile first; splits counts into range batches and assets into
  per-item pipelines; adds de-identification, translation, editing, testing and checks; wires
  tiles by the files they read and make; fits a budget by leaving later batches for phase two;
  and grades separability with one-click fixes (split, merge, add a wait, add an assembly, repair).
- New **Break down a job** page (also the home page's first action): any job, twelve examples,
  how the job reads, requirement coverage, the separability check, a who-works-when timeline,
  tiles by workstream with split, merge and remove, and posting the plan as a commission.
- The mock Decomposer is now the engine (the seven templates are gone). The Claude Decomposer
  uses prompt `decomposer.v2`, which starts from the engine's reading and reference plan, and a
  new `decomposer-refine.v1` pass fixes model plans that grade below C.
- Tiles carry optional `inputs`, `outputs`, `stream`, `phase`, `partOf`, `part`, `covers` and
  `priority`. Plans store the analysis and the quality report; the Plan tab shows both, with
  fixes that re-price the draft in place (`applyPlanFix`, `replacePlan`).
- Commissions can be posted with a ready plan (`postCommission` with `plan`), skipping scoping.
- Skill vocabulary and seeded contributors gained design, UX, mobile, grant writing, instructional
  design, event planning, project management, outreach, bookkeeping, transcription and audio and
  video editing, so the crowd can take any kind of job. Simulated contributors can now deliver
  JavaScript and TypeScript files.
- Decomposer eval grew to fifteen fixtures and scores separability and requirement coverage.
- Tests: 100 unit and integration tests (a 45-job corpus property test among them) and a
  breakdown end-to-end test.

## 2026-09-27
- Built the full prototype (M0–M6) as a static site at /tessera/ on dloverstreet.github.io.
- Domain core: pricing, both state machines, append-only ledger with overdraw protection,
  matching score and eligibility, per-skill reputation, estimate calibration, AUTO check rules,
  peer-review sampling, limits.
- LLM layer: Anthropic (official SDK, vendored for the browser), OpenAI-compatible (Ollama,
  OpenRouter) and a deterministic mock; schema-checked output with two retries; AgentRun logging.
- Agents: Scoping, Decomposer, Matcher note, Translator, Reviewer (with escalation), Assembler,
  and the tile copilot, each with a versioned prompt.
- Requester flow: post, scope, plan editing with live pricing, funding, progress mosaic, delivery
  with credits manifest and ZIP, sign-off, disputes with a three-person panel.
- Contributor flow: profile, offers with score breakdown, open board, claims and expiry, brief,
  copilot, submissions, revisions, partial pay, earnings, reputation with signed Ed25519 export.
- Demo: personas, guided demo, crowd simulation, injectable clock, admin console with cost per
  commission, decomposer eval, export/import/reset.
- Tests: 73 unit and integration tests, 3 Playwright end-to-end tests; lint and typecheck in CI.

## 2026-09-26
- Initial blueprint, CLAUDE.md and README. No application code yet.
