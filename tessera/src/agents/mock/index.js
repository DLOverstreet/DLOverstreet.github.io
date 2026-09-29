// The mock provider's brains, keyed by agent name.
import { mockScoping } from './scoping.js';
import { mockDecompose, mockRefine, mockDecomposeOutline, mockDecomposeStream } from './decomposer.js';
import { mockMatcherNote } from './matcher-note.js';
import { mockTranslator } from './translator.js';
import { mockReviewer } from './reviewer.js';
import { mockAssembler } from './assembler.js';
import { mockCopilot } from './copilot.js';
import { mockWorker } from './worker.js';
import { mockAutopilot } from './autopilot.js';
import { mockResearcher } from './researcher.js';
import { mockSupervisor, mockReflection, mockResplit, mockRootSupervisor } from './supervision.js';

export const mockBrains = {
  scoping: mockScoping,
  decomposer: mockDecompose,
  'decomposer-refine': mockRefine,
  'decomposer-outline': mockDecomposeOutline,
  'decomposer-stream': mockDecomposeStream,
  'matcher-note': mockMatcherNote,
  translator: mockTranslator,
  reviewer: mockReviewer,
  assembler: mockAssembler,
  copilot: mockCopilot,
  worker: mockWorker,
  autopilot: mockAutopilot,
  researcher: mockResearcher,
  supervisor: mockSupervisor,
  reflection: mockReflection,
  resplit: mockResplit,
  'supervisor-root': mockRootSupervisor,
};
