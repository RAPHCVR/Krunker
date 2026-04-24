import { GAMEPLAY, MAP } from './constants.js';
import type { ClientInput, Vector3Like } from './types.js';
import { clamp } from './utils.js';

const SKIN = 0.001;

type ArenaBox = (typeof MAP.boxes)[number];

export type MovementState = Vector3Like & {
  yaw: number;
  pitch: number;
  verticalVelocity: number;
  grounded: boolean;
};

export type MovementResult = {
  state: MovementState;
  collided: boolean;
};

export function createMovementState(position: Vector3Like, yaw = 0, pitch = 0): MovementState {
  return {
    x: position.x,
    y: Math.max(MAP.floorY, position.y),
    z: position.z,
    yaw,
    pitch,
    verticalVelocity: 0,
    grounded: true,
  };
}

export function replayMovement(state: MovementState, inputs: readonly ClientInput[], deltaSeconds = 1 / GAMEPLAY.tickRate): MovementState {
  return inputs.reduce((nextState, input) => simulateMovement(nextState, input, deltaSeconds).state, state);
}

export function simulateMovement(state: MovementState, input: ClientInput, deltaSeconds = 1 / GAMEPLAY.tickRate): MovementResult {
  const yaw = normalizeYaw(finite(input.yaw, state.yaw));
  const pitch = clamp(finite(input.pitch, state.pitch), -1.35, 1.35);
  const forward = clamp(finite(input.forward, 0), -1, 1);
  const right = clamp(finite(input.right, 0), -1, 1);
  const inputLength = Math.hypot(forward, right) || 1;
  const speed = GAMEPLAY.moveSpeed * (input.sprint === true ? GAMEPLAY.sprintMultiplier : 1);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  let verticalVelocity = finite(state.verticalVelocity, 0);

  if (input.jump === true && state.grounded && verticalVelocity <= 0.1) verticalVelocity = GAMEPLAY.jumpVelocity;
  verticalVelocity += GAMEPLAY.gravity * deltaSeconds;

  const requested = {
    x: state.x + ((forwardX * forward + rightX * right) / inputLength) * speed * deltaSeconds,
    y: state.y + verticalVelocity * deltaSeconds,
    z: state.z + ((forwardZ * forward + rightZ * right) / inputLength) * speed * deltaSeconds,
  };
  const resolution = resolveArenaCollision(state, requested);
  if (resolution.grounded) verticalVelocity = 0;

  return {
    collided: resolution.collided,
    state: {
      ...resolution.position,
      yaw,
      pitch,
      verticalVelocity,
      grounded: resolution.grounded,
    },
  };
}

export function resolveArenaCollision(previous: Vector3Like, requested: Vector3Like): { position: Vector3Like; grounded: boolean; collided: boolean } {
  const halfSize = MAP.size / 2 - GAMEPLAY.playerRadius;
  const previousPosition = {
    x: clamp(finite(previous.x, 0), -halfSize, halfSize),
    y: Math.max(MAP.floorY, finite(previous.y, MAP.floorY)),
    z: clamp(finite(previous.z, 0), -halfSize, halfSize),
  };
  const horizontalFeetY = Math.max(previousPosition.y, finite(requested.y, previousPosition.y));
  const position = { ...previousPosition, y: horizontalFeetY };
  let grounded = false;
  let collided = false;

  const requestedX = clamp(finite(requested.x, position.x), -halfSize, halfSize);
  if (requestedX !== requested.x) collided = true;
  position.x = resolveHorizontalAxis(previousPosition, { ...position, x: requestedX }, 'x');
  collided ||= position.x !== requestedX;

  const requestedZ = clamp(finite(requested.z, position.z), -halfSize, halfSize);
  if (requestedZ !== requested.z) collided = true;
  position.z = resolveHorizontalAxis(previousPosition, { ...position, z: requestedZ }, 'z');
  collided ||= position.z !== requestedZ;

  let requestedY = finite(requested.y, position.y);
  if (requestedY <= MAP.floorY) {
    requestedY = MAP.floorY;
    grounded = true;
    collided ||= requested.y !== requestedY;
  }
  position.y = requestedY;

  for (const box of MAP.boxes) {
    if (!overlapsXZ(position, box)) continue;
    const bounds = boxBounds(box);
    const previousFeet = previousPosition.y;
    const movingDown = requestedY <= previousFeet;
    const canLandOnTop = movingDown && previousFeet + SKIN >= bounds.top && requestedY <= bounds.top + SKIN;

    if (canLandOnTop) {
      position.y = bounds.top;
      grounded = true;
      collided = true;
      continue;
    }

    if (overlapsVertical(position.y, bounds.bottom, bounds.top)) {
      const pushX = bounds.halfX + GAMEPLAY.playerRadius - Math.abs(position.x - box.x);
      const pushZ = bounds.halfZ + GAMEPLAY.playerRadius - Math.abs(position.z - box.z);
      if (pushX < pushZ) position.x += Math.sign(position.x - box.x || previousPosition.x - box.x || 1) * pushX;
      else position.z += Math.sign(position.z - box.z || previousPosition.z - box.z || 1) * pushZ;
      collided = true;
    }
  }

  return { position, grounded, collided };
}

export function makeNeutralInput(seq = 0, yaw = 0, pitch = 0): ClientInput {
  return {
    seq,
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    yaw,
    pitch,
  };
}

function resolveHorizontalAxis(previous: Vector3Like, candidate: Vector3Like, axis: 'x' | 'z'): number {
  let value = candidate[axis];
  for (const box of MAP.boxes) {
    const position = { ...candidate, [axis]: value };
    if (!overlapsXZ(position, box)) continue;
    const bounds = boxBounds(box);
    if (!overlapsVertical(position.y, bounds.bottom, bounds.top)) continue;

    if (axis === 'x') {
      value = previous.x <= box.x ? bounds.left - GAMEPLAY.playerRadius - SKIN : bounds.right + GAMEPLAY.playerRadius + SKIN;
    } else {
      value = previous.z <= box.z ? bounds.back - GAMEPLAY.playerRadius - SKIN : bounds.front + GAMEPLAY.playerRadius + SKIN;
    }
  }
  return value;
}

function overlapsXZ(position: Vector3Like, box: ArenaBox): boolean {
  const bounds = boxBounds(box);
  return Math.abs(position.x - box.x) < bounds.halfX + GAMEPLAY.playerRadius && Math.abs(position.z - box.z) < bounds.halfZ + GAMEPLAY.playerRadius;
}

function overlapsVertical(feetY: number, bottom: number, top: number): boolean {
  return feetY < top - SKIN && feetY + GAMEPLAY.playerHeight > bottom + SKIN;
}

function boxBounds(box: ArenaBox): { bottom: number; top: number; halfX: number; halfZ: number; left: number; right: number; back: number; front: number } {
  const halfX = box.sx / 2;
  const halfZ = box.sz / 2;
  return {
    bottom: box.y - box.sy / 2,
    top: box.y + box.sy / 2,
    halfX,
    halfZ,
    left: box.x - halfX,
    right: box.x + halfX,
    back: box.z - halfZ,
    front: box.z + halfZ,
  };
}

function normalizeYaw(value: number): number {
  const tau = Math.PI * 2;
  return ((((value + Math.PI) % tau) + tau) % tau) - Math.PI;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
