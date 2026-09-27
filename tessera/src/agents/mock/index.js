// The mock provider's brains, keyed by agent name.
import { mockScoping } from './scoping.js';
import { mockDecompose } from './decomposer.js';
import { mockMatcherNote } from './matcher-note.js';
import { mockTranslator } from './translator.js';
import { mockReviewer } from './reviewer.js';
import { mockAssembler } from './assembler.js';
import { mockCopilot } from './copilot.js';

export const mockBrains = {
  scoping: mockScoping,
  decomposer: mockDecompose,
  'matcher-note': mockMatcherNote,
  translator: mockTranslator,
  reviewer: mockReviewer,
  assembler: mockAssembler,
  copilot: mockCopilot,
};
