import Anthropic from '@anthropic-ai/sdk';
import { ANALYSIS_JSON_SCHEMA, parseAnalysis } from './schema.js';
import { SYSTEM_PROMPT, buildTurns } from './prompt.js';

/**
 * Claude-backed provider (Anthropic SDK). The client is injectable for tests.
 * Output is requested as structured JSON and still validated with Zod.
 */
export function createClaudeProvider({
  client = new Anthropic(),
  model = process.env.AI_MODEL || 'claude-opus-5-5',
  contextTurns = 6,
} = {}) {
  return {
    name: 'claude',
    async analyze({ userId, message, history = [], signal }) {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 1024,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA },
          },
          system: SYSTEM_PROMPT,
          messages: buildTurns({ userId, message, history, contextTurns }),
        },
        { signal },
      );

      if (response.stop_reason === 'refusal') {
        throw new Error(`Model refused: ${response.stop_details?.category ?? 'unknown'}`);
      }
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return parseAnalysis(text);
    },
  };
}
