import express from 'express';
import { createMemoryStore } from './store/memoryStore.js';
import { createAiProvider } from './ai/index.js';
import { createChatService } from './services/chatService.js';
import { createRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { ipLimiter, userLimiter } from './middleware/rateLimit.js';

const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Builds the Express app. `store`, `ai` and `rateLimit` are injectable for
 * tests and for swapping the AI provider without changing routes.
 */
export function createApp({
  store = createMemoryStore(),
  ai = createAiProvider(),
  rateLimit = {
    perIp: { windowMs: 60_000, max: envInt('RATE_LIMIT_IP_PER_MIN', 120) },
    perUser: { windowMs: 60_000, max: envInt('RATE_LIMIT_USER_PER_MIN', 20) },
  },
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  if (rateLimit?.perIp) app.use(ipLimiter(rateLimit.perIp));

  const chatService = createChatService({ store, ai });
  app.use(
    createRouter({
      chatService,
      startedAt: Date.now(),
      userLimiter: rateLimit?.perUser ? userLimiter(rateLimit.perUser) : null,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export default createApp();
