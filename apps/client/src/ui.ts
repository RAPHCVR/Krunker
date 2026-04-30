import type { AuthUser } from '@krunker-arena/shared';
import { currentUser, login, register } from './api.js';

export type UiEvents = {
  start: (displayName: string) => void;
};

export class GameUi {
  readonly root: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly status: HTMLElement;
  private readonly health: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly scoreboard: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly hitMarker: HTMLElement;
  private readonly muzzleFlash: HTMLElement;
  private readonly damageVignette: HTMLElement;
  private readonly audio = new ProceduralAudio();
  private feedbackStats = { shots: 0, misses: 0, hits: 0, damage: 0, kills: 0, audioEvents: 0 };
  private user: AuthUser | null = null;

  constructor(private readonly events: UiEvents) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <section class="menu" id="menu">
        <article class="menu-card">
          <h1>Krunker Arena</h1>
          <p>FPS arena low-poly, rapide, auto-hébergé. Connecte-toi ou lance une session invitée.</p>
          <input id="username" autocomplete="username" placeholder="username" value="raphcvr" />
          <input id="displayName" autocomplete="nickname" placeholder="display name" value="Raph" />
          <input id="password" autocomplete="current-password" type="password" placeholder="mot de passe" value="password123" />
          <div class="grid">
            <button id="login">Login</button>
            <button id="register" class="secondary">Register</button>
          </div>
          <button id="guest" class="contrast">Jouer en invité</button>
          <small id="status">Production: comptes persistants PostgreSQL. Local: définir DATABASE_URL pour éviter le store mémoire de dev. ZQSD/AZERTY ou WASD, espace, shift sprint, clic, R.</small>
        </article>
      </section>
      <div class="hud-top">
        <div class="chip" id="health">HP 100</div>
        <div class="chip" id="ammo">12 / 12</div>
        <div class="chip">ZQSD/AZERTY · Shift sprint · Space · R</div>
      </div>
      <div class="scoreboard" id="scoreboard"></div>
      <pre class="debug hidden" id="debug"></pre>
      <div class="crosshair"></div>
      <div class="hit-marker" id="hitMarker"></div>
      <div class="muzzle-flash" id="muzzleFlash"></div>
      <div class="damage-vignette" id="damageVignette"></div>
      <div class="bottom-strip"><div class="chip" id="feed">Clique pour capturer la souris</div></div>
    `;
    this.menu = this.root.querySelector('#menu')!;
    this.status = this.root.querySelector('#status')!;
    this.health = this.root.querySelector('#health')!;
    this.ammo = this.root.querySelector('#ammo')!;
    this.scoreboard = this.root.querySelector('#scoreboard')!;
    this.debug = this.root.querySelector('#debug')!;
    this.hitMarker = this.root.querySelector('#hitMarker')!;
    this.muzzleFlash = this.root.querySelector('#muzzleFlash')!;
    this.damageVignette = this.root.querySelector('#damageVignette')!;
    this.bind();
  }

  async hydrate(): Promise<void> {
    this.user = await currentUser().catch(() => null);
    if (this.user) this.status.textContent = `Session active: ${this.user.displayName}`;
  }

  setPlayerStats(health: number, ammo: number): void {
    this.health.textContent = `HP ${Math.max(0, Math.round(health))}`;
    this.health.classList.toggle('danger', health <= 35);
    this.ammo.textContent = `${ammo} / 12`;
  }

  setScoreboard(rows: Array<{ name: string; kills: number; deaths: number; isBot: boolean }>): void {
    this.scoreboard.innerHTML = `<strong>Scoreboard</strong>${rows
      .sort((left, right) => right.kills - left.kills)
      .slice(0, 8)
      .map(
        (row) =>
          `<div class="score-row ${row.isBot ? 'bot-row' : 'human-row'}"><span><i></i>${escapeHtml(row.name)}<small>${row.isBot ? 'BOT' : 'JOUEUR'}</small></span><span>${row.kills}/${row.deaths}</span></div>`,
      )
      .join('')}`;
  }

  showMessage(message: string): void {
    const feed = this.root.querySelector('#feed');
    if (feed) feed.textContent = message;
  }

  showShotFeedback(hitExpected: boolean): void {
    this.feedbackStats.shots += 1;
    this.audio.resume();
    this.feedbackStats.audioEvents += this.audio.playShot(hitExpected);
    restartAnimation(this.muzzleFlash, 'muzzle-flash--active');
    if (!hitExpected) {
      this.feedbackStats.misses += 1;
      this.showMessage('Tir · raté');
    }
  }

  showHitFeedback(damage: number): void {
    this.feedbackStats.hits += 1;
    this.feedbackStats.audioEvents += this.audio.playHit();
    this.hitMarker.textContent = `+${damage}`;
    restartAnimation(this.hitMarker, 'hit-marker--active');
    this.showMessage(`Touché · ${damage}`);
  }

  showDamageFeedback(): void {
    this.feedbackStats.damage += 1;
    this.feedbackStats.audioEvents += this.audio.playDamage();
    restartAnimation(this.damageVignette, 'damage-vignette--active');
    this.showMessage('Tu es touché');
  }

  showKillFeedback(): void {
    this.feedbackStats.kills += 1;
    this.feedbackStats.audioEvents += this.audio.playKill();
    this.hitMarker.textContent = 'KO';
    restartAnimation(this.hitMarker, 'hit-marker--kill');
    this.showMessage('Élimination confirmée');
  }

  debugSnapshot(): Record<string, number> {
    return { ...this.feedbackStats };
  }

  setDebug(snapshot: Record<string, unknown> | null): void {
    this.debug.classList.toggle('hidden', !snapshot);
    if (snapshot) this.debug.textContent = JSON.stringify(snapshot, null, 2);
  }

  private bind(): void {
    const username = this.root.querySelector<HTMLInputElement>('#username')!;
    const displayName = this.root.querySelector<HTMLInputElement>('#displayName')!;
    const password = this.root.querySelector<HTMLInputElement>('#password')!;
    const unlockAudio = (): void => this.audio.resume();
    this.root.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    this.root.addEventListener('keydown', unlockAudio, { once: true, capture: true });
    this.root.querySelector('#login')!.addEventListener('click', () => {
      unlockAudio();
      void this.authenticate(() => login(username.value, password.value));
    });
    this.root.querySelector('#register')!.addEventListener('click', () => {
      unlockAudio();
      void this.authenticate(() => register(username.value, password.value, displayName.value));
    });
    this.root.querySelector('#guest')!.addEventListener('click', () => this.start(displayName.value || username.value || 'Guest'));
  }

  private async authenticate(action: () => Promise<AuthUser>): Promise<void> {
    try {
      this.status.textContent = 'Authentification...';
      this.user = await action();
      this.start(this.user.displayName);
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : 'Erreur auth';
    }
  }

  private start(displayName: string): void {
    this.audio.resume();
    this.menu.classList.add('hidden');
    this.events.start(displayName);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function restartAnimation(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

class ProceduralAudio {
  private context: AudioContext | null = null;

  resume(): void {
    const context = this.ensureContext();
    if (context?.state === 'suspended') void context.resume();
  }

  playShot(hitExpected: boolean): number {
    const context = this.ensureContext();
    if (!context) return 0;
    this.noise(0.035, hitExpected ? 0.18 : 0.13, 1800);
    this.tone(hitExpected ? 160 : 125, 0.055, 'sawtooth', 0.08, 0, hitExpected ? 90 : 70);
    return 1;
  }

  playHit(): number {
    const context = this.ensureContext();
    if (!context) return 0;
    this.tone(760, 0.06, 'triangle', 0.07, 0, 1180);
    this.tone(1420, 0.045, 'sine', 0.05, 0.035);
    return 1;
  }

  playDamage(): number {
    const context = this.ensureContext();
    if (!context) return 0;
    this.noise(0.09, 0.16, 360);
    this.tone(82, 0.11, 'sine', 0.11, 0, 48);
    return 1;
  }

  playKill(): number {
    const context = this.ensureContext();
    if (!context) return 0;
    this.tone(420, 0.07, 'triangle', 0.08);
    this.tone(840, 0.09, 'triangle', 0.08, 0.055);
    return 1;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    this.context = new AudioContextCtor();
    return this.context;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gainValue: number, delay = 0, endFrequency = frequency): void {
    const context = this.ensureContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  private noise(duration: number, gainValue: number, filterFrequency: number): void {
    const context = this.ensureContext();
    if (!context) return;
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) samples[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = filterFrequency;
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    source.stop(context.currentTime + duration);
  }
}
