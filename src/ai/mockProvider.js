import { createRuleProvider } from './ruleProvider.js';

/**
 * Deterministic mock provider for tests and demos.
 *
 *   createMockProvider()                 -> rule-based results tagged "mock"
 *   createMockProvider({ result })       -> always returns `result` (may be invalid, to test validation)
 *   createMockProvider({ handler })      -> handler(input) decides (may throw / hang, to test failures)
 */
export function createMockProvider({ result, handler, delayMs = 0 } = {}) {
  const rules = createRuleProvider();
  return {
    name: 'mock',
    async analyze(input) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (handler) return handler(input);
      if (result !== undefined) return result;
      return rules.analyze(input);
    },
  };
}
