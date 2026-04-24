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
          <small id="status">Local sans Postgres: comptes en mémoire jusqu'au restart serveur. ZQSD/AZERTY ou WASD, espace, shift sprint, clic, R.</small>
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
      <div class="bottom-strip"><div class="chip" id="feed">Clique pour capturer la souris</div></div>
    `;
    this.menu = this.root.querySelector('#menu')!;
    this.status = this.root.querySelector('#status')!;
    this.health = this.root.querySelector('#health')!;
    this.ammo = this.root.querySelector('#ammo')!;
    this.scoreboard = this.root.querySelector('#scoreboard')!;
    this.debug = this.root.querySelector('#debug')!;
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

  setScoreboard(rows: Array<{ name: string; kills: number; deaths: number }>): void {
    this.scoreboard.innerHTML = `<strong>Scoreboard</strong>${rows
      .sort((left, right) => right.kills - left.kills)
      .slice(0, 8)
      .map((row) => `<div class="score-row"><span>${escapeHtml(row.name)}</span><span>${row.kills}/${row.deaths}</span></div>`)
      .join('')}`;
  }

  showMessage(message: string): void {
    const feed = this.root.querySelector('#feed');
    if (feed) feed.textContent = message;
  }

  setDebug(snapshot: Record<string, unknown> | null): void {
    this.debug.classList.toggle('hidden', !snapshot);
    if (snapshot) this.debug.textContent = JSON.stringify(snapshot, null, 2);
  }

  private bind(): void {
    const username = this.root.querySelector<HTMLInputElement>('#username')!;
    const displayName = this.root.querySelector<HTMLInputElement>('#displayName')!;
    const password = this.root.querySelector<HTMLInputElement>('#password')!;
    this.root.querySelector('#login')!.addEventListener('click', () => void this.authenticate(() => login(username.value, password.value)));
    this.root.querySelector('#register')!.addEventListener('click', () => void this.authenticate(() => register(username.value, password.value, displayName.value)));
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
    this.menu.classList.add('hidden');
    this.events.start(displayName);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}
