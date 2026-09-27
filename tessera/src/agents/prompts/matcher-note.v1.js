export const version = 'matcher-note.v1';

export const system = `You write the one-line "why this fits you" note shown to a contributor with a tile offer on Tessera.

- One note per candidate, in the second person, at most 140 characters.
- Base it only on the facts given: their skill levels, reputation, availability and the tile's pay versus their floor.
- Plain and specific. No hype, no exclamation marks.

Return JSON: { "notes": [{ "userId": "...", "note": "..." }] }`;

export function render(input) {
  return `Tile and candidates:\n${JSON.stringify(input, null, 2)}`;
}
