import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import { createRuleProvider } from '../src/ai/index.js';

// Rule-based provider wrapped with a random delay so concurrent requests
// genuinely overlap and race for the store.
const rules = createRuleProvider();
const slowAi = {
  name: 'rules',
  async analyze(input) {
    await new Promise((r) => setTimeout(r, Math.random() * 30));
    return { ...(await rules.analyze(input)), source: 'rules' };
  },
};

const store = createMemoryStore();
// Rate limiting is covered in part3.test.js; off here so the concurrency tests can burst.
const app = createApp({ store, ai: slowAi, rateLimit: null });
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, raw = false) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
const get = (path) => fetch(`${base}${path}`);

const STRUCTURED_KEYS = ['intent', 'sentiment', 'priority', 'language', 'response'];

describe('GET /health', () => {
  test('returns ok', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptimeSeconds, 'number');
  });
});

describe('POST /chat validation', () => {
  test('rejects empty message', async () => {
    const res = await post('/chat', { userId: 'u1', message: '   ' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Validation failed');
    assert.ok(body.details.some((d) => d.includes('message')));
  });

  test('rejects missing message', async () => {
    const res = await post('/chat', { userId: 'u1' });
    assert.equal(res.status, 400);
  });

  test('rejects invalid userId', async () => {
    for (const userId of ['', 'has space', 'a'.repeat(65), 42, null]) {
      const res = await post('/chat', { userId, message: 'hello' });
      assert.equal(res.status, 400, `userId ${JSON.stringify(userId)} should be rejected`);
    }
  });

  test('rejects malformed JSON with 400', async () => {
    const res = await post('/chat', '{"userId": "u1", "message": ', true);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Bad Request', message: 'Invalid JSON body' });
  });

  test('rejects non-object body', async () => {
    const res = await post('/chat', ['x']);
    assert.equal(res.status, 400);
  });
});

describe('POST /chat success', () => {
  test('returns the structured analysis for the example input', async () => {
    const res = await post('/chat', {
      userId: 'rahul-001',
      message: 'My withdrawal has been pending for 3 hours. Nobody is helping me. I want my money back.',
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    for (const k of STRUCTURED_KEYS) assert.ok(k in body, `missing ${k}`);
    assert.equal(body.intent, 'withdrawal_issue');
    assert.equal(body.sentiment, 'negative');
    assert.equal(body.priority, 'high');
    assert.equal(body.language, 'English');
    assert.match(body.response, /withdrawal/i);
    assert.equal(body.userId, 'rahul-001');
    assert.equal(body.sequence, 1);
    assert.equal(body.source, 'rules');
    assert.deepEqual(body.flags, []);
  });

  test('keeps conversation context: repeat contact is acknowledged and escalated', async () => {
    const first = await (await post('/chat', { userId: 'ctx', message: 'How do I reset my password?' })).json();
    assert.equal(first.intent, 'account_access');
    assert.equal(first.priority, 'medium');
    assert.doesNotMatch(first.response, /already contacted/);

    const second = await (await post('/chat', { userId: 'ctx', message: 'Password reset link never arrived, please help' })).json();
    assert.equal(second.intent, 'account_access');
    assert.equal(second.priority, 'high');
    assert.match(second.response, /already contacted/);

    // Context does not leak to a different user with the same issue.
    const other = await (await post('/chat', { userId: 'ctx-other', message: 'How do I reset my password?' })).json();
    assert.doesNotMatch(other.response, /already contacted/);
  });

  test('detects non-English messages', async () => {
    const hi = await (await post('/chat', { userId: 'lang', message: 'मेरी निकासी अभी भी लंबित है' })).json();
    assert.equal(hi.language, 'Hindi');
    const es = await (await post('/chat', { userId: 'lang', message: 'No quiero el bono, quiero mi dinero por favor' })).json();
    assert.equal(es.language, 'Spanish');
  });
});

describe('GET /history/:userId', () => {
  test('rejects invalid userId', async () => {
    const res = await get('/history/bad%20id');
    assert.equal(res.status, 400);
  });

  test('returns empty history for unknown user', async () => {
    const res = await get('/history/nobody');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userId: 'nobody', count: 0, history: [] });
  });

  test('keeps histories separate per user', async () => {
    await post('/chat', { userId: 'bob', message: 'My deposit has not been credited' });
    await post('/chat', { userId: 'carol', message: 'Thanks, great service!' });
    await post('/chat', { userId: 'bob', message: 'Deposit still missing' });

    const bob = await (await get('/history/bob')).json();
    const carol = await (await get('/history/carol')).json();

    assert.equal(bob.count, 2);
    assert.ok(bob.history.every((e) => e.userId === 'bob'));
    assert.deepEqual(bob.history.map((e) => e.sequence), [1, 2]);
    assert.ok(bob.history.every((e) => e.analysis.intent === 'deposit_issue'));

    assert.equal(carol.count, 1);
    assert.equal(carol.history[0].userId, 'carol');
    assert.equal(carol.history[0].analysis.sentiment, 'positive');
  });
});

describe('concurrency', () => {
  test('two simultaneous requests for the same user are both stored, in order, without interleaving', async () => {
    const userId = 'dave';
    const [r1, r2] = await Promise.all([
      post('/chat', { userId, message: 'first message: where is my bonus?' }),
      post('/chat', { userId, message: 'second message: password reset please' }),
    ]);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);

    assert.notEqual(b1.messageId, b2.messageId);
    assert.deepEqual([b1.sequence, b2.sequence].sort(), [1, 2]);

    const { count, history } = await (await get(`/history/${userId}`)).json();
    assert.equal(count, 2);
    assert.deepEqual(history.map((e) => e.sequence), [1, 2]);
    assert.deepEqual(
      new Set(history.map((e) => e.message)),
      new Set(['first message: where is my bonus?', 'second message: password reset please']),
    );
    assert.ok(history.every((e) => e.userId === userId));
  });

  test('many simultaneous requests for one user all land with unique sequences', async () => {
    const userId = 'erin';
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => post('/chat', { userId, message: `msg ${i}` })),
    );
    assert.ok(results.every((r) => r.status === 201));
    const { count, history } = await (await get(`/history/${userId}`)).json();
    assert.equal(count, N);
    assert.deepEqual(history.map((e) => e.sequence), Array.from({ length: N }, (_, i) => i + 1));
    assert.equal(new Set(history.map((e) => e.id)).size, N);
  });
});

