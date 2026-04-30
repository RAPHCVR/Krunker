import type { RequestHandler } from 'express';

const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization';
const DEFAULT_ALLOWED_METHODS = 'GET, POST, OPTIONS';

export function buildAllowedOrigins(publicOrigin: string | undefined): Set<string> {
  const origins = new Set<string>();
  const normalized = normalizeOrigin(publicOrigin);
  if (normalized) origins.add(normalized);
  return origins;
}

export function createCorsMiddleware(allowedOrigins: ReadonlySet<string>): RequestHandler {
  return (request, response, next) => {
    const origin = normalizeOrigin(request.headers.origin);
    if (!origin || !allowedOrigins.has(origin)) return next();

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Headers', DEFAULT_ALLOWED_HEADERS);
    response.setHeader('Access-Control-Allow-Methods', DEFAULT_ALLOWED_METHODS);
    response.vary('Origin');

    if (request.method === 'OPTIONS') return response.sendStatus(204);
    return next();
  };
}

function normalizeOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}
