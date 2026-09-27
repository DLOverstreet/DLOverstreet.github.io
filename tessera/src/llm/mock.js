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
  return {
    name: 'mock',
    fixtures,
    /** Queue raw responses (strings or objects) for an agent; they are served before the brain runs. */
    queue(agent, responses) { queues.set(agent, [...(queues.get(agent) || []), ...responses]); },
    clearQueues() { queues.clear(); },
    async complete(req) {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const q = queues.get(req.agent);
      let out;
      if (q && q.length) {
        out = q.shift();
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
      const promptText = req.system + req.messages.map((m) => m.content).join('\n');
      return { text, model: req.model, usage: { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(text) } };
    },
  };
}
