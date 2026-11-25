import { Router } from 'express';
import { validateChatPayload, validateUserIdParam } from '../middleware/validate.js';

export function createRouter({ chatService, startedAt, userLimiter }) {
  const router = Router();

  // Express 5 forwards rejected promises from async handlers to the error handler.
  // Order: validate payload -> per-user rate limit (needs validated userId) -> handle.
  const chatMiddleware = [validateChatPayload, ...(userLimiter ? [userLimiter] : [])];
  router.post('/chat', ...chatMiddleware, async (req, res) => {
    const entry = await chatService.handleMessage(req.body);
    // Flat structured result (intent, sentiment, priority, language, response) + metadata.
    res.status(201).json({
      ...entry.analysis,
      flags: entry.flags,
      userId: entry.userId,
      messageId: entry.id,
      sequence: entry.sequence,
      source: entry.source,
      ...(entry.fallbackReason ? { fallbackReason: entry.fallbackReason } : {}),
      createdAt: entry.createdAt,
    });
  });

  router.get('/history/:userId', validateUserIdParam, async (req, res) => {
    const history = await chatService.getHistory(req.params.userId);
    res.json({ userId: req.params.userId, count: history.length, history });
  });

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/stats', async (req, res) => {
    res.json(await chatService.getStats());
  });

  return router;
}
