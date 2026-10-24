/** How long a message stays over the ship (milliseconds): matches the CSS animation. */
const SHOW_MS = 1700;

/**
 * Short messages floating over the player's own ship ("No missiles", "Auto fire on"): they appear where the player
 * is looking, rise a little and fade. One at a time; a new message replaces the old one.
 */
export class ShipAlert {
  private el: HTMLElement | null = null;
  private untilMs = 0;
  private x = NaN;
  private y = NaN;

  constructor(private readonly root: HTMLElement) {}

  /** `tone`: "warn" (red, for something that did not work) or "info" (gold, for a switch the player flipped). */
  show(text: string, nowMs: number, tone: 'warn' | 'info' = 'warn'): void {
    this.el?.remove();
    const el = document.createElement('div');
    el.className = `ship-alert ${tone}`;
    el.textContent = text;
    el.style.display = 'none';
    this.root.append(el);
    this.el = el;
    // (A new element has no position yet.)
    this.x = NaN;
    this.y = NaN;
    this.untilMs = nowMs + SHOW_MS;
  }

  /** Every frame. `project(out)` writes the screen spot over the own ship and returns false when it is off screen. */
  update(nowMs: number, project: (out: Float32Array) => boolean, out: Float32Array): void {
    const el = this.el;
    if (!el) return;
    if (nowMs >= this.untilMs) {
      el.remove();
      this.el = null;
      return;
    }
    if (!project(out)) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const x = Math.round(out[0]!);
    const y = Math.round(out[1]!);
    if (x !== this.x || y !== this.y) {
      this.x = x;
      this.y = y;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    }
  }
}
