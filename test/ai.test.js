import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClaudeProvider,
  createRuleProvider,
  createMockProvider,
  createAiProvider,
  composeProvider,
  PROVIDERS,
} from '../src/ai/index.js';
import { ANALYSIS_JSON_SCHEMA, AnalysisSchema, parseAnalysis, normalizeAnalysis, AiOutputError } from '../src/ai/schema.js';
import { buildTurns } from '../src/ai/prompt.js';

// Fake Anthropic client: records the request and returns a canned response.
function fakeClient(response) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params, opts) => (calls.push({ params, opts }), response) } },
  };
}
const textResponse = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });

const EXAMPLE = 'My withdrawal has been pending for 3 hours. Nobody is helping me. I want my money back.';
const VALID = { intent: 'withdrawal_issue', sentiment: 'negative', priority: 'high', language: 'English', response: 'We understand your concern.' };
const silent = { warn() {} };

describe('schema (Zod)', () => {
  test('JSON schema derived from Zod has required fields and no extra properties', () => {
    assert.deepEqual(ANALYSIS_JSON_SCHEMA.required, ['intent', 'sentiment', 'priority', 'language', 'response']);
    assert.equal(ANALYSIS_JSON_SCHEMA.additionalProperties, false);
    assert.deepEqual(ANALYSIS_JSON_SCHEMA.properties.intent.enum, ['deposit_issue', 'withdrawal_issue', 'account_access', 'bonus_query', 'other']);
    assert.equal('$schema' in ANALYSIS_JSON_SCHEMA, false);
  });

  test('AnalysisSchema rejects bad enum values, missing and extra fields', () => {
    assert.equal(AnalysisSchema.safeParse(VALID).success, true);
    assert.equal(AnalysisSchema.safeParse({ ...VALID, intent: 'refund' }).success, false);
    assert.equal(AnalysisSchema.safeParse({ ...VALID, priority: 'urgent' }).success, false);
    const { response, ...missing } = VALID;
    assert.equal(AnalysisSchema.safeParse(missing).success, false);
    assert.equal(AnalysisSchema.safeParse({ ...VALID, extra: 1 }).success, false);
  });

  test('parseAnalysis accepts fenced JSON and throws AiOutputError otherwise', () => {
    assert.deepEqual(parseAnalysis('```json\n' + JSON.stringify(VALID) + '\n```'), VALID);
    assert.throws(() => parseAnalysis('Sure! Here is my analysis: the customer is upset.'), AiOutputError);
    assert.throws(() => parseAnalysis(JSON.stringify({ ...VALID, sentiment: 'furious' })), (e) => e instanceof AiOutputError && e.issues[0].startsWith('sentiment'));
  });

  test('normalizeAnalysis coerces invalid values to safe defaults', () => {
    const r = normalizeAnalysis({ intent: 'weird', sentiment: 'meh', priority: '??', language: '', response: '  ' });
    assert.equal(r.intent, 'other');
    assert.equal(r.sentiment, 'neutral');
    assert.equal(r.priority, 'low');
    assert.equal(r.language, 'English');
    assert.ok(r.response.length > 0);
  });
});

describe('prompt building / context isolation', () => {
  test('buildTurns includes only the current user history and wraps customer text', () => {
    const history = [
      { userId: 'a', message: 'A1', analysis: VALID },
      { userId: 'b', message: 'B1 secret', analysis: VALID },
      { userId: 'a', message: 'A2', analysis: VALID },
    ];
    const turns = buildTurns({ userId: 'a', message: 'A3', history });
    const text = JSON.stringify(turns);
    assert.ok(text.includes('A1') && text.includes('A2') && text.includes('A3'));
    assert.ok(!text.includes('B1 secret'));
    assert.equal(turns.at(-1).role, 'user');
    assert.match(turns.at(-1).content, /^<customer_message>\nA3\n<\/customer_message>$/);
  });
});

