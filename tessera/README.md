# Tessera

An open work exchange where an LLM breaks large jobs into small, fairly paid tiles that anyone can pick up, and each contributor's own LLM turns their tile into instructions they can follow on their own computer.

**Try it:** https://dloverstreet.github.io/tessera/ — press *Break down a job* to see any job split into separable tiles, or run the full loop with the guided demo (about five minutes). No account needed; money is simulated.

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

Acceptance checks and where each is verified:

| Check | Verified by |
| --- | --- |
| Unit tests cover every allowed and disallowed transition | `tests/unit/transitions.test.js` |
| Each commission's ledger nets to zero (property test) | `tests/unit/ledger.test.js`, plus every integration test |
| Seed: 2 requesters, 12 contributors with varied skills and floors, 3 commissions | `tests/integration/seed.test.js` |
| A sample commission produces a valid, priced graph on the mock | `tests/integration/loop.test.js`, `npm run eval:decomposer` (15/15 valid, median separability 100, 100% of requirements covered) |
| Any job in a 30-job corpus splits into a valid, file-wired plan graded B or better, covering every requirement, whose automatic checks a contributor can pass | `tests/unit/decompose-plan.test.js` |
| The job reader finds kinds, pieces, counts, languages, formats and sensitive data | `tests/unit/decompose-analyze.test.js` |
| Split, merge, drop, repair and the quality report's fixes keep the graph valid | `tests/unit/decompose-ops.test.js` |
| A breakdown posts straight to a commission's approval step and can be fixed in place | `tests/integration/breakdown.test.js`, `tests/e2e/breakdown.spec.js` |
| 14 of 15 fixture commissions valid on the Anthropic provider | `TESSERA_LLM_PROVIDER=anthropic npm run eval:decomposer` or Admin → Decomposer eval with your key (not run here: no key in the build environment) |
| Every agent call appears in an AgentRun list with its prompt version | `tests/integration/seed.test.js`; Admin → Agent runs |
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
    decompose/            # the disaggregation engine: read a job, split it, wire it, grade it
    domain/               # pure rules: pricing, state machines, ledger, matching, reputation, checks
    db/                   # the in-browser database (transactions, append-only tables)
    services/             # what the blueprint's API routes do: commissions, market, work, delivery
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
