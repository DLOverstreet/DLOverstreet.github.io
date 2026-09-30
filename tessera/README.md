# Tessera

An open work exchange where an LLM breaks large jobs into small, fairly paid tiles that anyone can pick up, and each contributor's own LLM turns their tile into instructions they can follow on their own computer.

**Try it:** https://dloverstreet.github.io/tessera/ — press *Break down a job* to see any job split into separable tiles, *Hand a job to the agent swarm* to have AI agents do every step after you submit it, or run the full loop with the guided demo (about five minutes). No account needed; money is simulated.

## The agent swarm

Submit any job at **Agent swarm** (or press *Run it with agents* on a breakdown) and a swarm of AI agents does every step after the submission, on the same services, checks and ledger a person's job uses ([`src/services/swarm.js`](src/services/swarm.js)):

1. **The autopilot stands in for you.** It answers the Scoping agent's questions from your text (prompt `autopilot.v1`, marking anything it assumed), then adapts the plan for agents and funds it.
2. **The plan is adapted for agents** ([`src/decompose/agents.js`](src/decompose/agents.js)). Agents can write, code, analyze what they're given, design in SVG and translate, and (with Claude) search and read the web, but they can't call, record or visit. Tiles that need outside facts (prices, venues, funders, public data sources, rules, research) get a **research step** first: the research agent (prompt `researcher.v1`) uses Anthropic's server-side web search and web fetch, and the worker cites the sources it hands over. A tile that needs a person in the real world becomes the kit that person needs (interview guides, scripts and run sheets, an outreach kit with a tracking sheet, a transcription or on-site guide), repetitive real-world batches collapse into one kit, live-data collection becomes one collection script on a labeled SAMPLE, and fact-finding tiles mark unchecked facts "(verify)". Every such tile carries a handoff saying what a person must still do. With no file attached, batches over "your export" run once on a sample instead of forty times.
3. **Agents take the tiles.** Twelve agent accounts (`isAgent`) are matched only to swarm jobs, and people only to people's jobs. Each tile is done by the worker agent (prompt `worker.v4`, on Claude Sonnet 5.5 by default) with the job, the tile, the accepted upstream files, the attachments (a batch tile gets only its rows) and, on a revision, exactly which checks failed and why. Its files must pass the tile's automatic checks before it hands them in, and it never hands in SAMPLE data when the real data is in its inputs. Batch files are stacked or joined by code, following the plan's batch groups rather than file names, so a 5,000-row merge is exact; each merge tile's notes say what was merged.
   **Long tiles split among agents.** The plan is tuned to agents' speed ([`src/decompose/agent-time.js`](src/decompose/agent-time.js)): every tile gets an expected agent time from what it writes (rows, words, charts) and the model's writing speed, measured from this browser's own runs once there are enough; drafts split page by page for people fold into one tile (or into chunks near the target time); and the job shows its expected time along the longest chain. When a tile would still take one agent longer than the target (60 s by default), its agent is offered a split, but only if the time saved is real and the extra cost stays within the allowance (40% by default, and never past the spend cap). The lead agent either does the tile or returns a plan (rows of a table, or sections of a document); each part then runs as its own worker call at the same time, reading the tile's shared context from Anthropic's prompt cache (written by the lead's call) at about a tenth of the input price. The parts are joined by code, checked like one agent's work, and fixed by the lead in one pass if the joined files fail a check; a split that doesn't hold up falls back to one agent. Revisions, conventions, checks and final assembly are never split.
   **Competing workers and supervisors** ([`src/services/competition.js`](src/services/competition.js), rules in [`src/domain/supervision.js`](src/domain/supervision.js)). Each tile becomes a task with a spec written before any work: hard checks (the tile's automatic rules, every owed file, no SAMPLE data when the real data is there, cited web addresses that exist in the research) and a weighted rubric (the tile's own judged criteria, fidelity, accuracy, usefulness) with a threshold. Three worker configs (the worker model with three different strategy hints, prompt `worker.v4`) do it blind; the first starts alone and the others start once its response begins streaming, so they read the job (cached for an hour), the task's playbook (an hour) and the task itself (five minutes) from Anthropic's prompt cache. A supervisor on the check model (prompt `supervisor.v1`) scores every attempt on the rubric without seeing the checks; an attempt that fails a check scores zero. When the blind round isn't a clean accept, the workers see each other's drafts and revise (the reveal round), and the swarm measures how often revisions move toward the weakest draft (herding). Then the supervisor accepts the best, accepts it with a flag when the workers disagreed sharply (the flag goes to later tasks' supervisors, the root supervisor and the deliverable), sends it back with feedback (twice at most), has it re-split into smaller tasks that each compete (prompt `resplit.v1`; once per task, three per job, two levels deep), or escalates it to you on the **Supervision** page, where you accept one of the attempts, send it back with your note, or give it to one agent. A long tile's lead first decides whether to split it for speed; each part then competes on its own and the joined parts are scored by the parent. After each task a reflection agent (prompt `reflection.v1`) writes lessons; shared ones go into the task type's playbook, which one competitor per task works without, so a lesson stays only if it raises scores over 20 trials. Configs that keep losing are retired and winners cloned with a new strategy; a config that clearly dominates a task type gets one rival instead of two (and on "auto" works alone). The root supervisor (prompt `supervisor-root.v1`) judges the whole delivery before sign-off and can hold it for you. The Supervision page shows the leaderboard, lessons with their lift, each supervisor's agreement with the checks and with your reviews of sampled tasks, the configs' lineage, the cache hit rate and the herding rate.
4. **Checked, reviewed, revised.** The automatic checks run as for anyone; on a competed tile the supervisor's marks stand in for the Reviewer (and for agent peer review unless the tile is high stakes), and with competition off the Reviewer runs; on a swarm job the Reviewer also sees the tile's inputs and sources, and any tile with recommendations, costs or budgets must show where each number comes from and the arithmetic behind each cost. Agreement checks, spot checks and peer reviews run on a different model (Claude Opus 5.5) from the work they check. A failed round comes back to the agent with the reasons; after two, the tile reopens to a different agent.
5. **Assembled and signed off.** The deliverable leads with the finished document, then what a person still has to do, what was flagged, the sources, and last an appendix on how it was made (Assembler prompt `assembler.v2`); the root supervisor judges it and the autopilot signs it off.

**Attachments.** Word, Excel and PDF files are read in the browser, not skipped: headings, tables, footnotes, comments and tracked changes from Word; every sheet from Excel; the text of each PDF page ([`src/lib/extract.js`](src/lib/extract.js)). The Scoping agent and the Decomposer read the opening of each, and the agents the whole of it. A manuscript revision in answer to reviewers is planned as one ([`src/decompose/revision.js`](src/decompose/revision.js)), and the download carries Word copies of the finished documents.

Without a key the agents run on the mock and hand in placeholder files that pass the checks, so the whole flow is visible; connect Claude in Settings for real work. Settings sets the worker model and the check model, whether agents may use the web (and how many searches and page reads per tile), whether long tiles may be split (the target time, the most parts, the extra cost allowed), competition (on, auto or off; competitors per tile; the reveal round; the score to accept; learning; the share of accepted tasks sampled for your review), how many agents work at once, and a spend cap per job (the swarm pauses there; resume from the job's Swarm tab). Web searches cost $10 per 1,000 on top of tokens and count toward the cap; if web search is switched off for your key's organization, the swarm says so once and agents mark outside facts "(verify)" instead. The swarm has its own rate-limit pool (300 calls per 10 minutes), and every call is logged under the job's Agent runs with its cost (prompt-cache writes and reads priced apart), searches and sources.

## The disaggregator

The heart of Tessera is splitting a job into pieces separate people can do at the same time. [`src/decompose`](src/decompose) is a rule-based engine that does this for any job, in the browser, in under a tenth of a second:

1. **Read the job** (`analyze.js`): the kind of job (event, translation, coding, data product, software, website, media, course, campaign, bulk data, finance, research, document), each piece of work it names, counts in digits or words ("5,000 listings", "six-question FAQ", "20 hours of audio"), target languages, audiences, formats (phone, print, accessible), sensitive data, constraints, the data files it names with their columns, and what it takes for granted. Details stay with the piece they describe ("a codebook with a definition and an example quote for each", "recommendations, each with a rough cost").
2. **Contract first** (`pieces.js`): one tile fixes the shared interface everyone else works from: a glossary, codebook, batch spec, data dictionary, API contract, outline, event or message brief.
3. **Partition and pipeline** (`builder.js`, `rates.js`): counts are split by range into 30–90 minute batches that run side by side (each batch owns its rows and columns); episodes, lessons and posts each get their own chain, so episode 3's edit waits only on episode 3's recording.
4. **Layers**: de-identification before anyone sees personal data, a translator per language from final text, an editor when several people write one document, testing for anything built for phones, spot checks and agreement checks.
5. **Wire by files**: every tile lists the files it reads and the files it makes, and waits for exactly the tiles whose files it reads.
6. **Fit and grade** (`plan.js`, `quality.js`): a budget is met by cutting nice-to-haves, then leaving later batches for a second phase so the first phase is complete; the separability report grades the plan (parallel speedup, tile sizes, interface completeness, requirement coverage, checkable criteria) and offers one-click fixes (`ops.js`: split, merge, add a wait, add an assembly tile, repair).

With Claude connected, the Decomposer (prompt `decomposer.v2`) starts from the engine's reading and reference plan, and a refine pass fixes any plan that grades below C. Try it at **Break down a job**, or post a split straight to a commission.

The full design is in [docs/BLUEPRINT.md](docs/BLUEPRINT.md). This prototype runs the whole blueprint loop in the browser so it can live on GitHub Pages; [docs/PROTOTYPE.md](docs/PROTOTYPE.md) explains how each part of the blueprint maps onto a static site and every decision the blueprint left open.

## Status

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Skeleton: app shell, persistence, persona sign-in, CI | Done, adapted to a static site (personas replace GitHub sign-in; IndexedDB replaces Postgres) |
| M1 | Domain core: schema, pricing, state machines, ledger, matching | Done |
| M2 | LLM layer, Decomposer, requester flow | Done |
| M3 | Contributor profile, board, offers, Translator | Done |
| M4 | Verification, review loop, payouts, reputation | Done |
| M5 | Assembly, sign-off, disputes | Done |
| M6 | Public demo and deployment | Done, deployed to GitHub Pages |
| D1 | Disaggregation engine: reads any job, contract-first split, batches, per-item pipelines, file wiring, budget phasing, separability report, breakdown tool | Done |
| D2 | Reading long multi-part jobs: "with … for each" details, named file columns, capped and costed parts, sections of short documents, pieces written in their own language, summaries that wait for their document | Done (checked on the corpus and the first real swarm job) |
| S6 | Cheaper runs and agents that talk: the system prompt and the requester's files cached for an hour and reread by every tile, the playbook moved out of the shared prefix, every worker call cached; revisions by edits; a notes round (scores, notes, approaches) instead of whole drafts, and finalists; the wire (notes between agents, used-note citations, assists in the rankings); a cheaper challenger in every competition, cheaper clones of winning configs, cost-aware routing; free providers (Gemini, Groq, OpenRouter, Ollama) before Claude on public jobs; half-price Message Batches; effort settings and an Economy preset; savings in Admin | Done (on the mock and stand-in providers; the free providers and batches not yet run against live keys) |
| S5 | Reliable planning of big jobs (64k-token Decomposer replies over streaming with a 30-minute limit, plans repaired instead of rejected, no whole-plan rewrites, rate limits waited out, effort stepped down after a cut-off, failed runs priced, staged planning by workstream and first for big jobs, the engine's plan as the last resort, stopped jobs restarted), Word/Excel/PDF attachments read in the browser (tracked changes, comments, sheets, PDF character maps), revise-and-respond plans, Word copies of deliverables | Done (on the mock, a stand-in provider and a Chromium-printed PDF; not yet run against a live key) |
| S4 | Competition and supervision: task specs written before the work, three competing worker configs on a layered prompt cache (warmed, then fanned out), a supervisor on another model scoring after hard checks, reveal round with a herding measure, accept / flag / send back / re-split / escalate, escalations settled on the Supervision page, lessons tested against a control group, evolving configs, routing to fewer competitors, supervisor audits and your reviews, root supervisor before sign-off | Done (on the mock and a stand-in provider, including streamed warm-up through the Anthropic SDK; not yet run against a live key) |
| S3 | Agent speed: expected agent time per tile and per job, drafts folded to agent-sized tiles, long tiles split among agents working at once (cost-gated, prompt-cached, joined by code), measured model speed, cache-aware costs | Done (on the mock and a stand-in provider; not yet run against a live key) |
| S1 | Agent swarm: autopilot requester, plans adapted for agents, worker agents, agent peer review and revision, merges by code, spend cap, Swarm page and tab | Done (on the mock; the Claude path is exercised through a stand-in provider, not a live key) |
| S2 | Web research for agents (Anthropic web search and fetch), current models (Opus 5.5, Sonnet 5.5, Haiku 4.5), refusal fallback, and the fixes from the first real run: live-data false positive, plan-based merges, no SAMPLE when real data exists, sourced numbers and costs, product-first deliverable, checks on a second model | Done (tested with a stand-in provider and recorded API shapes; not yet run against a live key) |

Acceptance checks and where each is verified:

| Check | Verified by |
| --- | --- |
| Unit tests cover every allowed and disallowed transition | `tests/unit/transitions.test.js` |
| Each commission's ledger nets to zero (property test) | `tests/unit/ledger.test.js`, plus every integration test |
| Seed: 2 requesters, 12 contributors with varied skills and floors, 3 commissions | `tests/integration/seed.test.js` |
| A sample commission produces a valid, priced graph on the mock | `tests/integration/loop.test.js`, `npm run eval:decomposer` (15/15 valid, median separability 100, 100% of requirements covered) |
| Any job in a 45-job corpus splits into a valid, file-wired plan graded B or better, covering every requirement, whose automatic checks a contributor can pass | `tests/unit/decompose-plan.test.js` |
| The job reader finds kinds, pieces, counts, languages, formats and sensitive data | `tests/unit/decompose-analyze.test.js` |
| Split, merge, drop, repair and the quality report's fixes keep the graph valid | `tests/unit/decompose-ops.test.js` |
| A breakdown posts straight to a commission's approval step and can be fixed in place | `tests/integration/breakdown.test.js`, `tests/e2e/breakdown.spec.js` |
| 14 of 15 fixture commissions valid on the Anthropic provider | `TESSERA_LLM_PROVIDER=anthropic npm run eval:decomposer` or Admin → Decomposer eval with your key (not run here: no key in the build environment) |
| Every agent call appears in an AgentRun list with its prompt version | `tests/integration/seed.test.js`; Admin → Agent runs |
| A job handed to the swarm is scoped, split, done, checked, assembled and signed off by agents only, and its ledger nets to zero | `tests/integration/swarm.test.js`, `tests/e2e/swarm.spec.js`; all 26 corpus jobs reach sign-off on the mock |
| Agents are matched only to swarm jobs and people only to people's jobs | `tests/integration/swarm.test.js` |
| An agent whose files fail the checks gets the failures back and revises | `tests/integration/swarm.test.js`, `tests/unit/swarm-worker.test.js` |
| Real-world steps become kits with a handoff; live data and missing files become labeled samples; adapted plans stay valid | `tests/unit/decompose-agents.test.js` (every corpus job, with and without a file) |
| Batch files are merged exactly by code; merged files never enter a prompt or log | `tests/unit/swarm-worker.test.js`, `tests/integration/swarm.test.js` |
| On a paid model the swarm stops at the spend cap and resumes when it's raised; keys stay out of the database | `tests/integration/swarm.test.js` |
| Research calls send Anthropic's web tools, resume a paused turn, and log searches, pages read, sources and search cost | `tests/integration/llm.test.js` |
| Tiles that need outside facts research first; web search switched off falls back once to "(verify)"; checks run on the check model; the deliverable leads with the finished document | `tests/integration/swarm.test.js` |
| A count taken from upstream data isn't treated as live data; SAMPLE output is refused when real data is in the inputs; batches merge by plan group whatever their names | `tests/unit/decompose-agents.test.js`, `tests/unit/swarm-worker.test.js` |
| A long tile splits only when it saves real time within the cost allowance; the parts read the cached context, are joined by code and checked; a bad split falls back to one agent; splitting can be turned off | `tests/unit/agent-time.test.js`, `tests/integration/swarm.test.js`, `tests/integration/llm.test.js` |
| Plans tuned to agents' speed stay valid and fully wired; page-by-page drafts fold into one tile | `tests/unit/decompose-agents.test.js` (every corpus job) |
| A plan too long for one reply is planned in stages; a cut-off reply is priced and retried at lower effort; the engine's plan is the last resort | `tests/integration/decompose-staged.test.js` |
| Word, Excel and PDF attachments are read (tracked changes, comments, sheets, PDF fonts), reach every agent, and are redacted on restricted jobs; Word copies read back the same | `tests/unit/extract.test.js`, `tests/integration/attachments.test.js`, `tests/e2e/swarm.spec.js` |
| A manuscript revision in answer to reviewers is planned as triage, parallel section revisions, a response letter, a check and an assembly | `tests/unit/decompose-revision.test.js`, the corpus in `tests/unit/decompose-plan.test.js` |
| Three configs compete blind on every tile; the supervisor scores after the hard checks, and a draft that fails one can't win; later competitors read the cached layers | `tests/unit/supervision.test.js`, `tests/integration/competition.test.js`; all 26 corpus jobs reach sign-off with competition on |
| The supervisor's five actions follow their triggers: the reveal round runs when the blind round isn't a clean accept, weak rounds are sent back with feedback, the third failure re-splits, and what it can't judge waits for you | `tests/unit/supervision.test.js`, `tests/integration/competition.test.js`, `tests/e2e/swarm.spec.js` |
| Lessons are trialed against a control group and promoted or retired; winning configs are cloned; a dominant config gets fewer rivals | `tests/unit/supervision.test.js`, `tests/integration/competition.test.js` |
| The job layer is cached for an hour and the task layer for five minutes; hour-long writes cost 2×; a warming call streams and releases the others on its first event | `tests/integration/llm.test.js` |
| Supervisors are scored against the hard checks and your reviews; the root supervisor can hold back sign-off | `tests/integration/competition.test.js` |
| After a blind round that isn't a clean win, finalists read one shared block of scores and notes and revise their own full drafts by edits; the rest count as losses | `tests/integration/wire.test.js`, `tests/unit/cost-levers.test.js` |
| Agents' notes reach later tiles and rivals; an accepted attempt that relied on another config's note earns it an assist; notes can't be edited | `tests/integration/wire.test.js`, `tests/unit/cost-levers.test.js` |
| A cheaper challenger competes on every task on its own model; winning configs are cloned onto a cheaper model; configs that score alike are ranked cheapest first | `tests/integration/wire.test.js`, `tests/unit/cost-levers.test.js` |
| The requester's files are byte-for-byte the same in every tile's hour-long job layer and written to the cache once; the system prompt is cached for an hour | `tests/integration/wire.test.js`, `tests/unit/cost-levers.test.js` |
| Free providers are tried first on public jobs only (a local model on any), rest after a quota, and hand the call to Claude on failure or a bad answer; batched calls cost half | `tests/unit/cost-levers.test.js` |
| A seeded contributor never sees an offer below their floor | `tests/integration/seed.test.js`, `tests/unit/matching.test.js` |
| A brief whose checklist ids don't match is rejected and regenerated | `tests/integration/llm.test.js` |
| A personal API key stays in the browser, checked against every request | `tests/e2e/key-privacy.spec.js` |
| A requester and three contributors run every tile to payout | `tests/e2e/loop.spec.js` |
| A deliberately failing submission loops twice, then reopens | `tests/integration/loop.test.js` |
| Earnings and reputation recompute exactly from the event tables | `tests/integration/loop.test.js` |
| The end-to-end run reaches ACCEPTED on the mock; the manifest names every contributor and tile | `tests/e2e/loop.spec.js`, `tests/integration/loop.test.js` |
| A visitor posts a commission and completes a tile in under ten minutes without an account | `tests/e2e/guided-demo.spec.js` (about 12 seconds to an accepted tile) |
| An exported reputation record verifies against the published public key | `tests/e2e/guided-demo.spec.js`, `tests/unit/libs.test.js`, `npm run verify:record` |

## Run it locally

```bash
cd tessera
npm install
npm run dev            # http://localhost:4173/tessera/
npm test               # unit + integration (Node's test runner, mock provider)
npm run e2e            # Playwright end-to-end tests
npm run lint && npm run typecheck
npm run eval:decomposer
```

The app itself has no build step: the browser loads the ES modules in `src/` directly. The only built files are the vendored libraries in `vendor/` (Preact + htm, and the official Anthropic SDK), rebuilt with `npm run vendor`.

## Using real models

The platform agents run on a deterministic mock by default. In **Settings** you can switch them to Claude with your own Anthropic key (heavy `claude-opus-5-5` for planning, assembly and escalated reviews; light `claude-haiku-4-5` for first-pass reviews; swarm workers on `claude-sonnet-5-5`; all changeable), or to any OpenAI-compatible endpoint. Each agent sets its effort level, and requests to Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 opt into Anthropic's server-side refusal fallback (`fallbacks: "default"`), so a declined request is re-run on a suitable model instead of failing. Contributors can set their own key or a local Ollama model in their profile. Keys are kept in the browser's localStorage, sent only to the provider, and never written to the Tessera database or its exports.

To spend less: **Settings → Free models first** tries Google Gemini's, Groq's and OpenRouter's free developer tiers, or Ollama on your own computer, before Claude for light work, a free-model challenger in each competition, and (optionally) agents working alone; a call goes to Claude when the free model is out of requests or its answer doesn't hold up. The cloud free tiers may learn from what you send, so only jobs marked Public go to them. **Settings → Agent swarm → Cost** has an Economy preset (two competitors, two finalists, low effort, a cheaper challenger) and a half-price batch mode through Anthropic's Message Batches API (slower). Admin → Cost per commission shows what the cache, batches and free models saved.

From the command line, `TESSERA_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval:decomposer` runs the fifteen-fixture Decomposer eval on Claude. `TESSERA_MODEL_HEAVY` overrides the model.

## Layout

```text
tessera/
  index.html              # the page GitHub Pages serves
  src/
    decompose/            # the disaggregation engine: read a job, split it, wire it, grade it, adapt it for agents
    domain/               # pure rules: pricing, state machines, ledger, matching, reputation, checks
    db/                   # the in-browser database (transactions, append-only tables)
    services/             # what the blueprint's API routes do: commissions, market, work, delivery, and the agent swarm
    jobs/worker.js        # the job queue worker (runs in the page)
    llm/                  # Anthropic, OpenAI-compatible and mock providers; runAgent; routing
    agents/               # agent definitions, versioned prompts, schemas, mock brains, eval
    storage/              # IndexedDB and memory adapters, secrets
    lib/                  # schema validation, CSV, ZIP, Markdown, Ed25519, redaction, clock
    app/                  # the UI (Preact + htm, no build step)
  tests/unit  tests/integration  tests/e2e
  scripts/                # dev server, vendor build, decomposer eval, record verifier
  vendor/                 # bundled third-party libraries (see vendor/LICENSES.md)
```
