export class LlmError extends Error {
  /** @param {string} message @param {{retryable?: boolean, code?: string}} [opts] */
  constructor(message, { retryable = true, code = 'llm_error' } = {}) {
    super(message);
    this.name = 'LlmError';
    this.retryable = retryable;
    this.code = code;
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
