// Staged decomposition, first stage. A big job's whole plan (every tile's spec, criteria and
// estimates) can be too long to write in one reply, so the Decomposer first returns only the
// skeleton: workstreams, their tiles, the files each tile makes and what each waits on. The
// second stage (decomposer-stream.v1) details one workstream per call, all at the same time.
import { system as decomposerRules } from './decomposer.v2.js';

export const version = 'decomposer-outline.v1';

export const system = `${decomposerRules}

--- This call: the skeleton only ---
This job is planned in two stages because its full plan is long. Apply every rule above to decide
the tiles, but in this reply return only the skeleton; a second stage writes each tile's spec,
criteria, skills and estimate, one workstream at a time, following your skeleton exactly.

- Group the tiles into workstreams (streams): a stream is a set of tiles one lead could brief
  together (the setup and conventions, one deliverable's drafting, its checks, the assembly). Aim
  for 2 to 8 streams of 1 to 12 tiles; a batch group stays in one stream.
- For every tile give its kebab-case key (unique across the whole plan), a short title, the exact
  file names it makes (each file has one maker), dependsOn (keys of the tiles, in any stream, whose
  files it reads), and covers (requirement ids from the analysis).
- The plan must have no loops, and a tile may only depend on keys in the skeleton.

Ignore the output format given above. Return JSON: { "rationale": "...", "streams": [ { "key": "...",
"name": "...", "purpose": "...", "tiles": [ { "key": "...", "title": "...", "outputs": ["..."],
"dependsOn": ["..."], "covers": ["r1"] } ] } ] }`;

export function render(input) {
  return `Commission:\n${JSON.stringify(input, null, 2)}`;
}
