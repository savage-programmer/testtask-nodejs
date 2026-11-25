// In-memory conversation store. Histories are kept per user in separate arrays.
export function createMemoryStore() {
  const histories = new Map(); // userId -> entry[]
  let total = 0;

  return {
    async append(userId, entry) {
      if (!histories.has(userId)) histories.set(userId, []);
      const list = histories.get(userId);
      const stored = { ...entry, sequence: list.length + 1 };
      list.push(stored);
      total += 1;
      return stored;
    },

    async getHistory(userId) {
      return [...(histories.get(userId) ?? [])];
    },

    async getStats() {
      const intents = {};
      const sentiments = {};
      for (const list of histories.values()) {
        for (const e of list) {
          intents[e.analysis.intent] = (intents[e.analysis.intent] ?? 0) + 1;
          sentiments[e.analysis.sentiment] = (sentiments[e.analysis.sentiment] ?? 0) + 1;
        }
      }
      return { totalMessages: total, totalUsers: histories.size, intents, sentiments };
    },

    async clear() {
      histories.clear();
      total = 0;
    },
  };
}
