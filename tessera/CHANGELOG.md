# Changelog

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
