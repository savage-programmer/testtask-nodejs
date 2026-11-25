import { parseAnalysis } from './schema.js';
import { SYSTEM_PROMPT, buildTurns } from './prompt.js';

/**
 * Adapter for any OpenAI-compatible chat/completions endpoint:
 * OpenRouter (https://openrouter.ai/api/v1), Ollama (http://localhost:11434/v1),
 * LM Studio, vLLM, etc. `fetchImpl` is injectable for tests.
 */
export function createOpenAiCompatProvider({
  name,
  baseUrl,
  apiKey,
  model,
  headers = {},
  jsonMode = true,
  contextTurns = 6,
  fetchImpl = fetch,
}) {
  if (!baseUrl || !model) throw new Error(`${name}: baseUrl and model are required`);

  return {
    name,
    async analyze({ userId, message, history = [], signal }) {
      const body = {
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...buildTurns({ userId, message, history, contextTurns })],
        temperature: 0,
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        throw new Error(`${name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error(`${name}: unexpected response shape`);
      return parseAnalysis(text);
    },
  };
}
