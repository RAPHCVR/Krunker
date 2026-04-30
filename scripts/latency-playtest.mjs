import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const requireFromClient = createRequire(new URL('../apps/client/package.json', import.meta.url));
const { Client } = await import(pathToFileURL(requireFromClient.resolve('colyseus.js')).href);

const clients = Number(process.env.PLAYTEST_CLIENTS ?? 4);
const durationMs = Number(process.env.PLAYTEST_DURATION_MS ?? 10_000);
const tickRate = Number(process.env.PLAYTEST_TICK_RATE ?? 60);
const joinStaggerMs = Number(process.env.PLAYTEST_JOIN_STAGGER_MS ?? 150);
const maxAckP95Ms = Number(process.env.MAX_ACK_P95_MS ?? 80);
const maxAckMaxMs = Number(process.env.MAX_ACK_MAX_MS ?? 250);
const maxJoinP95Ms = Number(process.env.MAX_JOIN_P95_MS ?? 3_000);
const maxPatchP95Ms = Number(process.env.MAX_PATCH_P95_MS ?? 80);
const maxStateViolations = Number(process.env.MAX_STATE_VIOLATIONS ?? 0);
const maxOutstandingInputs = Number(process.env.MAX_OUTSTANDING_INPUTS ?? clients * 2);
const realtimeUrl = resolveRealtimeUrl();

if (!Number.isInteger(clients) || clients < 1 || clients > 8) throw new Error('PLAYTEST_CLIENTS must be an integer between 1 and 8');
if (!Number.isFinite(durationMs) || durationMs < 1_000) throw new Error('PLAYTEST_DURATION_MS must be at least 1000');

const { GAMEPLAY, MAP } = await import('../packages/shared/dist/index.js').catch((error) => {
  throw new Error(`packages/shared/dist/index.js introuvable. Lance d'abord pnpm --filter @krunker-arena/shared build. ${error.message}`);
});

const probes = [];
for (let index = 0; index < clients; index += 1) {
  probes.push(await joinProbe(index));
  await sleep(joinStaggerMs);
}

const playStartedAt = performance.now();
let nextTickAt = playStartedAt;
let tick = 0;
while (performance.now() - playStartedAt < durationMs) {
  const now = performance.now();
  if (now >= nextTickAt) {
    tick += 1;
    for (const probe of probes) probe.sendInput(tick, now);
    nextTickAt += 1000 / tickRate;
  } else {
    await sleep(Math.min(10, nextTickAt - now));
  }
}

await sleep(1_000);
for (const probe of probes) probe.close();

const joinLatencies = probes.map((probe) => probe.joinMs);
const ackLatencies = probes.flatMap((probe) => probe.ackLatencies);
const patchIntervals = probes.flatMap((probe) => probe.patchIntervals);
const stateViolations = probes.flatMap((probe) => probe.stateViolations);
const summary = {
  realtimeUrl,
  clients,
  durationMs,
  joins: summarize(joinLatencies),
  inputAckMs: summarize(ackLatencies),
  patchIntervalMs: summarize(patchIntervals),
  sentInputs: probes.reduce((sum, probe) => sum + probe.sentInputs, 0),
  ackedInputs: ackLatencies.length,
  outstandingTrackedInputs: probes.reduce((sum, probe) => sum + probe.sentAtBySeq.size, 0),
  spawnTransitions: probes.reduce((sum, probe) => sum + probe.spawnTransitions, 0),
  stateViolations: stateViolations.slice(0, 10),
};

console.log(JSON.stringify(summary, null, 2));

const failures = [];
if ((summary.joins.p95 ?? 0) > maxJoinP95Ms) failures.push(`join p95 ${summary.joins.p95}ms > ${maxJoinP95Ms}ms`);
if ((summary.inputAckMs.p95 ?? 0) > maxAckP95Ms) failures.push(`input ack p95 ${summary.inputAckMs.p95}ms > ${maxAckP95Ms}ms`);
if ((summary.inputAckMs.max ?? 0) > maxAckMaxMs) failures.push(`input ack max ${summary.inputAckMs.max}ms > ${maxAckMaxMs}ms`);
if ((summary.patchIntervalMs.p95 ?? 0) > maxPatchP95Ms) failures.push(`patch p95 ${summary.patchIntervalMs.p95}ms > ${maxPatchP95Ms}ms`);
if (summary.outstandingTrackedInputs > maxOutstandingInputs) failures.push(`outstanding inputs ${summary.outstandingTrackedInputs} > ${maxOutstandingInputs}`);
if (stateViolations.length > maxStateViolations) failures.push(`${stateViolations.length} state violations > ${maxStateViolations}`);
if (failures.length > 0) throw new Error(`Latency playtest failed: ${failures.join('; ')}`);

