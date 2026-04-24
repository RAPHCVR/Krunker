export type Env = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl?: string | undefined;
  databasePoolMax: number;
  sessionSecret: string;
  publicOrigin?: string | undefined;
};

export function loadEnv(): Env {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const sessionSecret = process.env.SESSION_SECRET ?? (nodeEnv === 'production' ? '' : 'dev-secret-change-me');
  const databaseUrl = process.env.DATABASE_URL;
  const databasePoolMax = readIntegerEnv('DATABASE_POOL_MAX', 4, 1, 20);

  if (nodeEnv === 'production') {
    if (!sessionSecret) throw new Error('SESSION_SECRET is required in production');
    if (!databaseUrl) throw new Error('DATABASE_URL is required in production');
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 2567),
    databaseUrl,
    databasePoolMax,
    sessionSecret,
    publicOrigin: process.env.PUBLIC_ORIGIN,
  };
}

function readIntegerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}
