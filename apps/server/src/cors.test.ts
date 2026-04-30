import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins, createCorsMiddleware } from './cors.js';

describe('CORS middleware', () => {
  it('allows the configured public origin for cross-origin matchmaking', async () => {
    const app = express();
    app.use(createCorsMiddleware(buildAllowedOrigins('https://krunker.raphcvr.me/game')));
    app.get('/matchmake', (_request, response) => response.json({ ok: true }));

    const response = await request(app).get('/matchmake').set('Origin', 'https://krunker.raphcvr.me');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://krunker.raphcvr.me');
    expect(response.headers['vary']).toContain('Origin');
  });

  it('answers preflight only for trusted origins', async () => {
    const app = express();
    app.use(createCorsMiddleware(buildAllowedOrigins('https://krunker.raphcvr.me')));

    const allowed = await request(app).options('/matchmake').set('Origin', 'https://krunker.raphcvr.me');
    const blocked = await request(app).options('/matchmake').set('Origin', 'https://evil.example');

    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://krunker.raphcvr.me');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
