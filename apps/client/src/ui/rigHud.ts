import { RIG, RIG_NO_OWNER, TEAM_BLUE } from '@tidebreaker/shared';
import type { RigState } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';

/**
 * The three oil rigs at a glance (below the carriers' health): each shows its gauge, with blue on
 * the left and red on the right, a marker where the fight stands, and a frame in the color of the
 * team that owns it.
 */
export class RigHud {
  private readonly root = document.getElementById('rigs') as HTMLElement;
  private readonly boxes: HTMLElement[] = [];
  private readonly markers: HTMLElement[] = [];
  private lastKey = '';

  constructor() {
    for (let i = 0; i < RIG.count; i++) {
      const box = document.createElement('div');
      box.className = 'rig';
      const hex = document.createElement('div');
      hex.className = 'rig-hex panel';
      hex.textContent = String.fromCharCode(65 + i);
      box.title = `${t('rig.name')} ${i + 1}`;
      const bar = document.createElement('div');
      bar.className = 'rig-bar';
      const marker = document.createElement('div');
      marker.className = 'rig-marker';
      bar.append(marker);
      box.append(hex, bar);
      this.root.append(box);
      this.boxes.push(box);
      this.markers.push(marker);
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
      // Marker position: blue (+1) on the left edge, red (-1) on the right.
      this.markers[i]!.style.left = `${((1 - r.meter) / 2) * 100}%`;
      const box = this.boxes[i]!;
      box.classList.toggle('blue', r.owner === TEAM_BLUE);
      box.classList.toggle('red', r.owner !== RIG_NO_OWNER && r.owner !== TEAM_BLUE);
    }
  }
}
