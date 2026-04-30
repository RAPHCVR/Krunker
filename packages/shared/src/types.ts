export type Vector3Like = { x: number; y: number; z: number };

export type ClientInput = {
  seq: number;
  spawnSeq?: number;
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
};

export type ShootMessage = {
  seq: number;
  spawnSeq?: number;
  yaw: number;
  pitch: number;
};

export type JoinMatchOptions = {
  displayName: string;
};

export type ServerEvent =
  | { type: 'shot'; shooterId: string; origin: Vector3Like; end: Vector3Like; hitId?: string }
  | { type: 'hit'; shooterId: string; targetId: string; damage: number; health: number }
  | { type: 'kill'; killerId: string; victimId: string }
  | { type: 'system'; message: string };

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

export type AuthResponse = {
  user: AuthUser;
};

export type MatchPhase = 'waiting' | 'playing' | 'ended';
