import { describe, expect, it } from 'vitest';
import { GAMEPLAY, MAP, type ClientInput, type MovementState, createMovementState, replayMovement, simulateMovement } from './index.js';

describe('movement fuzz regression', () => {
  it('keeps randomized movement outside obstacle volumes', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = mulberry32(seed);
      const spawn = MAP.spawnPoints[seed % MAP.spawnPoints.length] ?? MAP.spawnPoints[0];
      let state = createMovementState(spawn, spawn.yaw);
      let yaw = spawn.yaw;

      for (let tick = 0; tick < 360; tick += 1) {
        yaw += (random() - 0.5) * 0.22;
        const input = makeFuzzInput(tick, random, yaw);
        state = simulateMovement(state, input).state;
        expect(isInsideAnyObstacle(state), `seed=${seed} tick=${tick} state=${JSON.stringify(state)}`).toBe(false);
      }
    }
  });

  it('replays pending inputs exactly from an authoritative snapshot', () => {
    const inputs = buildInputSequence(240);
    let predicted = createMovementState({ x: 4, y: MAP.spawnY, z: 22 }, -Math.PI / 2);
    const authoritativeHistory: MovementState[] = [predicted];

    for (const input of inputs) {
      predicted = simulateMovement(predicted, input).state;
      authoritativeHistory.push(predicted);
    }

    for (let ackIndex = 0; ackIndex < inputs.length; ackIndex += 17) {
      const authoritative = authoritativeHistory[ackIndex]!;
      const replayed = replayMovement(authoritative, inputs.slice(ackIndex));
      expect(distance(replayed, predicted), `ackIndex=${ackIndex}`).toBeLessThan(1e-9);
    }
  });
});

function makeFuzzInput(seq: number, random: () => number, yaw: number): ClientInput {
  return {
    seq,
    forward: random() < 0.12 ? 0 : random() * 2 - 1,
    right: random() < 0.18 ? 0 : random() * 2 - 1,
    jump: random() < 0.035,
    sprint: random() < 0.35,
    yaw,
    pitch: (random() - 0.5) * 0.5,
  };
}

function buildInputSequence(length: number): ClientInput[] {
  const inputs: ClientInput[] = [];
  for (let tick = 0; tick < length; tick += 1) {
    inputs.push({
      seq: tick + 1,
      forward: tick < 90 ? 1 : tick < 160 ? -0.6 : 0.25,
      right: Math.sin(tick / 11),
      jump: tick === 16 || tick === 110,
      sprint: tick % 80 < 35,
      yaw: -Math.PI / 2 + Math.sin(tick / 25) * 0.7,
      pitch: Math.sin(tick / 31) * 0.18,
    });
  }
  return inputs;
}

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

function distance(left: MovementState, right: MovementState): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
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
