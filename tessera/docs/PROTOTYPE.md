# How the prototype implements the blueprint

The blueprint describes a Next.js app, a worker and Postgres on a container host. This prototype has to live on GitHub Pages, which only serves static files, so the whole platform runs in the visitor's browser. Every rule in the blueprint is still enforced in code; what changed is where that code runs. This note records each substitution and every decision the blueprint left open.

## Where each part runs

| Blueprint | Prototype | Notes |
| --- | --- | --- |
| Next.js app with route handlers | A static single-page app (`index.html` + ES modules) | No build step. The route handlers' work lives in `src/services`, called directly by the UI. |
| Postgres through Prisma | `src/db`: an in-memory store with synchronous transactions and rollback, saved to IndexedDB | Tables match the blueprint's twelve, plus `StatusChange` (who changed what), `Brief` and `Dispute`. `LedgerEntry`, `ReputationEvent` and `StatusChange` refuse updates and deletes. |
| Worker polling a jobs table | `src/jobs/worker.js` polls the `Job` table inside the page every 300 ms | Same retry-then-fail behaviour. Failed jobs show in Admin → Jobs with a Retry button. |
| GitHub sign-in (Auth.js) | Demo personas | OAuth needs a server-side secret. The blueprint's M6 demo mode already calls for personas, so they are the only sign-in. |
| Platform LLM on a server key | Mock by default; Claude or an OpenAI-compatible endpoint with a key saved in the browser | The official Anthropic SDK is vendored (`vendor/anthropic-sdk.js`) and called with `dangerouslyAllowBrowser`, which sends the direct-browser-access header. |
| File storage (disk or S3) | IndexedDB blobs | Same limits on size and type as the demo mode in M6. |
| zod | `src/lib/schema.js`, a small zod-style validator | Keeps the site free of runtime CDN dependencies, and emits the JSON Schema used for Claude's structured output. |
| React Flow graph editor | `src/app/views/graph.js`: a layered SVG layout plus a form-based tile editor | Nodes are keyboard-focusable, and there's a table view of the same graph. |
| Render or Fly.io | GitHub Pages | Each visitor gets a private copy of the world. Export and import it from Settings. |
| Playwright against the deployed stack | Playwright against the static site served by `scripts/serve.js` | The same tests run in CI. |

Because each browser is its own platform instance, "other people" are simulated. The **crowd** (`src/services/crowd.js`) lets every seeded contributor you aren't playing accept offers, submit sample work that meets the tile's automatic checks, review each other and vote on panels, after short human-like delays. It goes through the same API a person uses, so it can't bypass a rule. Personas you have played are never simulated.

## Decisions the blueprint left open

**Ledger sign convention.** `amountCents` is the entry's effect on the commission's escrow: funding is positive; payouts, fees and refunds are negative. A contributor's earnings are the negated sum of their payout entries. A closed commission's entries sum to exactly zero, and no prefix may go below zero; `postLedger` rolls back any transaction that would overdraw.

**Paying for peer review.** Funding a plan escrows tile pay, the 10% fee, and a *peer-review reserve*: one 15-minute review at each work tile's tier, plus its fee. Reviews are paid from the reserve. If revisions need more reviews than the reserve holds, the requester's escrow is topped up automatically and the receipt says why. Unused reserve is refunded at sign-off.

**When the fee is charged.** On each payout (tile, review or partial pay), in the same transaction.

**Who can review.** The rule is someone with earned reputation in one of the tile's skills (at least one accepted tile in it) who never worked on the commission. A fresh platform has almost no earned reputation, so until someone has it, a self-rated level of 3 or more in the skill qualifies (`config.reviewerBootstrapLevel`). If nobody independent of the commission is eligible, matching relaxes to "anyone who didn't work on *this* tile", and the tile records that it did. The requester can always settle a pending review themselves.

**Who the first-five rule counts.** A contributor's accepted work and integration tiles. Reviews don't count toward it.

**Planned REVIEW tiles vs. sampled peer reviews.** REVIEW tiles in the Decomposer's graph are QA passes: ordinary paid tiles whose deliverable is a review report. Sampled peer reviews are separate dynamic tiles, created when a submission passes its automatic and LLM checks. They check the submission's PEER criteria, or all of its criteria when sampled.

**Revision rounds.** A failed round goes to REVISION. The third failure (after two revisions) reopens the tile to others. The failing contributor is excluded from that tile, and the requester can grant partial pay (funded by a small top-up) for usable work.

**Disputes.** Accepted tiles stay accepted, and their pay is never clawed back. If two of three panelists vote to reopen, the platform creates *rework* tiles funded by a platform quality guarantee (an `ESCROW_FUND` entry from the platform account). The original contributor gets a `DISPUTE_REOPENED` reputation event. At sign-off, leftover escrow is refunded to the most recent funder first, so an unused guarantee returns to the platform. Panelists are the three contributors with the most accepted work in the disputed skills who never worked on the commission. The basic panel is unpaid.

**Estimate calibration.** The blueprint feeds the median actual-to-estimate ratio back to the Decomposer. Here, after parsing, the ratio is also applied deterministically to each tile (rounded to 5 minutes, clamped to 15–120). Pay then rises reliably, whether or not a given model follows the hint. The tile shows its original and calibrated estimates.

**Reputation event weights.** `ACCEPTED` and `REVIEW_COMPLETED` count as accepted and as an attempt. `REVIEW_FAILED` and a second or later `CLAIM_EXPIRED` count as attempts. A first expired claim counts for nothing, and `DISPUTE_REOPENED` removes one accepted credit. The `delta` column stores display points; R is always recomputed from the reasons.

**Tile languages.** Tiles carry an optional `languages` list (the Decomposer schema gained this field). Eligibility requires sharing one of them, or the commission's language when the list is empty.

**Offer windows and the board.** People who let an offer lapse or declined it aren't re-offered that tile, but they can still claim it from the open board. Releasing a claim is free and excludes you from that tile.

**Signing key.** Each instance generates its own Ed25519 key in WebCrypto, with a non-extractable private key kept in IndexedDB. The public key is published at Admin → Signing key. Exported records name their issuer key; the Verify page checks a record against this instance's key, the key named in the record, or any pasted key. In a server deployment there would be one platform key; here there is one per browser, which the page says plainly.

**The guided demo.** While the guide is running, the crowd leaves the visitor's commission alone until the visitor has claimed one of its tiles as a contributor, so there's still work left to try.

**Rate and file limits.** 40 non-mock LLM calls per 10 minutes, 6 commissions an hour per requester, 20 submissions an hour per contributor, 5 MB per file, 10 files and 20 MB per submission, and an allow-list of file types. All of these live in `src/domain/config.js`.

## What isn't real

The money, the people other than you, and (by default) the model. The mock agents are deterministic: the Decomposer uses templates for seven kinds of job and cuts optional tiles to fit a budget, the Reviewer uses transparent heuristics (and flags text addressed to it), and the Translator fills its brief from the tile spec. Connect Claude in Settings to see the real agents on the same pipeline; every call is logged with its prompt version, tokens and cost.
