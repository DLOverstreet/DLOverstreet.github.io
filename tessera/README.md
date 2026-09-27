# Tessera

An open work exchange where an LLM breaks large jobs into small, fairly paid tiles that anyone can pick up, and each contributor's own LLM turns their tile into instructions they can follow on their own computer.

**Try it:** https://dloverstreet.github.io/tessera/ — pick a persona, or press *Start the guided demo* to post a commission and complete a tile in about five minutes. No account needed; money is simulated.

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

Acceptance checks and where each is verified:

| Check | Verified by |
| --- | --- |
| Unit tests cover every allowed and disallowed transition | `tests/unit/transitions.test.js` |
| Each commission's ledger nets to zero (property test) | `tests/unit/ledger.test.js`, plus every integration test |
| Seed: 2 requesters, 12 contributors with varied skills and floors, 3 commissions | `tests/integration/seed.test.js` |
| A sample commission produces a valid, priced graph on the mock | `tests/integration/loop.test.js`, `npm run eval:decomposer` (10/10 valid) |
| 9 of 10 fixture commissions valid on the Anthropic provider | `TESSERA_LLM_PROVIDER=anthropic npm run eval:decomposer` or Admin → Decomposer eval with your key (not run here: no key in the build environment) |
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

From the command line, `TESSERA_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval:decomposer` runs the ten-fixture Decomposer eval on Claude. `TESSERA_MODEL_HEAVY` overrides the model.

## Layout

```text
tessera/
  index.html              # the page GitHub Pages serves
  src/
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
