// Mock Matcher note: a factual one-liner from the score breakdown.
import { fmtRate } from '../../lib/util.js';

export function mockMatcherNote(input) {
  return {
    notes: input.candidates.map((c) => {
      const parts = [];
      if (c.topSkill) parts.push(`you rated yourself ${c.topSkill.level}/5 in ${c.topSkill.tag}`);
      if (c.accepted > 0) parts.push(`you have ${c.accepted} accepted tile${c.accepted === 1 ? '' : 's'} in it`);
      if (c.breakdown.A === 1) parts.push('you’re free in the next day');
      parts.push(`it pays ${fmtRate(input.tile.rateCents)} against your ${fmtRate(c.floorCents)} floor`);
      const s = parts.join(', ');
      return { userId: c.userId, note: (s.charAt(0).toUpperCase() + s.slice(1) + '.').slice(0, 160) };
    }),
  };
}
