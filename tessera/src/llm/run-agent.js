// Every LLM call goes through runAgent. It renders the versioned prompt, calls the
// routed provider, parses the reply with the agent's schema and validator, retries up to
// twice with the validation errors as feedback, and logs every attempt as an AgentRun.
import { extractJson } from '../lib/util.js';
import { LlmError, AgentFailure } from './errors.js';
import { config } from '../domain/config.js';

function clip(value, max = 24000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s === undefined) return null;
  if (s.length <= max) return typeof value === 'string' ? value : JSON.parse(s);
  return { truncated: true, preview: s.slice(0, max) };
}

/**
 * @param {object} p
 * @param {object} p.agent { name, prompt: { version, system, render(input) }, schema?, validate?(output, input) => string[], format?: 'json'|'text', effort? }
 * @param {object} p.input structured input for the prompt
 * @param {{provider: object, model: string, providerName: string, shadowModel?: string}} p.route
 * @param {(row: object) => void} p.log writes an AgentRun row
 * @param {object} [p.meta] { commissionId, tileId, userId } for cost attribution
 * @param {{role: string, content: string}[]} [p.history] prior chat turns (copilot)
 * @param {number} [p.maxTokens]
 * @param {number} [p.retries]
 * @param {boolean} [p.bestEffort] if the last attempt parses but still fails the validator, return it with its problems instead of failing
 * @param {any[]} [p.tools] server tools for the call (web search, web fetch); providers without them ignore them
 * @param {string} [p.effort] overrides the agent's effort level
 */
export async function runAgent({ agent, input, route, log, meta = {}, history = [], maxTokens, retries = config.llm.maxRetries, bestEffort = false, tools, effort }) {
  const system = agent.prompt.system;
  const format = agent.format || 'json';
  const baseMessages = [...history, { role: 'user', content: agent.prompt.render(input) }];
  let messages = baseMessages;
  let lastError = 'unknown error';
  let feedback = null;
  let lastValid = null;
  const attempts = retries + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = Date.now();
    let res = null;
    let output = null;
    let error = null;
    try {
      res = await route.provider.complete({
        agent: agent.name, promptVersion: agent.prompt.version, input, attempt, feedback,
        model: route.model, system, messages, maxTokens,
        jsonSchema: format === 'json' && agent.schema ? agent.schema.jsonSchema() : undefined,
        tools, effort: effort || agent.effort,
      });
      if (format === 'text') {
        output = String(res.text || '').trim();
        if (!output) throw new Error('empty response');
      } else {
        const raw = extractJson(res.text);
        const parsed = agent.schema.safeParse(raw);
        if (!parsed.success) throw new ValidationProblem([parsed.error.message]);
        const problems = agent.validate ? agent.validate(parsed.data, input) : [];
        if (problems.length) { lastValid = { output: parsed.data, model: res.model, problems }; throw new ValidationProblem(problems); }
        output = parsed.data;
      }
    } catch (e) {
      error = e;
    }
    log({
      agent: agent.name,
      promptVersion: agent.prompt.version,
      provider: route.providerName,
      model: res?.model || route.model,
      shadowModel: route.shadowModel || null,
      input: clip(input),
      output: error ? (res ? clip(res.text, 8000) : null) : clip(output),
      error: error ? String(error.message || error) : null,
      tokensIn: res?.usage?.inputTokens ?? null,
      tokensOut: res?.usage?.outputTokens ?? null,
      webSearches: res?.usage?.webSearches || 0,
      webFetches: res?.usage?.webFetches || 0,
      sources: res?.sources?.length ? res.sources.slice(0, 40).map((x) => ({ url: x.url, title: x.title, kind: x.kind })) : null,
      latencyMs: Date.now() - started,
      attempt: attempt + 1,
      commissionId: meta.commissionId || null,
      tileId: meta.tileId || null,
      userId: meta.userId || null,
    });
    if (!error) return { output, model: res.model, provider: route.providerName, sources: res.sources || [], usage: res.usage || null };
    lastError = String(error.message || error);
    if (error instanceof LlmError && !error.retryable) throw new AgentFailure(agent.name, lastError, attempt + 1);
    if (error instanceof ValidationProblem && res) {
      feedback = error.problems;
      messages = [
        ...baseMessages,
        { role: 'assistant', content: String(res.text).slice(0, 12000) },
        { role: 'user', content: `That reply was rejected by the validator:\n- ${error.problems.join('\n- ')}\nReturn the corrected JSON only.` },
      ];
    }
  }
  if (bestEffort && lastValid) return { output: lastValid.output, model: lastValid.model, provider: route.providerName, problems: lastValid.problems };
  throw new AgentFailure(agent.name, lastError, attempts);
}

export class ValidationProblem extends Error {
  constructor(problems) { super(problems.join('; ')); this.name = 'ValidationProblem'; this.problems = problems; }
}
