# Changelog

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
