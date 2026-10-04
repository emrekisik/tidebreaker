import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

const POOL = 12;

/** Small pool of DOM elements that float up and fade (CSS animation) at the hit position. */
export class DamageNumbers {
  private readonly els: HTMLElement[] = [];
  private next = 0;
  private readonly v = new Vector3();

  constructor(layer: HTMLElement) {
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      layer.appendChild(el);
      this.els.push(el);
    }
  }

  show(
    camera: PerspectiveCamera,
    simX: number,
    simY: number,
    damage: number,
    shield: boolean,
  ): void {
    const el = this.els[this.next];
    this.next = (this.next + 1) % POOL;
    if (!el) return;
    this.v.set(simX, 1.5, simY).project(camera);
    el.style.left = `${(this.v.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-this.v.y * 0.5 + 0.5) * 100}%`;
    el.textContent = String(Math.round(damage));
    el.classList.toggle('shield', shield);
    // Restart the CSS animation.
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}
