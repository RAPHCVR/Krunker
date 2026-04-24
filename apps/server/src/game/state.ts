import { MapSchema, Schema, type } from '@colyseus/schema';
import type { MatchPhase } from '@krunker-arena/shared';

export class PlayerState extends Schema {
  @type('string') id = '';
  @type('string') name = 'Guest';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('number') yaw = 0;
  @type('number') pitch = 0;
  @type('number') inputSeq = 0;
  @type('number') spawnSeq = 0;
  @type('number') health = 100;
  @type('number') kills = 0;
  @type('number') deaths = 0;
  @type('number') ammo = 12;
  @type('boolean') alive = true;
  @type('number') respawnAt = 0;
}

export class GameState extends Schema {
  @type('string') phase: MatchPhase = 'waiting';
  @type('number') endsAt = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
  }
}
