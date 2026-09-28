# Tessera

An open work exchange where an LLM breaks large jobs into small, fairly paid tiles that anyone can pick up, and each contributor's own LLM turns their tile into instructions they can follow on their own computer.

**Try it:** https://dloverstreet.github.io/tessera/ — press *Break down a job* to see any job split into separable tiles, *Hand a job to the agent swarm* to have AI agents do every step after you submit it, or run the full loop with the guided demo (about five minutes). No account needed; money is simulated.

## The agent swarm

Submit any job at **Agent swarm** (or press *Run it with agents* on a breakdown) and a swarm of AI agents does every step after the submission, on the same services, checks and ledger a person's job uses ([`src/services/swarm.js`](src/services/swarm.js)):

1. **The autopilot stands in for you.** It answers the Scoping agent's questions from your text (prompt `autopilot.v1`, marking anything it assumed), then adapts the plan for agents and funds it.
2. **The plan is adapted for agents** ([`src/decompose/agents.js`](src/decompose/agents.js)). Agents can write, code, analyze what they're given, design in SVG and translate, but they can't browse, call, record or visit. A tile that needs a person in the real world becomes the kit that person needs (interview guides, scripts and run sheets, an outreach kit with a tracking sheet, a transcription or on-site guide), repetitive real-world batches collapse into one kit, live-data collection becomes one collection script on a labeled SAMPLE, and fact-finding tiles mark unchecked facts "(verify)". Every such tile carries a handoff saying what a person must still do. With no file attached, batches over "your export" run once on a sample instead of forty times.
3. **Agents take the tiles.** Twelve agent accounts (`isAgent`) are matched only to swarm jobs, and people only to people's jobs. Each tile is done by the worker agent (prompt `worker.v1`) with the job, the tile, the accepted upstream files, the attachments (a batch tile gets only its rows) and, on a revision, exactly which checks failed and why. Its files must pass the tile's automatic checks before it hands them in; batch files are stacked or joined by code, not by a model, so a 5,000-row merge is exact.
4. **Checked, reviewed, revised.** The automatic checks and the Reviewer run as for anyone. Tiles with PEER criteria or flagged high-stakes go to another agent for peer review. A failed round comes back to the agent with the reasons; after two, the tile reopens to a different agent.
5. **Assembled and signed off.** The Assembler builds the deliverable, which lists what a person still has to do, and the autopilot signs it off.

Without a key the agents run on the mock and hand in placeholder files that pass the checks, so the whole flow is visible; connect Claude in Settings for real work. Settings sets the worker model (heavy or light), how many agents work at once, and a spend cap per job (the swarm pauses there; resume from the job's Swarm tab). The swarm has its own rate-limit pool (300 calls per 10 minutes), and every call is logged under the job's Agent runs with its cost.

## The disaggregator

The heart of Tessera is splitting a job into pieces separate people can do at the same time. [`src/decompose`](src/decompose) is a rule-based engine that does this for any job, in the browser, in under a tenth of a second:

1. **Read the job** (`analyze.js`): the kind of job (event, translation, coding, data product, software, website, media, course, campaign, bulk data, finance, research, document), each piece of work it names, counts in digits or words ("5,000 listings", "six-question FAQ", "20 hours of audio"), target languages, audiences, formats (phone, print, accessible), sensitive data, constraints and what it takes for granted.
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
| S1 | Agent swarm: autopilot requester, plans adapted for agents, worker agents, agent peer review and revision, merges by code, spend cap, Swarm page and tab | Done (on the mock; the Claude path is exercised through a stand-in provider, not a live key) |

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
| A job handed to the swarm is scoped, split, done, checked, assembled and signed off by agents only, and its ledger nets to zero | `tests/integration/swarm.test.js`, `tests/e2e/swarm.spec.js`; all 25 corpus jobs reach sign-off on the mock |
| Agents are matched only to swarm jobs and people only to people's jobs | `tests/integration/swarm.test.js` |
| An agent whose files fail the checks gets the failures back and revises | `tests/integration/swarm.test.js`, `tests/unit/swarm-worker.test.js` |
| Real-world steps become kits with a handoff; live data and missing files become labeled samples; adapted plans stay valid | `tests/unit/decompose-agents.test.js` (every corpus job, with and without a file) |
| Batch files are merged exactly by code; merged files never enter a prompt or log | `tests/unit/swarm-worker.test.js`, `tests/integration/swarm.test.js` |
| On a paid model the swarm stops at the spend cap and resumes when it's raised; keys stay out of the database | `tests/integration/swarm.test.js` |
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

The platform agents run on a deterministic mock by default. In **Settings** you can switch them to Claude (heavy `claude-sonnet-5`, light `claude-haiku-4-5`, both changeable) with your own Anthropic key, or to any OpenAI-compatible endpoint. Contributors can set their own key or a local Ollama model in their profile. Keys are kept in the browser's localStorage, sent only to the provider, and never written to the Tessera database or its exports.

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
