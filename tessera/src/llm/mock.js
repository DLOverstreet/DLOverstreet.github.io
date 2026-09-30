// The deterministic mock provider. Each agent has a small "brain" in src/agents/mock that
// produces plausible structured output from the agent's input, so the whole loop runs with
// no keys and no network. Recorded fixtures take precedence, and tests can queue scripted
// responses (including invalid ones) to exercise the retry path.
import { canonicalJson, hashString } from '../lib/util.js';
import { estimateTokens } from './prices.js';

export function fixtureKey(agent, promptVersion, input) {
  return `${agent}:${promptVersion}:${hashString(canonicalJson(input)).toString(16)}`;
}

/** @param {{ brains?: Record<string, Function>, fixtures?: Record<string, any>, latencyMs?: number }} [opts] */
export function createMockProvider({ brains = {}, fixtures = {}, latencyMs = 0 } = {}) {
  const queues = new Map();
  const cached = new Set();
  return {
    name: 'mock',
    fixtures,
    /** Queue raw responses (strings, objects, or functions of the input) for an agent; they are served before the brain runs. */
    queue(agent, responses) { queues.set(agent, [...(queues.get(agent) || []), ...responses]); },
    clearQueues() { queues.clear(); },
    async complete(req) {
      if (req.onStart) req.onStart();
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const q = queues.get(req.agent);
      let out;
      if (q && q.length) {
        out = q.shift();
        if (typeof out === 'function') out = out(req.input);
      } else {
        const key = fixtureKey(req.agent, req.promptVersion, req.input);
        if (fixtures[key] !== undefined) out = fixtures[key];
        else {
          const brain = brains[req.agent];
          if (!brain) throw new Error(`The mock has no brain for agent "${req.agent}"`);
          out = brain(req.input, { attempt: req.attempt || 0, feedback: req.feedback, model: req.model });
        }
      }
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      // Blocks marked for the prompt cache are counted as a cache write the first time this mock
      // sees them and as a read after, as the API would, so the swarm's costs and tests see it.
      // Caches are per model; a call that caches (cacheSystem) caches its system prompt for an hour.
      const usage = { inputTokens: 0, outputTokens: estimateTokens(text), cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, ...(req.batch ? { batch: true } : {}) };
      const count = (textIn, cache) => {
        const n = estimateTokens(textIn);
        const key = `${req.model}:${hashString(textIn)}`;
        if (!cache) usage.inputTokens += n;
        else if (cached.has(key)) usage.cacheReadTokens += n;
        else { cached.add(key); usage.cacheWriteTokens += n; if (cache === '1h') usage.cacheWrite1hTokens += n; }
      };
      count(req.system || '', req.cacheSystem ? '1h' : false);
      for (const m of req.messages) {
        if (typeof m.content === 'string') { usage.inputTokens += estimateTokens(m.content); continue; }
        for (const b of m.content) count(b.text, b.cache);
      }
      return { text, model: req.model, usage };
    },
  };
}