describe('GET /stats', () => {
  test('returns totals and intent/sentiment counts', async () => {
    const res = await get('/stats');
    assert.equal(res.status, 200);
    const stats = await res.json();
    // rahul 1 + ctx 2 + ctx-other 1 + lang 2 + bob 2 + carol 1 + dave 2 + erin 25
    const expectedTotal = 36;
    assert.equal(stats.totalMessages, expectedTotal);
    assert.equal(stats.totalUsers, 8);
    assert.equal(Object.values(stats.intents).reduce((a, b) => a + b, 0), expectedTotal);
    assert.equal(Object.values(stats.sentiments).reduce((a, b) => a + b, 0), expectedTotal);
    assert.equal(stats.intents.withdrawal_issue, 1);
    assert.equal(stats.intents.deposit_issue, 2);
    assert.equal(stats.intents.account_access, 4);
    assert.ok(stats.sentiments.positive >= 1);
  });
});

describe('error handling', () => {
  test('unknown route returns 404 JSON', async () => {
    const res = await get('/nope');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Not Found');
  });

  test('AI provider failure surfaces as 500 JSON through the central handler', async () => {
    const failingApp = createApp({
      store: createMemoryStore(),
      rateLimit: null,
      ai: {
        name: 'broken',
        analyze: async () => {
          throw new Error('boom');
        },
      },
    });
    const s = failingApp.listen(0);
    await new Promise((r) => s.once('listening', r));
    const origError = console.error;
    console.error = () => {};
    try {
      const res = await fetch(`http://localhost:${s.address().port}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'x', message: 'hi' }),
      });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'Internal Server Error' });
    } finally {
      console.error = origError;
      s.close();
    }
  });
});