async function joinProbe(index) {
  const client = new Client(realtimeUrl);
  const joinStartedAt = performance.now();
  const room = await client.joinOrCreate('deathmatch', { displayName: `Probe${index + 1}` });
  const probe = {
    index,
    room,
    joinMs: round(performance.now() - joinStartedAt),
    seq: 0,
    spawnSeq: 0,
    alive: false,
    spawnTransitions: 0,
    sentInputs: 0,
    sentAtBySeq: new Map(),
    ackLatencies: [],
    patchIntervals: [],
    stateViolations: [],
    lastPatchAt: 0,
    lastAckSeq: 0,
    sendInput(tickIndex, now) {
      if (this.spawnSeq <= 0 || !this.alive) return;
      const input = makeInput(this, tickIndex);
      this.seq = input.seq;
      this.sentInputs += 1;
      this.sentAtBySeq.set(input.seq, now);
      this.room.send('input', input);
      if (tickIndex % 23 === index) this.room.send('shoot', { seq: input.seq, spawnSeq: input.spawnSeq, yaw: input.yaw, pitch: input.pitch });
      if (tickIndex % 97 === index) this.room.send('reload');
    },
    close() {
      this.room.leave();
    },
  };

  room.onStateChange((state) => {
    const now = performance.now();
    if (probe.lastPatchAt > 0) probe.patchIntervals.push(round(now - probe.lastPatchAt));
    probe.lastPatchAt = now;

    const player = state.players.get(room.sessionId);
    if (!player) return;
    const nextSpawnSeq = player.spawnSeq ?? probe.spawnSeq;
    const nextAlive = player.alive === true;
    if (nextSpawnSeq !== probe.spawnSeq) {
      probe.spawnSeq = nextSpawnSeq;
      probe.seq = 0;
      probe.lastAckSeq = player.inputSeq ?? 0;
      probe.sentAtBySeq.clear();
      probe.spawnTransitions += 1;
    }
    if (probe.alive && !nextAlive) probe.sentAtBySeq.clear();
    probe.alive = nextAlive;
    if (probe.alive) recordAck(probe, player.inputSeq ?? 0, now);
    if (isInsideAnyObstacle(player)) {
      probe.stateViolations.push({
        client: index + 1,
        seq: player.inputSeq,
        x: round(player.x),
        y: round(player.y),
        z: round(player.z),
      });
    }
  });
  room.onMessage('serverEvent', () => {});

  return probe;
}

function makeInput(probe, tickIndex) {
  const phase = tickIndex / 30 + probe.index * 0.75;
  return {
    seq: probe.seq + 1,
    spawnSeq: probe.spawnSeq,
    forward: Math.sin(phase) > -0.35 ? 1 : -0.75,
    right: Math.sin(phase * 0.73),
    jump: tickIndex % (37 + probe.index * 3) === 0,
    sprint: tickIndex % 120 < 55,
    yaw: Math.sin(phase * 0.4) * Math.PI,
    pitch: Math.sin(phase * 0.31) * 0.18,
  };
}

function recordAck(probe, inputSeq, now) {
  if (inputSeq <= probe.lastAckSeq) return;
  for (const [seq, sentAt] of [...probe.sentAtBySeq]) {
    if (seq > inputSeq) continue;
    probe.ackLatencies.push(round(now - sentAt));
    probe.sentAtBySeq.delete(seq);
  }
  probe.lastAckSeq = inputSeq;
}

function isInsideAnyObstacle(player) {
  return MAP.boxes.some((box) => {
    const halfX = box.sx / 2 + GAMEPLAY.playerRadius;
    const halfZ = box.sz / 2 + GAMEPLAY.playerRadius;
    const bottom = box.y - box.sy / 2;
    const top = box.y + box.sy / 2;
    const overlapsXZ = Math.abs(player.x - box.x) < halfX && Math.abs(player.z - box.z) < halfZ;
    const overlapsY = player.y < top - 0.001 && player.y + GAMEPLAY.playerHeight > bottom + 0.001;
    return overlapsXZ && overlapsY;
  });
}

function summarize(values) {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1),
  };
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function resolveRealtimeUrl() {
  if (process.env.REALTIME_URL) return process.env.REALTIME_URL;
  const gameUrl = new URL(process.env.GAME_URL ?? 'http://localhost:5173/');
  gameUrl.protocol = gameUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  gameUrl.pathname = '/realtime';
  gameUrl.search = '';
  gameUrl.hash = '';
  return gameUrl.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Number(value.toFixed(2));
}
