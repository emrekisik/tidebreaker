import { rankBadge } from './rankBadge.ts';
import { RankBook } from './rankBook.ts';
import skullIcon from './icons/skull.svg?raw';

/** How long a mark stays (seconds): matches the CSS animation. */
const SHOW_SEC = 4;

/**
 * The mark a sunk ship leaves: a skull and the ship's name, at the spot where it went down, for a
 * short while. It stays in the world (it is projected from its world position every frame), so it
 * slides with the camera while it fades.
 */
export class WreckMarks {
  private readonly layer = document.getElementById('wreck-layer') as HTMLElement;
  private readonly marks: { el: HTMLElement; x: number; y: number; untilMs: number }[] = [];
  private readonly out = new Float32Array(2);

  /** A ship of `team` ('blue', 'red' or 'pirate') named `name` went down at (x, y). */
  add(x: number, y: number, name: string, team: string, nowMs: number, rank: number | null = null): void {
    const el = document.createElement('div');
    el.className = `wreck-mark ${team}`;
    const skull = document.createElement('div');
    skull.className = 'wm-skull';
    skull.innerHTML = skullIcon.replace(/ width="\d+" height="\d+"/, '');
    const label = document.createElement('div');
    label.className = 'wm-name';
    label.textContent = name;
    if (rank !== null) label.prepend(rankBadge(rank, RankBook.title(rank)));
    el.append(skull, label);
    el.style.display = 'none';
    this.layer.append(el);
    this.marks.push({ el, x, y, untilMs: nowMs + SHOW_SEC * 1000 });
  }

  /** `project(x, y, out)`: the screen position (pixels) of a world position; false when off screen. */
  update(nowMs: number, project: (x: number, y: number, out: Float32Array) => boolean): void {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      if (nowMs >= m.untilMs) {
        m.el.remove();
        this.marks.splice(i, 1);
        continue;
      }
      if (project(m.x, m.y, this.out)) {
        m.el.style.display = '';
        m.el.style.left = `${this.out[0]!}px`;
        m.el.style.top = `${this.out[1]!}px`;
      } else {
        m.el.style.display = 'none';
      }
    }
  }

  clear(): void {
    for (const m of this.marks) m.el.remove();
    this.marks.length = 0;
  }
}
