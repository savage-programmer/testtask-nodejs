import { ANALYSIS_JSON_SCHEMA, parseAnalysis } from './schema.js';
import { SYSTEM_PROMPT, buildTurns } from './prompt.js';

// Gemini's responseSchema is an OpenAPI subset: drop keywords it rejects.
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (['additionalProperties', 'minLength', 'maxLength', '$schema'].includes(k)) continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

/**
 * Adapter for the Gemini API (Google AI Studio keys, free tier eligible).
 * Uses REST via fetch so no extra SDK is needed; `fetchImpl` is injectable.
 */
export function createGeminiProvider({
  apiKey,
  model = 'gemini-3.5-flash-lite',
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  contextTurns = 6,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('gemini: GEMINI_API_KEY is required');
  const responseSchema = toGeminiSchema(ANALYSIS_JSON_SCHEMA);

  return {
    name: 'gemini',
    async analyze({ userId, message, history = [], signal }) {
      const contents = buildTurns({ userId, message, history, contextTurns }).map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.content }],
      }));

      const res = await fetchImpl(`${baseUrl}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema },
        }),
        signal,
      });
      if (!res.ok) {
        throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) throw new Error('gemini: unexpected response shape');
      return parseAnalysis(parts.map((p) => p.text ?? '').join(''));
    },
  };
}
