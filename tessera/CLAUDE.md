# Tessera

An open work exchange. An LLM decomposes a commission into a graph of small tiles,
matches tiles to contributors, and each contributor's own LLM turns their tile into
a personal brief. The full spec is docs/BLUEPRINT.md. Read it before any change.

This build is a static prototype served by GitHub Pages: the whole platform runs in the
browser. docs/PROTOTYPE.md maps each part of the blueprint onto that setup and records
the decisions the blueprint left open. Keep both documents true when you change behavior.

## Working rules
- Business logic lives in src/domain as pure, tested functions. Services and UI call it.
- Every tile or commission status change goes through transitionTile or
  transitionCommission (src/services/core.js).
- LedgerEntry, ReputationEvent and StatusChange are append-only. The database refuses
  updates and deletes; never work around that.
- Money is integer cents everywhere.
- Every LLM call goes through runAgent (src/llm/run-agent.js) and is logged to AgentRun.
  Prompts live in src/agents/prompts with a version suffix, and a changed prompt is a new file.
- Parse every LLM response with its schema. Retry twice, then fail the job for a
  human to look at.
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
