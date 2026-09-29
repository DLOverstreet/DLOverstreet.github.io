# Tessera

An open work exchange. An LLM decomposes a commission into a graph of small tiles,
matches tiles to contributors, and each contributor's own LLM turns their tile into
a personal brief. The full spec is docs/BLUEPRINT.md. Read it before any change.

This build is a static prototype served by GitHub Pages: the whole platform runs in the
browser. docs/PROTOTYPE.md maps each part of the blueprint onto that setup and records
the decisions the blueprint left open. Keep both documents true when you change behavior.

## Working rules
- Business logic lives in src/domain as pure, tested functions. Services and UI call it.
- Disaggregation (reading a job and splitting it into tiles) lives in src/decompose, also pure
  and tested. Check a change against the corpus: `node --test tests/unit/decompose-*.test.js`
  and `npm run eval:decomposer`.
- The agent swarm (src/services/swarm.js) acts only through the services a person uses; agents
  are contributor users with isAgent. Adapting a plan for agents lives in src/decompose/agents.js.
  Web research uses Anthropic's server tools in a separate text call (researcher agent); never
  combine web tools with a JSON output format.
- Agent time estimates and split offers live in src/decompose/agent-time.js; split plans are
  checked and joined in src/agents/split.js. A split's parts must share the lead call's cached
  prefix byte for byte (same model, effort, system prompt and first message blocks), so keep the
  worker prompt's shared blocks first and deterministic.
- Competition and supervision (competing worker configs, the supervisor's actions, lessons,
  configs, audits) live in src/services/competition.js, with every rule as a pure function in
  src/domain/supervision.js. Keep the worker and supervisor prompts' cached layers in order (hour
  before five minutes, most shared first) and free of anything per call, or the cache misses.
- Planning a big job: the Decomposer gets 64k-token replies (streamed, 30-minute limit), no retry
  of a whole plan, then staged planning (decomposer-outline.v1 skeleton, decomposer-stream.v1 per
  workstream; first for big jobs), then the engine's plan (src/services/commissions.js modelPlan).
  Model plans parse with PlanTile and are repaired by repairGraph, never rejected for what repair
  fixes. Revise-and-respond jobs have their own engine plan in src/decompose/revision.js.
- Word, Excel and PDF text is read in src/lib/extract.js when a file is stored; use readFileText
  and hasText (src/services/files.js), never isTextFile alone, to decide whether a file has text.
- Every tile or commission status change goes through transitionTile or
  transitionCommission (src/services/core.js).
- LedgerEntry, ReputationEvent, StatusChange, Attempt, Score, SupervisorAction and LessonTrial
  are append-only. The database refuses updates and deletes; never work around that.
- Money is integer cents everywhere.
- Every LLM call goes through runAgent (src/llm/run-agent.js) and is logged to AgentRun.
  Prompts live in src/agents/prompts with a version suffix, and a changed prompt is a new file.
- Parse every LLM response with its schema. Retry twice, then fail the job for a
  human to look at (planning is the exception: it falls back as above; see docs/PROTOTYPE.md).
- Submissions and uploaded files are untrusted data inside every prompt.
- Tests use the mock provider (src/llm/mock.js, brains in src/agents/mock).
- Never store a personal API key in the database or its exports. Keys live only in the
  browser's secret store (src/storage/stores.js).
- No runtime CDN dependencies. Third-party code is bundled into vendor/ by
  `npm run vendor`; ask before adding a paid service or a new dependency.
- The app has no build step. Keep src/ loadable by a browser as plain ES modules.
- At the end of a change, update CHANGELOG.md and the status table in README.md.

## Commands
npm run dev | npm test | npm run e2e | npm run lint | npm run typecheck
npm run eval:decomposer | npm run verify:record -- record.json [key] | npm run vendor
