import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth.js';
import { MemoryUserStore } from './db.js';

function testApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', createAuthRouter(new MemoryUserStore(), 'test-secret', false));
  return app;
}

describe('auth routes', () => {
  it('registers, sets a cookie, and returns the current user', async () => {
    const app = testApp();
    const register = await request(app).post('/api/auth/register').send({ username: 'raphcvr', password: 'password123', displayName: 'Raph' });
    expect(register.status).toBe(201);
    expect(register.body.user.username).toBe('raphcvr');
    expect(register.headers['set-cookie']?.[0]).toContain('krunker_session');

    const cookies = register.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const me = await request(app).get('/api/me').set('Cookie', cookies as unknown as string[]);
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe('Raph');
  });

  it('rejects bad credentials', async () => {
    const app = testApp();
    const response = await request(app).post('/api/auth/login').send({ username: 'missing', password: 'password123' });
    expect(response.status).toBe(401);
  });
});
