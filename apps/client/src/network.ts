import { Client, Room } from 'colyseus.js';
import type { ClientInput, ServerEvent, ShootMessage } from '@krunker-arena/shared';

export type PlayerSnapshot = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  inputSeq: number;
  spawnSeq: number;
  health: number;
  kills: number;
  deaths: number;
  ammo: number;
  alive: boolean;
  isBot: boolean;
};

export type NetworkHandlers = {
  onPlayers: (players: PlayerSnapshot[], sessionId: string) => void;
  onEvent: (event: ServerEvent) => void;
};

export class GameNetwork {
  private room: Room | null = null;

  constructor(private readonly handlers: NetworkHandlers) {}

  async connect(displayName: string): Promise<void> {
    const client = new Client(realtimeEndpoint());
    this.room = await client.joinOrCreate('deathmatch', { displayName });
    this.room.onStateChange((state: any) => {
      const players: PlayerSnapshot[] = [];
      state.players.forEach((player: any, id: string) => players.push({
        id,
        name: player.name,
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        pitch: player.pitch,
        inputSeq: player.inputSeq ?? 0,
        spawnSeq: player.spawnSeq ?? 0,
        health: player.health,
        kills: player.kills,
        deaths: player.deaths,
        ammo: player.ammo,
        alive: player.alive,
        isBot: player.isBot === true,
      }));
      this.handlers.onPlayers(players, this.room!.sessionId);
    });
    this.room.onMessage('serverEvent', (event) => this.handlers.onEvent(event));
  }

  sendInput(input: ClientInput): void {
    this.room?.send('input', input);
  }

  shoot(message: ShootMessage): void {
    this.room?.send('shoot', message);
  }

  reload(): void {
    this.room?.send('reload');
  }

  debugKill(): void {
    this.room?.send('debugKill');
  }
}

function realtimeEndpoint(): string {
  const configuredEndpoint = import.meta.env.VITE_REALTIME_URL?.trim();
  if (configuredEndpoint) return normalizeRealtimeEndpoint(configuredEndpoint);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/realtime`;
}

function normalizeRealtimeEndpoint(endpoint: string): string {
  const url = new URL(endpoint, window.location.href);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported realtime endpoint protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/$/, '');
}
