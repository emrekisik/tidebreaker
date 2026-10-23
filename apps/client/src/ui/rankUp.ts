import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';

/** How long the promotion stays on screen (seconds): matches the CSS animation. */
const SHOW_SEC = 3;

/**
 * The player was promoted: the new insignia pops up over their ship with a burst of light and a line of text, rises
 * and fades (like the burst of a new class, but showing the rank instead of arrows). It follows the ship for the
 * few seconds it lasts.
 */
export class RankUp {
  private el: HTMLElement | null = null;
  private untilMs = 0;
  private x = 0;
  private y = 0;

  constructor(private readonly root: HTMLElement) {}

  show(rank: number, nowMs: number): void {
    this.el?.remove();
    const el = document.createElement('div');
    el.className = 'rankup';
    const burst = document.createElement('span');
    burst.className = 'ru-burst';
    const ring = document.createElement('span');
    ring.className = 'ru-ring';
    const badge = rankBadge(rank, RankBook.title(rank));
    badge.classList.add('ru-badge');
    const label = document.createElement('span');
    label.className = 'ru-label';
    label.textContent = RankBook.title(rank);
    el.append(burst, ring, badge, label);
    el.style.display = 'none';
    this.root.append(el);
    this.el = el;
    // (A new element has no position yet.)
    this.x = NaN;
    this.y = NaN;
    this.untilMs = nowMs + SHOW_SEC * 1000;
  }

  /** Every frame. `project(out)` writes where it goes (pixels, above the own ship) and returns false when off screen. */
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
