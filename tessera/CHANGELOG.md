# Changelog

## 2026-09-28
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
- Tests: 100 unit and integration tests (a 30-job corpus property test among them) and a
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
