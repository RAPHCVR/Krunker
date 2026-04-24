import { Client, Room } from 'colyseus.js';
import type { ClientInput, ShootMessage } from '@krunker-arena/shared';

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
};

export type NetworkHandlers = {
  onPlayers: (players: PlayerSnapshot[], sessionId: string) => void;
  onEvent: (event: { type: string; message?: string; killerId?: string; victimId?: string }) => void;
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
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/realtime`;
}
