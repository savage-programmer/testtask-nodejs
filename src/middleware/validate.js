import { z } from 'zod';
import { badRequest } from '../errors.js';

const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_MESSAGE_LENGTH = 2000;

export const UserIdSchema = z.string().regex(USER_ID_RE, 'must be 1-64 characters of letters, digits, _ or -');

export const ChatPayloadSchema = z.object({
  userId: UserIdSchema,
  message: z
    .string({ error: 'must be a non-empty string' })
    .trim()
    .min(1, 'must be a non-empty string')
    .max(MAX_MESSAGE_LENGTH, `must be at most ${MAX_MESSAGE_LENGTH} characters`),
});

const issuesToDetails = (error) => error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);

export function isValidUserId(value) {
  return UserIdSchema.safeParse(value).success;
}

export function validateUserIdParam(req, res, next) {
  const result = UserIdSchema.safeParse(req.params.userId);
  if (!result.success) return next(badRequest('Invalid userId', issuesToDetails(result.error)));
  next();
}

export function validateChatPayload(req, res, next) {
  const result = ChatPayloadSchema.safeParse(req.body);
  if (!result.success) return next(badRequest('Validation failed', issuesToDetails(result.error)));
  req.body = result.data; // only validated, trimmed fields reach the service
  next();
}
