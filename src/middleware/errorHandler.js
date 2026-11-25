import { HttpError } from '../errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.path} does not exist` });
}

// Centralized error handler: every thrown/rejected error ends up here.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload Too Large', message: 'Request body exceeds limit' });
  }
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
}
