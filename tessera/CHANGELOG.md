# Changelog

## 2026-09-28
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
