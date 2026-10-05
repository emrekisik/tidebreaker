/**
 * Keyboard + mouse state. A/D = rudder, W = throttle, S = brake, right mouse = throttle (same as
 * W), left mouse = fire. Aim is kept as normalized device coordinates for the camera ray.
 */
export class Input {
  /** Rudder in [-1, 1]; positive turns clockwise on screen. */
  steer = 0;
  /** 1 = accelerate, -1 = brake, 0 = coast. */
  throttle = 0;
  fire = false;
  ndcX = 0;
  ndcY = 0;
  private readonly keys = new Set<string>();
  private rightMouse = false;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.recompute();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.recompute();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fire = false;
      this.rightMouse = false;
      this.recompute();
    });
    window.addEventListener('pointermove', (e) => this.pointer(e));
    canvas.addEventListener('pointerdown', (e) => {
      this.pointer(e);
      if (e.button === 0) this.fire = true;
      if (e.button === 2) {
        this.rightMouse = true;
        this.recompute();
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) {
        this.rightMouse = false;
        this.recompute();
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private pointer(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }

  private recompute(): void {
    const k = this.keys;
    const right = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const gas = k.has('KeyW') || k.has('ArrowUp') || this.rightMouse ? 1 : 0;
    this.steer = right - left;
    // Brake wins over gas so a held brake always stops the ship.
    this.throttle = brake ? -1 : gas;
  }
}
