import { RIG, RIG_NO_OWNER, TEAM_BLUE } from '@tidebreaker/shared';
import type { RigState } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';

/**
 * The three oil rigs at a glance (below the carriers' health), as hexagons lettered A, B and C.
 * The outline shows who is winning the capture (blue clockwise from the top, red the other way);
 * a rig that is held fills with its owner's color.
 */
export class RigHud {
  private readonly root = document.getElementById('rigs') as HTMLElement;
  private readonly boxes: HTMLElement[] = [];
  private lastKey = '';

  constructor() {
    for (let i = 0; i < RIG.count; i++) {
      const box = document.createElement('div');
      box.className = 'rig';
      box.title = `${t('rig.name')} ${i + 1}`;
      const hex = document.createElement('div');
      hex.className = 'rig-hex';
      const letter = document.createElement('span');
      letter.textContent = String.fromCharCode(65 + i);
      hex.append(letter);
      box.append(hex);
      this.root.append(box);
      this.boxes.push(box);
    }
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** The server's latest gauges (meter +1 = blue, -1 = red). */
  update(rows: readonly RigState[]): void {
    const key = rows.map((r) => `${Math.round(r.meter * 100)}:${r.owner}`).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (let i = 0; i < this.boxes.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const box = this.boxes[i]!;
      box.style.setProperty('--b', String(Math.max(0, r.meter) * 100));
      box.style.setProperty('--r', String(Math.max(0, -r.meter) * 100));
      box.classList.toggle('blue', r.owner === TEAM_BLUE);
      box.classList.toggle('red', r.owner !== RIG_NO_OWNER && r.owner !== TEAM_BLUE);
    }
  }
}
