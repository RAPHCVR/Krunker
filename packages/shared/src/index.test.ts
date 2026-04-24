import { describe, expect, it } from 'vitest';
import { clamp, sanitizeDisplayName } from './index.js';

describe('shared utilities', () => {
  it('clamps numbers', () => {
    expect(clamp(10, 0, 5)).toBe(5);
    expect(clamp(-1, 0, 5)).toBe(0);
  });

  it('sanitizes display names', () => {
    expect(sanitizeDisplayName('<Raph!>')).toBe('Raph');
    expect(sanitizeDisplayName('')).toBe('Guest');
  });
});
