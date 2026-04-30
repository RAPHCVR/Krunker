import { GAMEPLAY, MAP, resolveArenaCollision, type Vector3Like } from '@krunker-arena/shared';

export type MutablePlayer = Vector3Like & {
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
};

export type RaycastHit = {
  playerId: string;
  distance: number;
  point: Vector3Like;
};

export function directionFromAngles(yaw: number, pitch: number): Vector3Like {
  const pitchCos = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * pitchCos,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * pitchCos,
  };
}

export function findSpawn(index: number): { x: number; y: number; z: number; yaw: number } {
  return MAP.spawnPoints[index % MAP.spawnPoints.length] ?? MAP.spawnPoints[0];
}

export function resolveArenaMovement(position: Vector3Like): Vector3Like {
  return resolveArenaCollision(position, position).position;
}

export function raycastPlayers(origin: Vector3Like, direction: Vector3Like, players: Iterable<[string, MutablePlayer]>, shooterId: string): string | null {
  return raycastPlayerHit(origin, direction, players, shooterId)?.playerId ?? null;
}

export function raycastPlayerHit(origin: Vector3Like, direction: Vector3Like, players: Iterable<[string, MutablePlayer]>, shooterId: string): RaycastHit | null {
  const normalizedDirection = normalize(direction);
  let bestHit: RaycastHit | null = null;
  let bestDistance: number = GAMEPLAY.weaponRange;

  for (const [playerId, player] of players) {
    if (playerId === shooterId || !player.alive) continue;
    const distance = intersectVerticalCapsule(origin, normalizedDirection, player);
    if (distance === null || distance > bestDistance) continue;

    bestDistance = distance;
    bestHit = {
      playerId,
      distance,
      point: {
        x: origin.x + normalizedDirection.x * distance,
        y: origin.y + normalizedDirection.y * distance,
        z: origin.z + normalizedDirection.z * distance,
      },
    };
  }

  return bestHit;
}

function intersectVerticalCapsule(origin: Vector3Like, direction: Vector3Like, player: MutablePlayer): number | null {
  const radius = GAMEPLAY.playerRadius;
  const bottomCenter = { x: player.x, y: player.y + radius, z: player.z };
  const topCenter = { x: player.x, y: player.y + GAMEPLAY.playerHeight - radius, z: player.z };
  const hits = [
    intersectVerticalCylinder(origin, direction, bottomCenter.y, topCenter.y, player.x, player.z, radius),
    intersectSphere(origin, direction, bottomCenter, radius),
    intersectSphere(origin, direction, topCenter, radius),
  ].filter((distance): distance is number => distance !== null && distance >= 0 && distance <= GAMEPLAY.weaponRange);

  return hits.length > 0 ? Math.min(...hits) : null;
}

function intersectVerticalCylinder(
  origin: Vector3Like,
  direction: Vector3Like,
  minY: number,
  maxY: number,
  centerX: number,
  centerZ: number,
  radius: number,
): number | null {
  const offsetX = origin.x - centerX;
  const offsetZ = origin.z - centerZ;
  const a = direction.x ** 2 + direction.z ** 2;
  if (a < 1e-8) return null;

  const b = 2 * (offsetX * direction.x + offsetZ * direction.z);
  const c = offsetX ** 2 + offsetZ ** 2 - radius ** 2;
  const discriminant = b ** 2 - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrt = Math.sqrt(discriminant);
  for (const distance of [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)]) {
    if (distance < 0) continue;
    const y = origin.y + direction.y * distance;
    if (y >= minY && y <= maxY) return distance;
  }
  return null;
}

function intersectSphere(origin: Vector3Like, direction: Vector3Like, center: Vector3Like, radius: number): number | null {
  const offset = { x: origin.x - center.x, y: origin.y - center.y, z: origin.z - center.z };
  const b = 2 * dot(offset, direction);
  const c = dot(offset, offset) - radius ** 2;
  const discriminant = b ** 2 - 4 * c;
  if (discriminant < 0) return null;

  const sqrt = Math.sqrt(discriminant);
  for (const distance of [(-b - sqrt) / 2, (-b + sqrt) / 2]) {
    if (distance >= 0) return distance;
  }
  return null;
}

function normalize(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= 1e-8) return { x: 0, y: 0, z: -1 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot(left: Vector3Like, right: Vector3Like): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}
