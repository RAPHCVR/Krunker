import * as THREE from 'three';
import { GAMEPLAY, MAP, createMovementState, replayMovement, simulateMovement, type ClientInput, type MovementState } from '@krunker-arena/shared';
import type { PlayerSnapshot } from './network.js';

export class ArenaRenderer {
  readonly element: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 250);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly playerMeshes = new Map<string, THREE.Group>();
  private localMovement: MovementState | null = null;
  private localServerSnapshot: PlayerSnapshot | null = null;
  private correctionCount = 0;
  private lastPredictionError = 0;
  private pendingInputCount = 0;
  private localSpawnSeq = -1;
  private sessionId = '';

  constructor() {
    this.element = this.renderer.domElement;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0x101723);
    this.scene.fog = new THREE.Fog(0x101723, 45, 120);
    this.buildScene();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.render());
  }

  updatePlayers(players: PlayerSnapshot[], sessionId: string, pendingInputs: readonly ClientInput[]): PlayerSnapshot | null {
    this.sessionId = sessionId;
    const activeIds = new Set(players.map((player) => player.id));
    for (const [id, mesh] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.playerMeshes.delete(id);
      }
    }

    let localPlayer: PlayerSnapshot | null = null;
    for (const player of players) {
      if (player.id === sessionId) {
        localPlayer = player;
        this.localServerSnapshot = player;
        this.localMovement = this.reconcileLocal(player, pendingInputs);
        this.applyCamera(this.localMovement);
        continue;
      }

      const mesh = this.ensurePlayerMesh(player.id, player.name);
      mesh.visible = player.alive;
      mesh.position.set(player.x, player.y, player.z);
      mesh.rotation.y = player.yaw;
    }
    return localPlayer;
  }

  predictLocal(input: ClientInput): void {
    if (!this.localMovement || !this.localServerSnapshot?.alive) return;
    this.localMovement = simulateMovement(this.localMovement, input, 1 / GAMEPLAY.tickRate).state;
    this.applyCamera(this.localMovement);
  }

  debugSnapshot(): Record<string, unknown> {
    const local = this.localMovement;
    const server = this.localServerSnapshot;
    return {
      sessionId: this.sessionId,
      serverSeq: server?.inputSeq ?? 0,
      spawnSeq: server?.spawnSeq ?? 0,
      pendingInputs: this.pendingInputCount,
      predictionError: Number(this.lastPredictionError.toFixed(3)),
      corrections: this.correctionCount,
      local: local ? roundVector(local) : null,
      server: server ? roundVector(server) : null,
    };
  }

  private buildScene(): void {
    const hemi = new THREE.HemisphereLight(0xc8dcff, 0x273018, 2.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(18, 36, 12);
    sun.castShadow = true;
    this.scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(MAP.size, 0.12, MAP.size),
      new THREE.MeshStandardMaterial({ color: 0x2c3442, roughness: 0.86 }),
    );
    floor.receiveShadow = true;
    floor.position.y = -0.06;
    this.scene.add(floor);

    for (const box of MAP.boxes) {
      const obstacle = new THREE.Mesh(
        new THREE.BoxGeometry(box.sx, box.sy, box.sz),
        new THREE.MeshStandardMaterial({ color: 0x536271, roughness: 0.7, metalness: 0.05 }),
      );
      obstacle.position.set(box.x, box.y, box.z);
      obstacle.castShadow = true;
      obstacle.receiveShadow = true;
      this.scene.add(obstacle);
    }

    const grid = new THREE.GridHelper(MAP.size, 28, 0xffcc33, 0x3a4656);
    grid.position.y = 0.01;
    this.scene.add(grid);
  }

  private ensurePlayerMesh(id: string, name: string): THREE.Group {
    const existing = this.playerMeshes.get(id);
    if (existing) return existing;

    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 8), material);
    body.castShadow = true;
    body.position.y = GAMEPLAY.playerHeight / 2;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    barrel.position.set(0.25, GAMEPLAY.eyeHeight - 0.2, -0.55);
    group.add(body, barrel);
    group.name = name;
    this.playerMeshes.set(id, group);
    this.scene.add(group);
    return group;
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private applyCamera(player: Pick<MovementState, 'x' | 'y' | 'z' | 'yaw' | 'pitch'>): void {
    this.camera.position.set(player.x, player.y + GAMEPLAY.eyeHeight, player.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = player.yaw;
    this.camera.rotation.x = player.pitch;
  }

  private reconcileLocal(serverPlayer: PlayerSnapshot, pendingInputs: readonly ClientInput[]): MovementState {
    const serverMovement = createMovementState(serverPlayer, serverPlayer.yaw, serverPlayer.pitch);
    const authoritativeInputs = pendingInputs.filter((input) => input.seq > serverPlayer.inputSeq);
    this.pendingInputCount = authoritativeInputs.length;
    const replayedMovement = serverPlayer.alive ? replayMovement(serverMovement, authoritativeInputs) : serverMovement;
    const isSpawnReset = serverPlayer.spawnSeq !== this.localSpawnSeq;
    this.localSpawnSeq = serverPlayer.spawnSeq;

    if (!this.localMovement || !serverPlayer.alive || isSpawnReset) {
      this.lastPredictionError = 0;
      return replayedMovement;
    }

    const horizontalError = Math.hypot(this.localMovement.x - replayedMovement.x, this.localMovement.z - replayedMovement.z);
    const verticalError = Math.abs(this.localMovement.y - replayedMovement.y);
    this.lastPredictionError = Math.hypot(horizontalError, verticalError);
    if (this.lastPredictionError > 0.35) this.correctionCount += 1;
    return replayedMovement;
  }
}

function roundVector(vector: { x: number; y: number; z: number; yaw?: number; pitch?: number }): Record<string, number> {
  return Object.fromEntries(
    Object.entries(vector)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => [key, Number((value as number).toFixed(3))]),
  );
}
