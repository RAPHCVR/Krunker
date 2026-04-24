import { describe, expect, it } from 'vitest';
import { GAMEPLAY, MAP, createMovementState, simulateMovement, type ClientInput, type MovementState } from '@krunker-arena/shared';
import { applyQueuedHumanInputs } from './inputQueue.js';

function step(state: MovementState, input: ClientInput): MovementState {
  return simulateMovement(state, input).state;
}

describe('movement regression', () => {
  it('does not climb low obstacles without jumping', () => {
    let state = createMovementState({ x: -10, y: MAP.spawnY, z: -16 }, Math.PI);
    for (let tick = 0; tick < 70; tick += 1) state = step(state, { seq: tick, forward: 1, right: 0, jump: false, sprint: true, yaw: Math.PI, pitch: 0 });
    expect(state.y).toBe(MAP.spawnY);
    expect(state.z).toBeLessThan(-12.9);
  });

  it('can jump and land on reachable blocks', () => {
    let state = createMovementState({ x: -10, y: MAP.spawnY, z: -16 }, Math.PI);
    for (let tick = 0; tick < 100; tick += 1) {
      state = step(state, { seq: tick, forward: tick < 20 ? 1 : 0, right: 0, jump: tick === 0, sprint: false, yaw: Math.PI, pitch: 0 });
    }
    expect(state.y).toBeCloseTo(0.9, 3);
  });

  it('returns smoothly after forward then backward movement', () => {
    let state = createMovementState({ x: -22, y: MAP.spawnY, z: -24 }, Math.PI);
    const start = { x: state.x, z: state.z };
    for (let tick = 0; tick < 30; tick += 1) state = step(state, { seq: tick, forward: 1, right: 0, jump: false, sprint: false, yaw: Math.PI, pitch: 0 });
    for (let tick = 30; tick < 60; tick += 1) state = step(state, { seq: tick, forward: -1, right: 0, jump: false, sprint: false, yaw: Math.PI, pitch: 0 });
    expect(Math.hypot(state.x - start.x, state.z - start.z)).toBeLessThan(0.35);
  });

  it('keeps client and server prediction paths deterministic', () => {
    let client = createMovementState({ x: 4, y: MAP.spawnY, z: 22 }, -Math.PI / 2);
    let server = createMovementState({ x: 4, y: MAP.spawnY, z: 22 }, -Math.PI / 2);
    for (let tick = 0; tick < 120; tick += 1) {
      const input = {
        seq: tick,
        forward: tick < 60 ? 1 : -1,
        right: Math.sin(tick / 8),
        jump: tick === 15,
        sprint: tick < 25,
        yaw: -Math.PI / 2 + tick * 0.004,
        pitch: Math.sin(tick / 20) * 0.1,
      };
      client = simulateMovement(client, input).state;
      server = simulateMovement(server, input).state;
    }

    expect(Math.hypot(client.x - server.x, client.y - server.y, client.z - server.z)).toBe(0);
  });

  it('does not end a movement sequence inside obstacle volumes', () => {
    let state = createMovementState({ x: 6, y: MAP.spawnY, z: -20 }, -Math.PI / 4);
    for (let tick = 0; tick < 180; tick += 1) {
      state = step(state, {
        seq: tick,
        forward: 1,
        right: Math.sin(tick / 12),
        jump: tick === 20 || tick === 100,
        sprint: tick < 120,
        yaw: -Math.PI / 4 + Math.sin(tick / 30) * 0.6,
        pitch: 0,
      });
    }
    expect(isInsideAnyObstacle(state)).toBe(false);
  });

  it('does not advance authoritative physics without an acknowledged input', () => {
    const jumpInput = { seq: 1, forward: 1, right: 0, jump: true, sprint: true, yaw: 0, pitch: 0 };
    const movement = simulateMovement(createMovementState({ x: 0, y: MAP.spawnY, z: -24 }, 0), jumpInput).state;
    const result = applyQueuedHumanInputs(movement, [], jumpInput, jumpInput.seq);

    expect(result.appliedCommands).toBe(0);
    expect(result.inputSeq).toBe(jumpInput.seq);
    expect(result.movement).toEqual(movement);
  });

  it('keeps delayed backlog replay deterministic after a network jitter gap', () => {
    const spawn = { x: 0, y: MAP.spawnY, z: -24 };
    const firstInput: ClientInput = { seq: 1, forward: 1, right: 0, jump: true, sprint: true, yaw: 0, pitch: 0 };
    const delayedInputs = Array.from({ length: 30 }, (_, index): ClientInput => ({
      seq: index + 2,
      forward: index < 12 ? 1 : -0.65,
      right: Math.sin(index / 5) * 0.7,
      jump: false,
      sprint: index < 18,
      yaw: Math.sin(index / 15) * 0.4,
      pitch: 0,
    }));
    let predicted = simulateMovement(createMovementState(spawn, 0), firstInput).state;
    for (const input of delayedInputs) predicted = simulateMovement(predicted, input).state;

    let authoritative = simulateMovement(createMovementState(spawn, 0), firstInput).state;
    let latestInput = firstInput;
    let inputSeq = firstInput.seq;
    const emptyGap = applyQueuedHumanInputs(authoritative, [], latestInput, inputSeq);
    authoritative = emptyGap.movement;
    latestInput = emptyGap.latestInput;
    inputSeq = emptyGap.inputSeq;

    const queue = [...delayedInputs];
    while (queue.length > 0) {
      const result = applyQueuedHumanInputs(authoritative, queue, latestInput, inputSeq);
      authoritative = result.movement;
      latestInput = result.latestInput;
      inputSeq = result.inputSeq;
    }

    expect(inputSeq).toBe(delayedInputs.at(-1)!.seq);
    expect(Math.hypot(authoritative.x - predicted.x, authoritative.y - predicted.y, authoritative.z - predicted.z)).toBeLessThan(1e-9);
  });
});

function isInsideAnyObstacle(state: MovementState): boolean {
  return MAP.boxes.some((box) => {
    const halfX = box.sx / 2 + GAMEPLAY.playerRadius;
    const halfZ = box.sz / 2 + GAMEPLAY.playerRadius;
    const bottom = box.y - box.sy / 2;
    const top = box.y + box.sy / 2;
    const overlapsXZ = Math.abs(state.x - box.x) < halfX && Math.abs(state.z - box.z) < halfZ;
    const overlapsY = state.y < top - 0.001 && state.y + GAMEPLAY.playerHeight > bottom + 0.001;
    return overlapsXZ && overlapsY;
  });
}
