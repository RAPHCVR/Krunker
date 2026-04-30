import { Client, Room } from '@colyseus/core';
import {
  GAMEPLAY,
  clamp,
  createMovementState,
  makeNeutralInput,
  sanitizeDisplayName,
  simulateMovement,
  type ClientInput,
  type JoinMatchOptions,
  type MovementState,
  type ShootMessage,
  type ServerEvent,
} from '@krunker-arena/shared';
import { GameState, PlayerState } from './state.js';
import { directionFromAngles, findSpawn, raycastPlayerHit } from './math.js';
import { applyQueuedHumanInputs } from './inputQueue.js';
import { parseClientInput, parseJoinMatchOptions, parseShootMessage } from './messages.js';

type PlayerRuntime = {
  bot: boolean;
  movement: MovementState;
  lastInputAt: number;
  inputCount: number;
  lastShotAt: number;
  reloadingUntil: number;
  botTarget: string | undefined;
  botNextThinkAt: number;
  latestInput: ClientInput;
  inputQueue: ClientInput[];
};

export class DeathmatchRoom extends Room<GameState> {
  maxClients = GAMEPLAY.maxPlayers;
  private readonly runtime = new Map<string, PlayerRuntime>();

  onCreate(): void {
    this.setState(new GameState());
    this.state.phase = 'playing';
    this.state.endsAt = Date.now() + GAMEPLAY.matchSeconds * 1000;
    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 1000 / GAMEPLAY.tickRate);
    this.setPatchRate(1000 / GAMEPLAY.tickRate);

    this.onMessage('joinMatch', (client, payload) => this.handleJoinMatch(client, payload));
    this.onMessage('input', (client, payload) => this.handleInput(client, payload));
    this.onMessage('shoot', (client, payload) => this.handleShoot(client, payload));
    this.onMessage('reload', (client) => this.handleReload(client));
    if (process.env.ENABLE_DEBUG_CHEATS === 'true') this.onMessage('debugKill', (client) => this.handleDebugKill(client));

