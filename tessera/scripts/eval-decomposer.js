// npm run eval:decomposer
// Runs the Decomposer on fifteen fixture commissions and reports validity, separability
// (grade, speedup, coverage), tile-size spread, the share of AUTO criteria, and cost. Uses the mock unless TESSERA_LLM_PROVIDER=anthropic
// (with ANTHROPIC_API_KEY set). Run it before and after any prompt change.
import { runDecomposerEval } from '../src/agents/eval.js';
import { createMockProvider } from '../src/llm/mock.js';
import { createAnthropicProvider } from '../src/llm/anthropic.js';
import { mockBrains } from '../src/agents/mock/index.js';
import { config } from '../src/domain/config.js';

const provider = process.env.TESSERA_LLM_PROVIDER || 'mock';
const heavy = process.env.TESSERA_MODEL_HEAVY || config.llm.heavyModel;
let route;
if (provider === 'anthropic') {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY to run the eval on Claude.'); process.exit(1); }
  route = { provider: createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }), model: heavy, providerName: 'anthropic' };
} else {
  route = { provider: createMockProvider({ brains: mockBrains }), model: 'mock-heavy', providerName: 'mock', shadowModel: heavy };
}

console.log(`Decomposer eval · provider ${provider} · model ${route.model}\n`);
const { results, summary } = await runDecomposerEval({ route, onProgress: (n, rs) => {
  const r = rs[rs.length - 1];
  console.log(`${String(n).padStart(2)}. ${r.valid ? 'valid  ' : 'INVALID'} ${r.fixture.slice(0, 52).padEnd(52)} ${r.valid ? `${String(r.tiles).padStart(3)} tiles  grade ${r.grade}  ${r.speedup.toFixed(1)}x  cover ${Math.round(r.coverage * 100)}%  ${r.minMinutes}-${r.medianMinutes}-${r.maxMinutes} min  AUTO ${Math.round(r.autoShare * 100)}%  $${(r.totalCents / 100).toFixed(0)}` : r.error}`);
} });
console.log(`\nValid graphs: ${summary.valid}/${summary.total}`);
console.log(`Median tiles: ${summary.medianTiles}`);
console.log(`Median separability score: ${summary.medianScore} · median speedup ${summary.medianSpeedup.toFixed(1)}x · requirement coverage ${Math.round(summary.coverage * 100)}%`);
console.log(`Criteria marked AUTO: ${Math.round(summary.autoShare * 100)}%`);
console.log(`Cost: $${summary.costUsd.toFixed(4)}${provider === 'mock' ? ` (shadow cost at ${heavy} prices: $${summary.shadowCostUsd.toFixed(4)})` : ''}`);
const unrunnable = results.filter((r) => r.valid && r.runnableAutoShare < 1);
if (unrunnable.length) console.log(`AUTO criteria without a runnable rule in: ${unrunnable.map((r) => r.fixture).join('; ')}`);
process.exit(summary.valid >= summary.total - 1 && summary.medianScore >= 80 ? 0 : 1);
