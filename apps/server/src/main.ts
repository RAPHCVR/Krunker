import http from 'node:http';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { z } from 'zod';
import { createAuthRouter } from './auth.js';
import { MemoryUserStore, PostgresUserStore, type UserStore } from './db.js';
import { loadEnv } from './env.js';
import { DeathmatchRoom } from './game/DeathmatchRoom.js';

const env = loadEnv();
const app = express();
const httpServer = http.createServer(app);
const store: UserStore = env.databaseUrl ? new PostgresUserStore(env.databaseUrl) : new MemoryUserStore();

await store.migrate();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.get('/healthz', (_request, response) => response.json({ ok: true }));
app.get('/readyz', (_request, response) => response.json({ ok: true }));
app.use('/api', createAuthRouter(store, env.sessionSecret, env.nodeEnv === 'production'));

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'BAD_REQUEST', issues: error.issues });
  console.error(JSON.stringify({ level: 'error', message: error instanceof Error ? error.message : String(error) }));
  return response.status(500).json({ error: 'INTERNAL_ERROR' });
};
app.use(errorHandler);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer, pingInterval: 10_000, pingMaxRetries: 4, maxPayload: 1024 * 32 }),
});
gameServer.define('deathmatch', DeathmatchRoom);

await gameServer.listen(env.port, env.host, undefined, () => {
  console.log(JSON.stringify({ level: 'info', message: 'server_started', host: env.host, port: env.port }));
});

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ level: 'info', message: 'shutdown_started', signal }));
  await gameServer.gracefullyShutdown(false);
  await store.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8_000).unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
