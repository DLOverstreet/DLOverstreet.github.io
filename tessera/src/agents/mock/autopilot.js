// Mock requester stand-in: takes each question's suggested answer, or says to use judgment.
export function mockAutopilot(input) {
  return {
    answers: (input.questions || []).map((q) => (q.suggestedAnswer
      ? { id: q.id, answer: q.suggestedAnswer, assumption: false }
      : { id: q.id, answer: 'Assumption: no preference; keep it simple and note what you assumed.', assumption: true })),
  };
}
