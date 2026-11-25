import { z } from 'zod';

/**
 * Shared contract for every AI provider. A provider is any object with:
 *   name: string
 *   analyze({ userId, message, history, signal }) -> Promise<Analysis>
 * where history is ONLY this user's prior entries (oldest first) and signal is
 * an AbortSignal that fires when the call times out.
 */

export const INTENTS = ['deposit_issue', 'withdrawal_issue', 'account_access', 'bonus_query', 'other'];
export const SENTIMENTS = ['positive', 'neutral', 'negative'];
export const PRIORITIES = ['low', 'medium', 'high'];

/** Zod schema enforcing allowed values and required fields on provider output. */
export const AnalysisSchema = z.strictObject({
  intent: z.enum(INTENTS),
  sentiment: z.enum(SENTIMENTS),
  priority: z.enum(PRIORITIES),
  language: z.string().trim().min(1).max(40),
  response: z.string().trim().min(1).max(1000),
});

/** JSON Schema derived from the Zod schema, sent to providers that support structured output. */
export const ANALYSIS_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(AnalysisSchema);
  return schema;
})();

export class AiOutputError extends Error {
  constructor(message, { raw, issues } = {}) {
    super(message);
    this.name = 'AiOutputError';
    this.raw = raw;
    this.issues = issues;
  }
}

/**
 * Parses and validates raw model text. Throws AiOutputError on invalid JSON or
 * schema violations so the caller can fall back in a controlled way.
 */
export function parseAnalysis(text) {
  let data;
  try {
    const cleaned = String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
    data = JSON.parse(cleaned);
  } catch {
    throw new AiOutputError('Model returned non-JSON output', { raw: String(text).slice(0, 200) });
  }
  const result = AnalysisSchema.safeParse(data);
  if (!result.success) {
    throw new AiOutputError('Model output failed schema validation', {
      raw: data,
      issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  return result.data;
}

export const SAFE_FALLBACK_RESPONSE = 'Thank you for contacting us. Our team will review your request and get back to you shortly.';

/** Coerces arbitrary output into a valid Analysis (used by the rule provider). */
export function normalizeAnalysis(raw = {}) {
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  return AnalysisSchema.parse({
    intent: pick(raw.intent, INTENTS, 'other'),
    sentiment: pick(raw.sentiment, SENTIMENTS, 'neutral'),
    priority: pick(raw.priority, PRIORITIES, 'low'),
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : 'English',
    response: typeof raw.response === 'string' && raw.response.trim() ? raw.response.trim() : SAFE_FALLBACK_RESPONSE,
  });
}