describe('rule provider', () => {
  const rules = createRuleProvider();

  test('classifies the example message', async () => {
    const r = await rules.analyze({ userId: 'rahul-001', message: EXAMPLE, history: [] });
    assert.equal(r.intent, 'withdrawal_issue');
    assert.equal(r.sentiment, 'negative');
    assert.equal(r.priority, 'high');
    assert.equal(r.language, 'English');
  });

  test('classifies each intent', async () => {
    const cases = [
      ['Can I get the welcome bonus?', 'bonus_query'],
      ['My card deposit failed', 'deposit_issue'],
      ['Locked out of my account after KYC', 'account_access'],
      ['Hello, what are your opening hours?', 'other'],
    ];
    for (const [message, intent] of cases) assert.equal((await rules.analyze({ message })).intent, intent, message);
  });

  test('uses history: repeated issue escalates priority and changes the response', async () => {
    const r = await rules.analyze({ message: 'Any update on my bonus?', history: [{ analysis: { intent: 'bonus_query' } }] });
    assert.equal(r.priority, 'high');
    assert.match(r.response, /already contacted/);
  });
});

describe('Claude provider', () => {
  test('requests structured JSON, passes the abort signal, replays only own history', async () => {
    const client = fakeClient(textResponse(VALID));
    const provider = createClaudeProvider({ client, model: 'claude-opus-5-5' });
    const history = [
      { userId: 'rahul-001', message: 'Where is my withdrawal?', analysis: VALID },
      { userId: 'someone-else', message: 'OTHER USER TEXT', analysis: VALID },
    ];
    const signal = new AbortController().signal;
    const r = await provider.analyze({ userId: 'rahul-001', message: EXAMPLE, history, signal });
    assert.deepEqual(r, VALID);

    const { params, opts } = client.calls[0];
    assert.equal(params.model, 'claude-opus-5-5');
    assert.deepEqual(params.output_config.format, { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA });
    assert.equal(params.messages.length, 3);
    assert.ok(!JSON.stringify(params.messages).includes('OTHER USER TEXT'));
    assert.equal(opts.signal, signal);
  });

  test('throws AiOutputError on a prose paragraph', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'The customer seems unhappy about a withdrawal.' }] });
    await assert.rejects(createClaudeProvider({ client }).analyze({ userId: 'u', message: 'x' }), AiOutputError);
  });

  test('throws on refusal', async () => {
    const client = fakeClient({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] });
    await assert.rejects(createClaudeProvider({ client }).analyze({ userId: 'u', message: 'x' }), /refused: cyber/);
  });
});

describe('provider registry and composition', () => {
  test('every registered provider can be built from a minimal env', () => {
    const env = { GEMINI_API_KEY: 'k', OPENROUTER_API_KEY: 'k' };
    for (const name of Object.keys(PROVIDERS)) {
      const p = createAiProvider({ provider: name, env });
      assert.equal(typeof p.analyze, 'function', name);
    }
    assert.deepEqual(Object.keys(PROVIDERS).sort(), ['claude', 'gemini', 'mock', 'ollama', 'openrouter', 'rules']);
  });

  test('auto selection: claude with an Anthropic credential, rules without', () => {
    assert.equal(createAiProvider({ env: { ANTHROPIC_API_KEY: 'k' } }).name, 'claude+rules');
    assert.equal(createAiProvider({ env: {} }).name, 'rules');
    assert.equal(createAiProvider({ env: { AI_PROVIDER: 'mock' } }).name, 'mock+rules');
    assert.throws(() => createAiProvider({ env: { AI_PROVIDER: 'skynet' } }), /Unknown AI_PROVIDER/);
    assert.throws(() => createAiProvider({ provider: 'gemini', env: {} }), /GEMINI_API_KEY/);
  });

  test('composed mock provider returns tagged, guarded results', async () => {
    const p = composeProvider(createMockProvider({ result: VALID }), { logger: silent });
    const r = await p.analyze({ userId: 'u', message: 'hello', history: [] });
    assert.equal(r.source, 'mock');
    assert.deepEqual(r.flags, []);
    assert.equal(r.response, VALID.response);
  });
});
