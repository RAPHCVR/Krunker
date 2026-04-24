import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const gameUrl = process.env.GAME_URL ?? 'http://localhost:5173/?debug=1';
const cdpPort = Number(process.env.CDP_PORT ?? 9230 + Math.floor(Math.random() * 1000));
const chromePath = process.env.CHROME_PATH ?? findChromePath();
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krunker-cdp-'));
const smokeRespawn = process.env.SMOKE_RESPAWN === '1';
const browserEvents = [];
let nextId = 1;

if (!chromePath) {
  console.error('Chrome introuvable. Renseigne CHROME_PATH pour lancer le smoke navigateur.');
  process.exit(1);
}

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  await waitForChrome();
  const targets = await waitForTargets();
  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Aucun target CDP page disponible.');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.bringToFront');
  await cdp.send('Page.navigate', { url: gameUrl });
  await poll(cdp, 'window.__arenaReady === true && Boolean(document.querySelector("#guest"))');
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("#guest").click()' });
  await poll(cdp, 'Boolean(document.querySelector("#debug")?.textContent?.includes("sessionId"))');

  await key(cdp, 'KeyZ', 'z', 90, 900);
  await key(cdp, 'KeyS', 's', 83, 900);
  await key(cdp, 'KeyQ', 'q', 81, 500);
  await key(cdp, 'KeyD', 'd', 68, 500);
  await new Promise((resolve) => setTimeout(resolve, 900));

  const debug = JSON.parse(await evaluate(cdp, 'document.querySelector("#debug")?.textContent || "{}"'));
  const status = {
    corrections: debug.corrections,
    predictionError: debug.predictionError,
    pendingInputs: debug.pendingInputs,
    serverSeq: debug.serverSeq,
    spawnSeq: debug.spawnSeq,
    local: debug.local,
    server: debug.server,
  };
  console.log(JSON.stringify(status, null, 2));

  if (debug.corrections > 1) throw new Error(`Trop de corrections dures: ${debug.corrections}`);
  if (debug.predictionError > 0.5) throw new Error(`Erreur de prediction trop haute: ${debug.predictionError}`);
  if (debug.local?.y !== 0 || debug.server?.y !== 0) throw new Error(`Hauteur sol inattendue: local=${debug.local?.y} server=${debug.server?.y}`);

  if (smokeRespawn) {
    const previousSpawnSeq = debug.spawnSeq;
    await cdp.send('Runtime.evaluate', { expression: 'window.__arenaDebug?.kill()' });
    const respawned = await poll(
      cdp,
      `(() => {
        const debug = JSON.parse(document.querySelector("#debug")?.textContent || "{}");
        return debug.spawnSeq > ${previousSpawnSeq} && debug.server?.health === 100;
      })()`,
      8_000,
    ).catch(() => {
      throw new Error('Respawn non observé. Lance le serveur avec ENABLE_DEBUG_CHEATS=true pour ce smoke.');
    });
    if (!respawned) throw new Error('Respawn non observé.');

    await cdp.send('Runtime.evaluate', { expression: 'window.__arenaDebug?.setLook(1.1, 0.18)' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const afterRespawn = JSON.parse(await evaluate(cdp, 'document.querySelector("#debug")?.textContent || "{}"'));
    console.log(JSON.stringify({ afterRespawn }, null, 2));
    if (afterRespawn.serverSeq > 120) throw new Error(`InputSeq trop haut après respawn, probable input ancienne vie accepté: ${afterRespawn.serverSeq}`);
    if (Math.abs(afterRespawn.server?.yaw - 1.1) > 0.08) throw new Error(`Yaw serveur bloqué après respawn: ${afterRespawn.server?.yaw}`);
    if (Math.abs(afterRespawn.local?.yaw - 1.1) > 0.08) throw new Error(`Yaw client bloqué après respawn: ${afterRespawn.local?.yaw}`);
  }
  cdp.close();
} catch (error) {
  if (browserEvents.length > 0) console.error(JSON.stringify({ browserEvents: browserEvents.slice(-20) }, null, 2));
  throw error;
} finally {
  cleanup();
}

function findChromePath() {
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function requestJson(method, pathName) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: cdpPort, path: pathName, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Réponse CDP invalide: ${body.slice(0, 200)}`));
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function waitForChrome() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      return await requestJson('GET', '/json/version');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error('Chrome CDP ne démarre pas.');
}

async function waitForTargets() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const targets = await requestJson('GET', '/json');
      if (targets.some((target) => target.type === 'page' && target.webSocketDebuggerUrl)) return targets;
    } catch {
      // Chrome can reset early CDP sockets while booting; retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Targets CDP indisponibles.');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      recordBrowserEvent(message);
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };

  return new Promise((resolve, reject) => {
    socket.onopen = () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((innerResolve, innerReject) => pending.set(id, { resolve: innerResolve, reject: innerReject }));
        },
        close() {
          socket.close();
        },
      });
    };
    socket.onerror = () => reject(new Error('Erreur WebSocket CDP.'));
  });
}

function recordBrowserEvent(message) {
  if (message.method === 'Runtime.consoleAPICalled') {
    browserEvents.push({
      type: 'console',
      level: message.params.type,
      text: message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '),
    });
  } else if (message.method === 'Runtime.exceptionThrown') {
    browserEvents.push({
      type: 'exception',
      text: message.params.exceptionDetails?.text,
      description: message.params.exceptionDetails?.exception?.description,
    });
  } else if (message.method === 'Log.entryAdded') {
    browserEvents.push({
      type: 'log',
      level: message.params.entry?.level,
      text: message.params.entry?.text,
      url: message.params.entry?.url,
    });
  }
  if (browserEvents.length > 100) browserEvents.splice(0, browserEvents.length - 100);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function poll(cdp, expression, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timeout navigateur: ${expression}`);
}

async function key(cdp, code, keyValue, virtualCode, durationMs) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key: keyValue,
    text: keyValue,
    windowsVirtualKeyCode: virtualCode,
    nativeVirtualKeyCode: virtualCode,
  });
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key: keyValue,
    windowsVirtualKeyCode: virtualCode,
    nativeVirtualKeyCode: virtualCode,
  });
}

function cleanup() {
  try {
    chrome.kill('SIGKILL');
  } catch {
    // already closed
  }
  setTimeout(() => {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome can briefly keep profile files locked on Windows.
    }
  }, 500);
}
