export class LlmError extends Error {
  /**
   * @param {string} message
   * @param {{retryable?: boolean, code?: string, usage?: any, model?: string|null}} [opts] usage and model: what a
   *   call that got a response but can't be used (cut off at max_tokens, declined) still spent, so it's logged and billed
   */
  constructor(message, { retryable = true, code = 'llm_error', usage = null, model = null } = {}) {
    super(message);
    this.name = 'LlmError';
    this.retryable = retryable;
    this.code = code;
    this.usage = usage;
    this.model = model;
  }
}

export class AgentFailure extends Error {
  constructor(agent, message, attempts) {
    super(`${agent} failed after ${attempts} attempt(s): ${message}`);
    this.name = 'AgentFailure';
    this.agent = agent;
    this.attempts = attempts;
  }
}
