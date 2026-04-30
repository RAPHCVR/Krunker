import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultGameUrl = 'http://localhost:5173/?debug=1';
const gameUrl = process.env.GAME_URL ?? defaultGameUrl;
const cdpPort = Number(process.env.CDP_PORT ?? 9230 + Math.floor(Math.random() * 1000));
const chromePath = process.env.CHROME_PATH ?? findChromePath();
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krunker-cdp-'));
const smokeRespawn = process.env.SMOKE_RESPAWN === '1';
const viewport = readViewport();
const browserEvents = [];
const managedProcesses = [];
let nextId = 1;
let chrome;

if (!chromePath) {
  console.error('Chrome introuvable. Renseigne CHROME_PATH pour lancer le smoke navigateur.');
  process.exit(1);
}

try {
  await ensureLocalGame();
  chrome = spawn(
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
  await waitForChrome();
  const targets = await waitForTargets();
  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Aucun target CDP page disponible.');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  if (viewport) await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
  await cdp.send('Page.bringToFront');
  await cdp.send('Page.navigate', { url: gameUrl });
  await poll(cdp, 'window.__arenaReady === true && Boolean(document.querySelector("#guest"))');
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("#guest").click()' });
  await poll(cdp, 'Boolean(document.querySelector("#debug")?.textContent?.includes("sessionId"))');
  await poll(
    cdp,
    `(() => {
      const debug = JSON.parse(document.querySelector("#debug")?.textContent || "{}");
      return debug.botTotal >= 4;
    })()`,
  );
  await poll(
    cdp,
    `(() => {
      const debug = JSON.parse(document.querySelector("#debug")?.textContent || "{}");
      return debug.server?.health > 0 && debug.server?.ammo > 0 && debug.spawnSeq > 0;
    })()`,
  );
  const beforeShotDebug = JSON.parse(await evaluate(cdp, 'document.querySelector("#debug")?.textContent || "{}"'));
  await assertDebugShot(cdp, beforeShotDebug);

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
    bots: debug.bots,
    botTotal: debug.botTotal,
    humans: debug.humans,
    humanTotal: debug.humanTotal,
    tracers: debug.tracers,
    feedback: debug.feedback,
    local: debug.local,
    server: debug.server,
  };
  console.log(JSON.stringify(status, null, 2));

  if (debug.corrections > 1) throw new Error(`Trop de corrections dures: ${debug.corrections}`);
  if (debug.predictionError > 0.5) throw new Error(`Erreur de prediction trop haute: ${debug.predictionError}`);
  if (debug.local?.y !== 0 || debug.server?.y !== 0) throw new Error(`Hauteur sol inattendue: local=${debug.local?.y} server=${debug.server?.y}`);
  if (debug.botTotal < 4) throw new Error(`Bots non visibles dans le state client: ${debug.botTotal}`);

  if (process.env.SMOKE_SCREENSHOT) await captureScreenshot(cdp, process.env.SMOKE_SCREENSHOT);

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

async function ensureLocalGame() {
  if (process.env.SMOKE_MANAGE_SERVERS === '0' || process.env.GAME_URL) return;

  const serverUrl = 'http://127.0.0.1:2567/readyz';
  if (!(await isHttpReady(serverUrl))) {
    startManagedProcess(
      ['pnpm', '--filter', '@krunker-arena/server', 'dev'],
      '.demo-smoke-server.log',
      {
        ...process.env,
        AUTH_STORE: process.env.AUTH_STORE ?? 'memory',
        ENABLE_DEBUG_CHEATS: process.env.ENABLE_DEBUG_CHEATS ?? 'true',
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
    );
    await waitForHttp(serverUrl, 'serveur Colyseus', '.demo-smoke-server.log', 20_000);
  }

  const clientUrl = 'http://127.0.0.1:5173/?debug=1';
  if (!(await isHttpReady(clientUrl))) {
    startManagedProcess(['pnpm', '--filter', '@krunker-arena/client', 'dev'], '.demo-smoke-client.log', process.env);
    await waitForHttp(clientUrl, 'client Vite', '.demo-smoke-client.log', 20_000);
  }
}

function startManagedProcess(args, logFile, env) {
  const logPath = path.join(repoRoot, logFile);
  const output = fs.openSync(logPath, 'w');
  const launch = corepackLaunch(args);
  const child = spawn(launch.command, launch.args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', output, output],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.unref();
  managedProcesses.push(child);
}

function corepackLaunch(args) {
  if (process.platform !== 'win32') return { command: 'corepack', args };
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', ['corepack', ...args].map(quoteCmdArg).join(' ')] };
}

function quoteCmdArg(value) {
  if (/^[\w@/:.,=+-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function waitForHttp(url, label, logFile, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} indisponible sur ${url}.\n${tailLog(logFile)}`);
}

function isHttpReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function tailLog(logFile) {
  try {
    return fs.readFileSync(path.join(repoRoot, logFile), 'utf8').split(/\r?\n/).slice(-40).join('\n');
  } catch {
    return `Log indisponible: ${logFile}`;
  }
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

function readViewport() {
  const width = Number(process.env.SMOKE_VIEWPORT_WIDTH ?? 0);
  const height = Number(process.env.SMOKE_VIEWPORT_HEIGHT ?? 0);
  const deviceScaleFactor = Number(process.env.SMOKE_DEVICE_SCALE_FACTOR ?? 1);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;

  return {
    width,
    height,
    deviceScaleFactor: Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1,
    mobile: process.env.SMOKE_VIEWPORT_MOBILE === '1',
  };
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

async function captureScreenshot(cdp, outputPath) {
  const screenshotPath = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ screenshot: screenshotPath }, null, 2));
}

async function assertDebugShot(cdp, beforeShotDebug) {
  const beforeShots = beforeShotDebug.feedback?.shots ?? 0;
  const beforeAmmo = beforeShotDebug.server?.ammo ?? 0;
  let lastDebug = beforeShotDebug;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await cdp.send('Runtime.evaluate', { expression: 'window.__arenaDebug?.shoot()' });
    try {
      await poll(
        cdp,
        `(() => {
          const debug = JSON.parse(document.querySelector("#debug")?.textContent || "{}");
          return debug.feedback?.shots > ${beforeShots} || debug.server?.ammo < ${beforeAmmo};
        })()`,
        2_000,
        50,
      );
      return;
    } catch (error) {
      lastDebug = JSON.parse(await evaluate(cdp, 'document.querySelector("#debug")?.textContent || "{}"'));
      if (lastDebug.server?.health <= 0 || lastDebug.server?.ammo <= 0) break;
    }
  }

  throw new Error(`Shot debug non observe: ${JSON.stringify(lastDebug)}`);
}

async function poll(cdp, expression, timeoutMs = 12_000, intervalMs = 150) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
  if (chrome) {
    try {
      chrome.kill('SIGKILL');
    } catch {
      // already closed
    }
  }
  for (const child of managedProcesses) {
    terminate(child);
  }
  setTimeout(() => {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome can briefly keep profile files locked on Windows.
    }
  }, 500);
}

function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already closed
    }
  }
}
