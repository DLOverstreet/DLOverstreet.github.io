// Mock research agent: the mock can't reach the web, so it says so in the same shape a real
// research note takes, and the worker marks what it would have looked up "(verify)".
export function mockResearcher(input) {
  const t = input.tile || {};
  return [
    '## Findings',
    `- Mock research for “${t.title || 'this tile'}”: the mock model has no web access, so nothing was looked up. Connect Claude in Settings to have agents search the web.`,
    '',
    '## Sources',
    '(none)',
    '',
    '## Not found',
    `- Everything this tile needs from outside the job's own files. Mark those facts "(verify)".`,
    '',
  ].join('\n');
}
