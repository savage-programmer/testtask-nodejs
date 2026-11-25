import { createClaudeProvider } from './claudeProvider.js';
import { createOpenAiCompatProvider } from './openaiCompatProvider.js';
import { createGeminiProvider } from './geminiProvider.js';
import { createMockProvider } from './mockProvider.js';
import { createRuleProvider } from './ruleProvider.js';
import { withTimeout, withFallback, withGuards, tagged } from './wrappers.js';

export { createClaudeProvider, createOpenAiCompatProvider, createGeminiProvider, createMockProvider, createRuleProvider };
export * from './wrappers.js';

export const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Provider registry. Each entry builds a raw adapter from the environment.
 * Add a vendor here; nothing in routes or the chat service changes.
 */
export const PROVIDERS = {
  claude: (env) => createClaudeProvider({ model: env.AI_MODEL || 'claude-opus-5-5' }),
  // Verified live 2026-11-25; heavier Gemini models returned 503 "high demand" on the free tier.
  gemini: (env) => createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL || 'gemini-3.5-flash-lite' }),
  openrouter: (env) =>
    createOpenAiCompatProvider({
      name: 'openrouter',
      baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY,
      // Free models rotate; list current ones at https://openrouter.ai/collections/free-models
      model: env.AI_MODEL || 'nvidia/nemotron-3.5-super-vl:free',
      headers: { 'X-Title': 'TestTask Nodejs' },
    }),
  ollama: (env) =>
    createOpenAiCompatProvider({
      name: 'ollama',
      baseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: env.AI_MODEL || 'llama3.2',
    }),
  mock: () => createMockProvider(),
  rules: () => createRuleProvider(),
};

/**
 * Standard safety pipeline around any primary provider:
 *   guards( fallback( timeout(primary), rules ) )
 * - timeout: the AI call is abandoned after `timeoutMs` (default 5s)
 * - fallback: timeouts, invalid output and provider errors fall back to rules
 * - guards: prompt-injection flagging and removal of "action taken" claims
 */
export function composeProvider(primary, { timeoutMs = DEFAULT_TIMEOUT_MS, fallback = createRuleProvider(), logger } = {}) {
  if (primary.name === 'rules') return withGuards(tagged(primary));
  return withGuards(withFallback(withTimeout(primary, timeoutMs), fallback, { logger }));
}

/**
 * Selects and composes the provider from configuration.
 *
 *   AI_PROVIDER = claude | gemini | openrouter | ollama | mock | rules
 *   unset       -> claude if an Anthropic credential is present, else rules
 *   AI_TIMEOUT_MS (default 5000)
 */
export function createAiProvider({ provider, env = process.env, timeoutMs, logger } = {}) {
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const choice = provider ?? env.AI_PROVIDER ?? (hasAnthropic ? 'claude' : 'rules');
  const factory = PROVIDERS[choice];
  if (!factory) {
    throw new Error(`Unknown AI_PROVIDER "${choice}" (expected one of ${Object.keys(PROVIDERS).join(', ')})`);
  }
  const ms = timeoutMs ?? (Number(env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  return composeProvider(factory(env), { timeoutMs: ms, logger });
}
