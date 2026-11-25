import { detectInjection, scrubActionClaims } from './guards.js';

/**
 * Composable provider wrappers. Each takes a provider and returns a provider
 * with the same analyze({ userId, message, history, signal }) interface, so
 * they can be stacked in any order in src/ai/index.js.
 */

export class AiTimeoutError extends Error {
  constructor(ms) {
    super(`AI provider timed out after ${ms}ms`);
    this.name = 'AiTimeoutError';
  }
}

/** Rejects with AiTimeoutError if the provider takes longer than `ms`. */
export function withTimeout(provider, ms) {
  return {
    name: provider.name,
    analyze(input) {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AiTimeoutError(ms));
        }, ms);
      });
      return Promise.race([provider.analyze({ ...input, signal: controller.signal }), timeout]).finally(() =>
        clearTimeout(timer),
      );
    },
  };
}

const reasonFor = (err) => {
  if (err?.name === 'AiTimeoutError') return 'timeout';
  if (err?.name === 'AiOutputError') return 'invalid_output';
  return 'provider_error';
};

/**
 * Uses `fallback` when `primary` throws (timeout, invalid output, network, refusal).
 * Tags the result with the provider that produced it and why a fallback happened.
 */
export function withFallback(primary, fallback, { logger = console } = {}) {
  return {
    name: `${primary.name}+${fallback.name}`,
    async analyze(input) {
      try {
        return { ...(await primary.analyze(input)), source: primary.name };
      } catch (err) {
        const reason = reasonFor(err);
        logger.warn(`[ai] ${primary.name} failed (${reason}: ${err.message}); using ${fallback.name}`);
        return { ...(await fallback.analyze(input)), source: fallback.name, fallbackReason: reason };
      }
    },
  };
}

/** Tags results with the provider name (for providers used without a fallback). */
export function tagged(provider) {
  return {
    name: provider.name,
    analyze: async (input) => ({ ...(await provider.analyze(input)), source: provider.name }),
  };
}

/**
 * Flags prompt-injection attempts and strips any claim that an action was taken.
 * Applied last so it covers every provider, including fallbacks.
 */
export function withGuards(provider) {
  return {
    name: provider.name,
    async analyze(input) {
      const flags = [];
      if (detectInjection(input.message)) flags.push('prompt_injection');

      const result = await provider.analyze(input);
      const { response, scrubbed } = scrubActionClaims(result.response);
      if (scrubbed) flags.push('unsafe_claim_removed');

      return { ...result, response, flags };
    },
  };
}
