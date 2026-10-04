/** Keyboard + mouse state. Aim is kept as normalized device coordinates for the camera ray. */
export class Input {
  moveX = 0;
  moveY = 0;
  fire = false;
  ndcX = 0;
  ndcY = 0;
  private readonly keys = new Set<string>();
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
      this.recompute();
    });
    window.addEventListener('pointermove', (e) => this.pointer(e));
    canvas.addEventListener('pointerdown', (e) => {
      this.pointer(e);
      if (e.button === 0) this.fire = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.fire = false;
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
    const down = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const up = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    this.moveX = right - left;
    // Screen-up is sim -y (see CameraRig), so W moves toward -y.
    this.moveY = down - up;
  }
}
