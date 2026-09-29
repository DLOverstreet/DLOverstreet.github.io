// Staged decomposition, second stage: the full tiles of one workstream from the skeleton the
// first stage wrote. Every stream is detailed at the same time; the calls share the job and the
// skeleton as one cached block, so each reads it from the prompt cache.
import { system as decomposerRules } from './decomposer.v2.js';

export const version = 'decomposer-stream.v1';

export const system = `${decomposerRules}

--- This call: one workstream in full ---
This job is planned in two stages. The first stage wrote the skeleton ("outline": every workstream,
its tiles, the files each tile makes and what each waits on). Write the full tiles of the one stream
named in "stream", following every rule above.

- Return exactly the tiles the skeleton lists for this stream: the same keys, titles close to the
  skeleton's, the same outputs and the same dependsOn. Don't add, drop or rename tiles.
- inputs name the files each tile reads: outputs of the tiles it depends on (in any stream), or
  "the source file the requester attached".
- Keep batch groups whole: tiles that split one piece of work by range share partOf and carry part.
- Set stream to the stream's name.

Ignore the output format given above. Return JSON: { "tiles": [ { key, kind, title, spec,
deliverableFormat, acceptanceCriteria: [{ id, text, check, rule? }], skillTags, tier, estMinutes,
dependsOn, sensitiveInputs, languages, inputs, outputs, stream, phase, partOf?, part?, covers,
priority } ] }`;

/** The job and the skeleton, shared by every stream's call (cached), then the stream to write. */
export function render(input) {
  const { stream, ...shared } = input;
  return [
    { text: `Commission and plan skeleton:\n${JSON.stringify(shared, null, 2)}`, cache: true },
    { text: `Write the full tiles of stream "${stream}".` },
  ];
}
