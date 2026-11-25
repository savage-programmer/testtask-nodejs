/**
 * Fixed-window in-memory rate limiter. One instance per limit (per IP, per user).
 * For multi-instance deployments swap the Map for Redis; the interface stays.
 */
export function createRateLimiter({ windowMs = 60_000, max = 60, keyFn, name = 'requests' }) {
  const hits = new Map(); // key -> { count, resetAt }

  function purge(now) {
    if (hits.size < 10_000) return;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }

  function middleware(req, res, next) {
    const key = keyFn(req);
    if (key == null) return next();
    const now = Date.now();
    purge(now);

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit of ${max} ${name} per ${Math.round(windowMs / 1000)}s exceeded`,
        retryAfterSeconds: retryAfter,
      });
    }
    next();
  }

  middleware.reset = () => hits.clear();
  return middleware;
}

export const ipLimiter = (opts) => createRateLimiter({ ...opts, keyFn: (req) => req.ip ?? 'unknown', name: 'requests per IP' });
export const userLimiter = (opts) => createRateLimiter({ ...opts, keyFn: (req) => req.body?.userId ?? null, name: 'messages per user' });
