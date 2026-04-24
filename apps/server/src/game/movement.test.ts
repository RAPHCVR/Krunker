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

  it('converges after sustained jitter while circling obstacles like real players', () => {
    const random = mulberry32(13);
    const spawn = { x: -22, y: MAP.spawnY, z: -24 };
    const inputs = Array.from({ length: 720 }, (_, tick): ClientInput => {
      const yaw = Math.PI + Math.sin(tick / 44) * 1.15 + (random() - 0.5) * 0.03;
      return {
        seq: tick + 1,
        forward: tick % 170 < 130 ? 1 : -0.45,
        right: Math.sin(tick / 19) * 0.95,
        jump: tick % 113 === 18 || tick % 211 === 45,
        sprint: tick % 160 < 80,
        yaw,
        pitch: Math.sin(tick / 70) * 0.12,
      };
    });

    let predicted = createMovementState(spawn, Math.PI);
    for (const input of inputs) predicted = step(predicted, input);

    let lastArrivalTick = 0;
    const arrivals = inputs.map((input, index) => {
      lastArrivalTick = Math.max(lastArrivalTick, index + jitterDelay(index, random));
      return { atTick: lastArrivalTick, input };
    });
    let nextArrival = 0;
    const queue: ClientInput[] = [];
    let authoritative = createMovementState(spawn, Math.PI);
    let latestInput: ClientInput = { seq: 0, forward: 0, right: 0, jump: false, sprint: false, yaw: Math.PI, pitch: 0 };
    let inputSeq = 0;
    let maxQueueLength = 0;

    for (let serverTick = 0; serverTick < inputs.length + 180; serverTick += 1) {
      while (true) {
        const arrival = arrivals[nextArrival];
        if (!arrival || arrival.atTick > serverTick) break;
        queue.push(arrival.input);
        nextArrival += 1;
      }
      maxQueueLength = Math.max(maxQueueLength, queue.length);
      const result = applyQueuedHumanInputs(authoritative, queue, latestInput, inputSeq);
      authoritative = result.movement;
      latestInput = result.latestInput;
      inputSeq = result.inputSeq;
      expect(isInsideAnyObstacle(authoritative), `serverTick=${serverTick} seq=${inputSeq}`).toBe(false);
      if (inputSeq === inputs.at(-1)!.seq && queue.length === 0) break;
    }

    expect(inputSeq).toBe(inputs.at(-1)!.seq);
    expect(maxQueueLength).toBeLessThanOrEqual(GAMEPLAY.tickRate * 2);
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

function jitterDelay(index: number, random: () => number): number {
  if (index % 157 === 0) return 18;
  if (index % 53 === 0) return 9;
  return Math.floor(random() * 5);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed += 0x6d2b79f5;
    let next = seed;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
