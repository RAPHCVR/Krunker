export type Env = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl?: string | undefined;
  sessionSecret: string;
  publicOrigin?: string | undefined;
};

export function loadEnv(): Env {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const sessionSecret = process.env.SESSION_SECRET ?? (nodeEnv === 'production' ? '' : 'dev-secret-change-me');
  const databaseUrl = process.env.DATABASE_URL;

  if (nodeEnv === 'production') {
    if (!sessionSecret) throw new Error('SESSION_SECRET is required in production');
    if (!databaseUrl) throw new Error('DATABASE_URL is required in production');
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 2567),
    databaseUrl,
    sessionSecret,
    publicOrigin: process.env.PUBLIC_ORIGIN,
  };
}
