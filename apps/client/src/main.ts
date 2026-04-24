import './styles.css';
import { GAMEPLAY, type ClientInput } from '@krunker-arena/shared';
import { ArenaRenderer } from './game.js';
import { InputController } from './input.js';
import { GameNetwork, type PlayerSnapshot } from './network.js';
import { GameUi } from './ui.js';

declare global {
  interface Window {
    __arenaDebug?: {
      kill: () => void;
      setLook: (yaw: number, pitch: number) => void;
      snapshot: () => Record<string, unknown>;
    };
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

const renderer = new ArenaRenderer();
app.appendChild(renderer.element);

let players: PlayerSnapshot[] = [];
let localSessionId = '';
let gameplayFrame: number | undefined;
let previousFrameAt = 0;
let fixedStepAccumulator = 0;
let pendingInputs: ClientInput[] = [];
let localSpawnSeq = -1;
let localAlive = false;
const debugEnabled = new URLSearchParams(window.location.search).has('debug');
const fixedStepMs = 1000 / GAMEPLAY.tickRate;

const ui = new GameUi({
  start: (displayName) => void startGame(displayName),
});
app.appendChild(ui.root);
await ui.hydrate();

const network = new GameNetwork({
  onPlayers: (nextPlayers, sessionId) => {
    players = nextPlayers;
    localSessionId = sessionId;
    const serverLocalPlayer = players.find((player) => player.id === localSessionId);
    localAlive = serverLocalPlayer?.alive ?? false;
    if (serverLocalPlayer && serverLocalPlayer.spawnSeq !== localSpawnSeq) {
      localSpawnSeq = serverLocalPlayer.spawnSeq;
      pendingInputs = [];
      input.resetForSpawn(serverLocalPlayer.yaw, serverLocalPlayer.pitch);
    }
    if (serverLocalPlayer) {
      pendingInputs = pendingInputs.filter((input) => input.spawnSeq === serverLocalPlayer.spawnSeq && input.seq > serverLocalPlayer.inputSeq);
    }
    const localPlayer = renderer.updatePlayers(players, localSessionId, pendingInputs);
    if (localPlayer) ui.setPlayerStats(localPlayer.health, localPlayer.ammo);
    ui.setScoreboard(players.map((player) => ({ name: player.name, kills: player.kills, deaths: player.deaths })));
  },
  onEvent: (event) => {
    if (event.type === 'kill') ui.showMessage('Frag confirmé');
    else if (event.message) ui.showMessage(event.message);
  },
});

const input = new InputController(
  renderer.element,
  (message) => {
    if (localAlive && localSpawnSeq > 0) network.shoot({ ...message, spawnSeq: localSpawnSeq });
  },
  () => network.reload(),
);

if (debugEnabled) {
  window.__arenaDebug = {
    kill: () => network.debugKill(),
    setLook: (yaw, pitch) => input.setLook(yaw, pitch),
    snapshot: () => renderer.debugSnapshot(),
  };
}

async function startGame(displayName: string): Promise<void> {
  ui.showMessage('Connexion au serveur temps réel...');
  await network.connect(displayName);
  ui.showMessage('En ligne · clique pour jouer');
  if (gameplayFrame) window.cancelAnimationFrame(gameplayFrame);
  previousFrameAt = performance.now();
  fixedStepAccumulator = 0;
  gameplayFrame = window.requestAnimationFrame(runGameplayFrame);
}

function runGameplayFrame(now: number): void {
  fixedStepAccumulator = Math.min(fixedStepAccumulator + now - previousFrameAt, 250);
  previousFrameAt = now;

  let steps = 0;
  while (fixedStepAccumulator >= fixedStepMs && steps < 5) {
    if (localAlive && localSpawnSeq > 0) {
      const snapshot = input.snapshot(localSpawnSeq);
      pendingInputs.push(snapshot);
      if (pendingInputs.length > GAMEPLAY.tickRate * 3) pendingInputs = pendingInputs.slice(-GAMEPLAY.tickRate * 3);
      renderer.predictLocal(snapshot);
      network.sendInput(snapshot);
    }
    fixedStepAccumulator -= fixedStepMs;
    steps += 1;
  }
  if (steps === 5) fixedStepAccumulator = 0;

  if (debugEnabled) ui.setDebug(renderer.debugSnapshot());
  gameplayFrame = window.requestAnimationFrame(runGameplayFrame);
}
