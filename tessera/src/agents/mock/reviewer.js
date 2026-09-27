// Mock Reviewer: judges LLM criteria with transparent heuristics. Substantive, on-topic
// work passes; empty or placeholder work fails with a reason. Text that tries to instruct
// the reviewer is flagged and ignored. Borderline cases report low confidence, which
// makes the platform escalate to the heavy model.

const STOP = new Set('the and for with that this from each every into your their there have has are was were been than then them they what when where which while will would should could about after before other these those plain every rather'.split(' '));

function keywords(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z]{5,}/g) || [])].filter((w) => !STOP.has(w)).slice(0, 6);
}

const INJECTION = /(ignore (all |any )?(previous|prior) instructions|mark (this|it) as pass|you are now|system prompt|as the reviewer,? (pass|approve))/i;

/** @param {any} input @param {{ model?: string }} [opts] */
export function mockReviewer(input, { model } = {}) {
  const files = input.submission.files || [];
  const text = files.map((f) => f.excerpt || '').join('\n');
  const notes = input.submission.notes || '';
  const all = `${text}\n${notes}`;
  const injected = INJECTION.test(all);
  const deliberateFail = /#fail\b|\[deliberate[- ]fail\]/i.test(notes);
  const heavy = /heavy/.test(model || '');
  let borderline = false;
  const criteria = input.criteria.map((c) => {
    if (deliberateFail) return { criterionId: c.id, pass: false, reason: `Not met: the submission doesn't show evidence for “${c.text}”. Add it and resubmit.` };
    if (injected) return { criterionId: c.id, pass: false, reason: 'The submission contains text addressed to the reviewer (asking it to pass the work). That was ignored; resubmit the work without it.' };
    const words = keywords(c.text);
    const hits = words.filter((w) => all.toLowerCase().includes(w.slice(0, 6)));
    const substantive = text.trim().length >= 400;
    const thin = text.trim().length < 120;
    if (thin) return { criterionId: c.id, pass: false, reason: `Too little content to judge “${c.text}”: the files hold under 120 characters of readable text.` };
    if (!substantive && !hits.length) borderline = true;
    const pass = substantive || hits.length > 0 || heavy;
    return {
      criterionId: c.id,
      pass,
      reason: pass
        ? `Met: ${hits.length ? `the submission addresses ${hits.slice(0, 3).join(', ')}` : 'the files contain substantive, relevant work'} for “${c.text}”.`
        : `Unclear: nothing in the files speaks to “${c.text}”. Point to where it is addressed, or add it.`,
    };
  });
  const allPass = criteria.every((c) => c.pass);
  return { criteria, overall: allPass ? 'PASS' : 'FAIL', confidence: heavy ? 0.86 : borderline ? 0.62 : 0.9 };
}
