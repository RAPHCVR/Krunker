import { GAMEPLAY, MAP, resolveArenaCollision, type Vector3Like } from '@krunker-arena/shared';

export type MutablePlayer = Vector3Like & {
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
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
  let bestTarget: string | null = null;
  let bestDistance: number = GAMEPLAY.weaponRange;

  for (const [playerId, player] of players) {
    if (playerId === shooterId || !player.alive) continue;
    const target = { x: player.x, y: player.y + GAMEPLAY.playerHeight / 2, z: player.z };
    const toTarget = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    const projected = toTarget.x * direction.x + toTarget.y * direction.y + toTarget.z * direction.z;
    if (projected <= 0 || projected > bestDistance) continue;

    const closest = { x: origin.x + direction.x * projected, y: origin.y + direction.y * projected, z: origin.z + direction.z * projected };
    const distanceSquared = squaredDistance(closest, target);
    if (distanceSquared <= GAMEPLAY.playerRadius * GAMEPLAY.playerRadius) {
      bestDistance = projected;
      bestTarget = playerId;
    }
  }

  return bestTarget;
}

function squaredDistance(left: Vector3Like, right: Vector3Like): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2;
}
