import { describe, expect, it } from 'vitest';
import { parseClientInput, parseJoinMatchOptions, parseShootMessage } from './messages.js';

describe('realtime message parsing', () => {
  it('accepts well-formed movement and shot payloads', () => {
    expect(
      parseClientInput({
        seq: 1,
        spawnSeq: 2,
        forward: 1,
        right: -0.5,
        jump: false,
        sprint: true,
        yaw: 0.4,
        pitch: -0.1,
      }),
    ).toMatchObject({ seq: 1, spawnSeq: 2, forward: 1, sprint: true });

    expect(parseShootMessage({ seq: 3, spawnSeq: 2, yaw: 0.4, pitch: -0.1 })).toMatchObject({ seq: 3, spawnSeq: 2 });
  });

  it('rejects malformed realtime payloads instead of letting handlers crash', () => {
    expect(parseClientInput(null)).toBeNull();
    expect(parseClientInput({ seq: 1, forward: 1 })).toBeNull();
    expect(parseClientInput({ seq: 1, spawnSeq: '2', forward: 1, right: 0, jump: false, sprint: false, yaw: 0, pitch: 0 })).toBeNull();
    expect(parseShootMessage(null)).toBeNull();
    expect(parseShootMessage({ seq: 1, spawnSeq: 1, yaw: Number.POSITIVE_INFINITY, pitch: 0 })).toBeNull();
  });

  it('falls back to a safe guest join option when join options are invalid', () => {
    expect(parseJoinMatchOptions({ displayName: 'Raph' })).toEqual({ displayName: 'Raph' });
    expect(parseJoinMatchOptions(null)).toEqual({ displayName: 'Guest' });
    expect(parseJoinMatchOptions({ displayName: '' })).toEqual({ displayName: 'Guest' });
  });
});
