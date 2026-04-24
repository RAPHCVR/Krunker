import { describe, expect, it } from 'vitest';
import { directionFromAngles, raycastPlayers, resolveArenaMovement } from './math.js';

describe('game math', () => {
  it('casts forward from yaw zero', () => {
    expect(directionFromAngles(0, 0)).toMatchObject({ x: -0, y: 0, z: -1 });
  });

  it('detects hits on alive players', () => {
    const target = { x: 0, y: 0, z: -10, yaw: 0, pitch: 0, health: 100, alive: true };
    const hit = raycastPlayers({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 0, z: -1 }, [['target', target]], 'shooter');
    expect(hit).toBe('target');
  });

  it('keeps players inside the arena', () => {
    const position = resolveArenaMovement({ x: 100, y: -10, z: -100 });
    expect(position.x).toBeLessThan(30);
    expect(position.y).toBe(0);
  });
});
