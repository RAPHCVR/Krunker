import { clamp, type ClientInput, type ShootMessage } from '@krunker-arena/shared';

export class InputController {
  private readonly keys = new Set<string>();
  private readonly printableKeys = new Set<string>();
  private sequence = 0;
  yaw = 0;
  pitch = 0;

  constructor(private readonly element: HTMLElement, private readonly onShoot: (message: ShootMessage) => void, private readonly onReload: () => void) {
    window.addEventListener('keydown', (event) => this.handleKey(event, true));
    window.addEventListener('keyup', (event) => this.handleKey(event, false));
    window.addEventListener('mousemove', (event) => this.handleMouse(event));
    window.addEventListener('mousedown', (event) => {
      if (event.button === 0 && document.pointerLockElement === this.element) this.onShoot({ seq: ++this.sequence, yaw: this.yaw, pitch: this.pitch });
    });
    this.element.addEventListener('click', () => void this.element.requestPointerLock());
  }

  snapshot(spawnSeq: number): ClientInput {
    const forwardKey = this.keys.has('KeyW') || this.keys.has('KeyZ') || this.printableKeys.has('z') || this.printableKeys.has('w');
    const leftKey = this.keys.has('KeyA') || this.keys.has('KeyQ') || this.printableKeys.has('q') || this.printableKeys.has('a');
    const backKey = this.keys.has('KeyS') || this.printableKeys.has('s');
    const rightKey = this.keys.has('KeyD') || this.printableKeys.has('d');
    return {
      seq: ++this.sequence,
      spawnSeq,
      forward: Number(forwardKey) - Number(backKey),
      right: Number(rightKey) - Number(leftKey),
      jump: this.keys.has('Space'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  resetForSpawn(yaw: number, pitch: number): void {
    this.keys.clear();
    this.printableKeys.clear();
    this.sequence = 0;
    this.setLook(yaw, pitch);
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = normalizeYaw(yaw);
    this.pitch = clamp(pitch, -1.35, 1.35);
  }

  private handleKey(event: KeyboardEvent, down: boolean): void {
    if (['KeyW', 'KeyZ', 'KeyA', 'KeyQ', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR'].includes(event.code)) event.preventDefault();
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);
    if (event.key.length === 1) {
      if (down) this.printableKeys.add(event.key.toLowerCase());
      else this.printableKeys.delete(event.key.toLowerCase());
    }
    if (down && event.code === 'KeyR') this.onReload();
  }

  private handleMouse(event: MouseEvent): void {
    if (document.pointerLockElement !== this.element) return;
    this.yaw = normalizeYaw(this.yaw - event.movementX * 0.0024);
    this.pitch = clamp(this.pitch - event.movementY * 0.0024, -1.35, 1.35);
  }
}

function normalizeYaw(value: number): number {
  const tau = Math.PI * 2;
  return ((((value + Math.PI) % tau) + tau) % tau) - Math.PI;
}
