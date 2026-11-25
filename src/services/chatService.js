import { randomUUID } from 'node:crypto';
import { AnalysisSchema } from '../ai/schema.js';

/**
 * Orchestrates a chat turn: load THIS user's context -> analyze -> store -> respond.
 *
 * `ai` is any provider implementing analyze({ userId, message, history }).
 * Route handlers never talk to an AI vendor directly, so the model or vendor is
 * swapped in src/ai/index.js without touching the backend or the API contract.
 *
 * Data isolation: history is read with the validated userId as the only key,
 * and only that history is handed to the provider.
 *
 * Concurrency: requests for the SAME user run through a per-user promise chain
 * (load -> analyze -> append is one atomic unit), so two simultaneous messages
 * never interleave, never overwrite each other, and the second sees the first
 * in its context. Different users run concurrently.
 */
export function createChatService({ store, ai }) {
  const queues = new Map(); // userId -> tail promise

  function withUserLock(userId, task) {
    const prev = queues.get(userId) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tracked = run.then(() => undefined, () => undefined).finally(() => {
      if (queues.get(userId) === tracked) queues.delete(userId);
    });
    queues.set(userId, tracked);
    return run;
  }

  return {
    handleMessage({ userId, message }) {
      return withUserLock(userId, async () => {
        const history = await store.getHistory(userId);
        const { source, fallbackReason, flags = [], ...analysis } = await ai.analyze({ userId, message, history });
        return store.append(userId, {
          id: randomUUID(),
          userId,
          message,
          analysis: AnalysisSchema.parse(analysis), // final contract check, whatever the provider
          source,
          ...(fallbackReason ? { fallbackReason } : {}),
          flags,
          createdAt: new Date().toISOString(),
        });
      });
    },

    getHistory: (userId) => store.getHistory(userId),
    getStats: () => store.getStats(),
  };
}
