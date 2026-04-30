import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@krunker-arena/shared';
import { directionFromAngles, raycastPlayerHit, raycastPlayers, resolveArenaMovement } from './math.js';

describe('game math', () => {
  it('casts forward from yaw zero', () => {
    expect(directionFromAngles(0, 0)).toMatchObject({ x: -0, y: 0, z: -1 });
  });

  it('detects hits on alive players', () => {
    const target = { x: 0, y: 0, z: -10, yaw: 0, pitch: 0, health: 100, alive: true };
    const hit = raycastPlayers({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 0, z: -1 }, [['target', target]], 'shooter');
    expect(hit).toBe('target');
  });

  it('uses the full vertical capsule hitbox, not a center sphere', () => {
    const target = { x: 0, y: 0, z: -10, yaw: 0, pitch: 0, health: 100, alive: true };
    const headHit = raycastPlayerHit({ x: 0, y: GAMEPLAY.playerHeight - 0.05, z: 0 }, { x: 0, y: 0, z: -4 }, [['target', target]], 'shooter');
    const torsoEdgeHit = raycastPlayerHit(
      { x: GAMEPLAY.playerRadius - 0.01, y: GAMEPLAY.playerHeight / 2, z: 0 },
      { x: 0, y: 0, z: -1 },
      [['target', target]],
      'shooter',
    );

    expect(headHit?.playerId).toBe('target');
    expect(torsoEdgeHit?.playerId).toBe('target');
  });

  it('rejects shots just outside capsule radius or player height', () => {
    const target = { x: 0, y: 0, z: -10, yaw: 0, pitch: 0, health: 100, alive: true };
    const sideMiss = raycastPlayers(
      { x: GAMEPLAY.playerRadius + 0.03, y: GAMEPLAY.eyeHeight, z: 0 },
      { x: 0, y: 0, z: -1 },
      [['target', target]],
      'shooter',
    );
    const heightMiss = raycastPlayers({ x: 0, y: GAMEPLAY.playerHeight + 0.08, z: 0 }, { x: 0, y: 0, z: -1 }, [['target', target]], 'shooter');

    expect(sideMiss).toBeNull();
    expect(heightMiss).toBeNull();
  });

  it('selects the nearest valid capsule hit and ignores shooter/dead players', () => {
    const shooter = { x: 0, y: 0, z: -4, yaw: 0, pitch: 0, health: 100, alive: true };
    const dead = { x: 0, y: 0, z: -8, yaw: 0, pitch: 0, health: 0, alive: false };
    const near = { x: 0, y: 0, z: -12, yaw: 0, pitch: 0, health: 100, alive: true };
    const far = { x: 0, y: 0, z: -20, yaw: 0, pitch: 0, health: 100, alive: true };
    const hit = raycastPlayerHit(
      { x: 0, y: GAMEPLAY.eyeHeight, z: 0 },
      { x: 0, y: 0, z: -2 },
      [
        ['shooter', shooter],
        ['dead', dead],
        ['far', far],
        ['near', near],
      ],
      'shooter',
    );

    expect(hit?.playerId).toBe('near');
    expect(hit?.distance).toBeLessThan(12);
  });

  it('keeps players inside the arena', () => {
    const position = resolveArenaMovement({ x: 100, y: -10, z: -100 });
    expect(position.x).toBeLessThan(30);
    expect(position.y).toBe(0);
  });
});
