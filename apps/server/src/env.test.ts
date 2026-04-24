import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadEnv', () => {
  it('requires PostgreSQL configuration in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = 'test-secret';

    expect(() => loadEnv()).toThrow('DATABASE_URL is required in production');
  });

  it('parses a bounded database pool size', () => {
    process.env.DATABASE_POOL_MAX = '6';

    expect(loadEnv().databasePoolMax).toBe(6);
  });

  it('rejects an unsafe database pool size', () => {
    process.env.DATABASE_POOL_MAX = '0';

    expect(() => loadEnv()).toThrow('DATABASE_POOL_MAX must be an integer between 1 and 20');
  });
});
