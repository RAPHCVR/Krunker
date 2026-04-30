import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { sanitizeDisplayName, type AuthResponse, type AuthUser } from '@krunker-arena/shared';
import type { UserStore } from './db.js';

const COOKIE_NAME = 'krunker_session';

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(18).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(18).optional(),
});

export function createAuthRouter(store: UserStore, sessionSecret: string, secureCookies: boolean): Router {
  const router = Router();
  const credentialsRateLimit = createRateLimit({ limit: 20, windowMs: 5 * 60 * 1000 });

  router.post('/auth/register', credentialsRateLimit, async (request, response, next) => {
    try {
      const input = credentialsSchema.parse(request.body);
      const username = input.username.toLowerCase();
      if (await store.findByUsername(username)) return response.status(409).json({ error: 'USERNAME_TAKEN' });

      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const user = await store.createUser({ username, displayName: sanitizeDisplayName(input.displayName ?? input.username), passwordHash });
      setSessionCookie(response, signUser(user, sessionSecret), secureCookies);
      return response.status(201).json(toAuthResponse(user));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/auth/login', credentialsRateLimit, async (request, response, next) => {
    try {
      const input = credentialsSchema.pick({ username: true, password: true }).parse(request.body);
      const user = await store.findByUsername(input.username.toLowerCase());
      if (!user || !(await argon2.verify(user.passwordHash, input.password))) return response.status(401).json({ error: 'INVALID_CREDENTIALS' });

      setSessionCookie(response, signUser(user, sessionSecret), secureCookies);
      return response.json(toAuthResponse(user));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/auth/logout', (_request, response) => {
    response.clearCookie(COOKIE_NAME, cookieOptions(secureCookies));
    response.status(204).end();
  });

  router.get('/me', async (request, response, next) => {
    try {
      const user = await getUserFromRequest(request, store, sessionSecret);
      if (!user) return response.status(401).json({ error: 'UNAUTHENTICATED' });
      return response.json(toAuthResponse(user));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export async function getUserFromRequest(request: Request, store: UserStore, sessionSecret: string): Promise<AuthUser | null> {
  const token = request.cookies?.[COOKIE_NAME];
  if (!token || typeof token !== 'string') return null;

  try {
    const payload = jwt.verify(token, sessionSecret) as { sub?: string };
    if (!payload.sub) return null;
    const user = await store.findById(payload.sub);
    return user ? { id: user.id, username: user.username, displayName: user.displayName } : null;
  } catch {
    return null;
  }
}

function signUser(user: AuthUser, sessionSecret: string): string {
  return jwt.sign({ name: user.displayName }, sessionSecret, { subject: user.id, expiresIn: '7d' });
}

function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.cookie(COOKIE_NAME, token, cookieOptions(secure));
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function toAuthResponse(user: AuthUser): AuthResponse {
  return { user: { id: user.id, username: user.username, displayName: user.displayName } };
}

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

function createRateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
      pruneExpiredBuckets(buckets, now);
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      response.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      response.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }

    next();
  };
}

function pruneExpiredBuckets(buckets: Map<string, { count: number; resetAt: number }>, now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