    for (let botIndex = 0; botIndex < 4; botIndex += 1) this.addBot(botIndex);
  }

  onJoin(client: Client, options: Partial<JoinMatchOptions>): void {
    const joinOptions = parseJoinMatchOptions(options);
    const player = new PlayerState();
    const spawn = findSpawn(this.state.players.size);
    player.id = client.sessionId;
    player.name = sanitizeDisplayName(joinOptions.displayName);
    player.isBot = false;
    player.health = GAMEPLAY.maxHealth;
    player.ammo = GAMEPLAY.magazineSize;
    player.spawnSeq = 1;
    const runtime = this.createRuntime(false, spawn);
    this.syncPlayerMovement(player, runtime.movement, 0);
    this.state.players.set(client.sessionId, player);
    this.runtime.set(client.sessionId, runtime);
    client.send('serverEvent', { type: 'system', message: 'Bienvenue dans Arena.' });
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.runtime.delete(client.sessionId);
  }

  private addBot(index: number): void {
    const id = `bot-${index + 1}`;
    const player = new PlayerState();
    const spawn = findSpawn(index + 2);
    player.id = id;
    player.name = ['VoxelViper', 'StrafeByte', 'AimToast', 'RailDuck'][index] ?? `Bot ${index + 1}`;
    player.isBot = true;
    player.health = GAMEPLAY.maxHealth;
    player.ammo = GAMEPLAY.magazineSize;
    player.spawnSeq = 1;
    const runtime = this.createRuntime(true, spawn);
    this.syncPlayerMovement(player, runtime.movement, 0);
    this.state.players.set(id, player);
    this.runtime.set(id, runtime);
  }

  private handleJoinMatch(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.name = sanitizeDisplayName(parseJoinMatchOptions(payload).displayName);
  }

  private handleInput(client: Client, payload: unknown): void {
    const parsedInput = parseClientInput(payload);
    if (!parsedInput) return;
    const player = this.state.players.get(client.sessionId);
    const runtime = this.runtime.get(client.sessionId);
    if (!player || !runtime || !player.alive) return;
    if (parsedInput.spawnSeq !== player.spawnSeq) return;
    if (!this.allowInput(runtime)) return;
    const input = this.sanitizeInput(parsedInput, runtime);
    const lastQueued = runtime.inputQueue.at(-1);
    if (input.seq <= player.inputSeq || (lastQueued && input.seq <= lastQueued.seq)) return;
    runtime.inputQueue.push(input);
    if (runtime.inputQueue.length > GAMEPLAY.tickRate * 2) runtime.inputQueue.splice(0, runtime.inputQueue.length - GAMEPLAY.tickRate * 2);
  }

  private applyHumanInput(player: PlayerState, runtime: PlayerRuntime): void {
    const result = applyQueuedHumanInputs(runtime.movement, runtime.inputQueue, runtime.latestInput, player.inputSeq);
    if (result.appliedCommands === 0) return;
    runtime.latestInput = result.latestInput;
    runtime.movement = result.movement;
    this.syncPlayerMovement(player, runtime.movement, result.inputSeq);
  }

  private handleShoot(client: Client, payload: unknown): void {
    const shootMessage = parseShootMessage(payload);
    if (!shootMessage) return;
    const shooter = this.state.players.get(client.sessionId);
    const runtime = this.runtime.get(client.sessionId);
    if (shooter && runtime) this.fireFromPlayer(client.sessionId, shooter, runtime, shootMessage);
  }

  private handleReload(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const runtime = this.runtime.get(client.sessionId);
    if (player && runtime) this.reloadPlayer(client.sessionId, player, runtime);
  }

  private fireFromPlayer(playerId: string, shooter: PlayerState, runtime: PlayerRuntime, payload: ShootMessage): void {
    const now = Date.now();
    if (!shooter.alive || now < runtime.reloadingUntil) return;
    if (payload.spawnSeq !== shooter.spawnSeq) return;
    if (now - runtime.lastShotAt < GAMEPLAY.fireCooldownMs || shooter.ammo <= 0) return;

    runtime.lastShotAt = now;
    shooter.ammo -= 1;
    const direction = directionFromAngles(clamp(payload.yaw, -Math.PI * 2, Math.PI * 2), clamp(payload.pitch, -1.35, 1.35));
    const origin = { x: shooter.x, y: shooter.y + GAMEPLAY.eyeHeight, z: shooter.z };
    const hit = raycastPlayerHit(origin, direction, this.state.players, playerId);
    const shotEvent: ServerEvent = hit
      ? { type: 'shot', shooterId: playerId, origin, end: hit.point, hitId: hit.playerId }
      : {
          type: 'shot',
          shooterId: playerId,
          origin,
          end: {
            x: origin.x + direction.x * GAMEPLAY.weaponRange,
            y: origin.y + direction.y * GAMEPLAY.weaponRange,
            z: origin.z + direction.z * GAMEPLAY.weaponRange,
          },
        };
    this.broadcast('serverEvent', shotEvent);
    if (!hit) return;

    const targetId = hit.playerId;
    const target = this.state.players.get(targetId);
    if (!target) return;
    target.health = Math.max(0, target.health - GAMEPLAY.weaponDamage);
    this.broadcast('serverEvent', { type: 'hit', shooterId: playerId, targetId, damage: GAMEPLAY.weaponDamage, health: target.health });

    if (target.health <= 0) {
      shooter.kills += 1;
      target.deaths += 1;
      target.alive = false;
      target.respawnAt = now + GAMEPLAY.respawnSeconds * 1000;
      this.broadcast('serverEvent', { type: 'kill', killerId: shooter.id, victimId: target.id });
    }
  }

  private reloadPlayer(playerId: string, player: PlayerState, runtime: PlayerRuntime): void {
    if (player.ammo === GAMEPLAY.magazineSize) return;
    runtime.reloadingUntil = Date.now() + GAMEPLAY.reloadMs;
    this.clock.setTimeout(() => {
      if (this.state.players.get(playerId)?.alive) player.ammo = GAMEPLAY.magazineSize;
    }, GAMEPLAY.reloadMs);
  }

  private handleDebugKill(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;
    player.health = 0;
    player.alive = false;
    player.respawnAt = Date.now() + 250;
  }

  private update(_deltaMs: number): void {
    const now = Date.now();
    for (const [playerId, player] of this.state.players) {
      const runtime = this.runtime.get(playerId);
      if (!runtime) continue;
      if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) this.respawn(player, runtime);
      if (!runtime.bot && player.alive) this.applyHumanInput(player, runtime);
      if (runtime.bot && player.alive) this.updateBot(playerId, player, runtime, now);
    }

    if (now >= this.state.endsAt) this.state.endsAt = now + GAMEPLAY.matchSeconds * 1000;
  }

  private updateBot(playerId: string, bot: PlayerState, runtime: PlayerRuntime, now: number): void {
    if (now >= runtime.botNextThinkAt || !runtime.botTarget || !this.state.players.get(runtime.botTarget)?.alive) {
      runtime.botTarget = this.findClosestHuman(bot);
      runtime.botNextThinkAt = now + 450 + Math.random() * 500;
    }

    const target = runtime.botTarget ? this.state.players.get(runtime.botTarget) : undefined;
    if (!target) {
      this.applyBotInput(bot, runtime, {
        ...makeNeutralInput(now, bot.yaw + 0.035, 0),
        forward: 0.7,
        right: Math.sin(now / 500 + playerId.length) * 0.8,
      });
      return;
    }

    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const dy = target.y - bot.y;
    const distance = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = clamp(Math.atan2(dy + 0.3, Math.max(1, distance)), -0.5, 0.5);
    this.applyBotInput(bot, runtime, {
      seq: now,
      forward: distance > 10 ? 1 : distance < 5 ? -0.3 : 0.2,
      right: Math.sin(now / 260 + playerId.length),
      jump: Math.random() < 0.015,
      sprint: false,
      yaw,
      pitch,
    });

    if (distance < 38 && Math.random() < 0.26) this.fireFromPlayer(playerId, bot, runtime, { seq: now, spawnSeq: bot.spawnSeq, yaw, pitch });
    if (bot.ammo <= 0) this.reloadPlayer(playerId, bot, runtime);
  }

  private applyBotInput(player: PlayerState, runtime: PlayerRuntime, input: ClientInput): void {
    runtime.movement = simulateMovement(runtime.movement, { ...input, sprint: false }).state;
    this.syncPlayerMovement(player, runtime.movement, input.seq);
  }

  private findClosestHuman(bot: PlayerState): string | undefined {
    let targetId: string | undefined;
    let targetDistance = Number.POSITIVE_INFINITY;
    for (const [id, player] of this.state.players) {
      if (player.isBot || !player.alive) continue;
      const distance = Math.hypot(player.x - bot.x, player.z - bot.z);
      if (distance < targetDistance) {
        targetDistance = distance;
        targetId = id;
      }
    }
    return targetId;
  }

  private respawn(player: PlayerState, runtime: PlayerRuntime): void {
    const spawn = findSpawn(Math.floor(Math.random() * 1000));
    runtime.movement = createMovementState(spawn, spawn.yaw, 0);
    runtime.latestInput = makeNeutralInput(0, spawn.yaw, 0);
    runtime.inputQueue = [];
    this.syncPlayerMovement(player, runtime.movement, 0);
    player.spawnSeq += 1;
    player.health = GAMEPLAY.maxHealth;
    player.ammo = GAMEPLAY.magazineSize;
    player.alive = true;
    player.respawnAt = 0;
  }

  private allowInput(runtime: PlayerRuntime): boolean {
    const now = Date.now();
    if (now - runtime.lastInputAt > 1000) {
      runtime.lastInputAt = now;
      runtime.inputCount = 0;
    }
    runtime.inputCount += 1;
    return runtime.inputCount <= GAMEPLAY.inputRateLimitPerSecond;
  }

  private createRuntime(bot: boolean, spawn: { x: number; y: number; z: number; yaw: number }): PlayerRuntime {
    return {
      bot,
      movement: createMovementState(spawn, spawn.yaw, 0),
      lastInputAt: 0,
      inputCount: 0,
      lastShotAt: 0,
      reloadingUntil: 0,
      botTarget: undefined,
      botNextThinkAt: 0,
      latestInput: makeNeutralInput(0, spawn.yaw, 0),
      inputQueue: [],
    };
  }

  private syncPlayerMovement(player: PlayerState, movement: MovementState, inputSeq: number): void {
    player.x = movement.x;
    player.y = movement.y;
    player.z = movement.z;
    player.yaw = movement.yaw;
    player.pitch = movement.pitch;
    player.inputSeq = Number.isFinite(inputSeq) ? inputSeq : player.inputSeq;
  }

  private sanitizeInput(input: ClientInput, runtime: PlayerRuntime): ClientInput {
    const sanitized: ClientInput = {
      seq: Number.isSafeInteger(input.seq) ? input.seq : runtime.latestInput.seq,
      forward: clamp(input.forward, -1, 1),
      right: clamp(input.right, -1, 1),
      jump: input.jump === true,
      sprint: input.sprint === true,
      yaw: clamp(input.yaw, -Math.PI * 2, Math.PI * 2),
      pitch: clamp(input.pitch, -1.35, 1.35),
    };
    if (input.spawnSeq !== undefined) sanitized.spawnSeq = input.spawnSeq;
    return sanitized;
  }
}
