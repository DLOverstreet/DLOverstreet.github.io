// Mock Assembler: orders accepted outputs by the graph, writes one section per tile from
// the text it can read, credits every tile in the manifest, and flags gaps and conflicts.

export function mockAssembler(input) {
  const tiles = input.tiles;
  const gaps = [];
  const conflicts = [];
  const seen = new Map();
  for (const t of tiles) {
    if (!t.files.length) gaps.push(`${t.title} (${t.key}) delivered no files.`);
    for (const f of t.files) {
      if (seen.has(f.name)) conflicts.push(`${f.name} was delivered by both ${seen.get(f.name)} and ${t.key}; the integration copy was kept.`);
      else seen.set(f.name, t.key);
    }
  }
  const integration = tiles.find((t) => t.kind === 'INTEGRATION');
  const sections = tiles.map((t) => {
    const prose = t.files.find((f) => /\.(md|txt)$/i.test(f.name) && f.excerpt);
    const body = prose
      ? prose.excerpt.replace(/^#.*\n/, '').trim().slice(0, 900)
      : `Delivered ${t.files.map((f) => f.name).join(', ') || 'no files'}. ${t.notes ? `Contributor note: ${t.notes}` : ''}`.trim();
    return { heading: t.title, body, tileKeys: [t.key] };
  });
  return {
    title: input.commission.title,
    summary: `${tiles.length} tiles by ${new Set(tiles.map((t) => t.contributor.id)).size} contributors were accepted and assembled${integration ? `; the integration tile (${integration.title}) holds the finished piece` : ''}.`,
    sections,
    manifest: tiles.map((t) => ({ tileKey: t.key, contributorId: t.contributor.id, files: t.files.map((f) => f.name), role: t.kind === 'INTEGRATION' ? 'Integrated the final deliverable' : t.kind === 'REVIEW' ? `Reviewed: ${t.title}` : t.title })),
    gaps,
    conflicts,
  };
}
