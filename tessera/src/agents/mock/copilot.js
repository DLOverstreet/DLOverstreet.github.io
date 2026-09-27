// Mock copilot: answers common questions about the tile from its own spec and brief,
// and declines anything off-topic.

export function mockCopilot(input) {
  const q = String(input.question || '').toLowerCase();
  const { tile, brief } = input.context;
  const crit = tile.acceptanceCriteria.map((c) => `${c.id}: ${c.text}${c.rule ? ` (checked automatically: ${c.rule})` : ''}`).join('\n');
  if (/criteria|done|accept|pass|check/.test(q)) return `This tile is accepted when all of these hold:\n${crit}\nAUTO ones are checked by a script the moment you submit.`;
  if (/format|file|deliver|name/.test(q)) return `Deliver: ${tile.deliverableFormat}. Use those exact file names so downstream tiles and the automatic checks can find them.`;
  if (/start|begin|first|how/.test(q)) return `Start here: ${(brief?.steps || [])[0] || tile.spec.split('\n').pop()}\nThen work through the checklist in order.`;
  if (/time|long|minutes|hour/.test(q)) return `It's estimated at ${tile.estMinutes} minutes. Report your real time when you submit; it helps price future tiles fairly.`;
  if (/input|upstream|data|source/.test(q)) return input.context.inputs?.length ? `Your inputs are: ${input.context.inputs.join(', ')}. Download them from the Inputs panel.` : 'This tile has no upstream inputs; everything you need is in the spec.';
  if (/pay|money|rate/.test(q)) return `This tile pays ${input.context.pay}. Pay releases the moment the tile is accepted.`;
  return `I can only help with this tile (“${tile.title}”). Ask me about its criteria, deliverable format, inputs, or where to start. (This is the mock copilot; connect your own model in your profile for open-ended help.)`;
}
