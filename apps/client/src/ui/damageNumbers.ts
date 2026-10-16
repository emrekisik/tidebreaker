import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

const POOL = 12;
const FX_POOL = 10;

/** Small pool of DOM elements that float up and fade (CSS animation) at the hit position. */
export class DamageNumbers {
  private readonly els: HTMLElement[] = [];
  private next = 0;
  /** A second pool for XP and arrow effects. */
  private readonly fx: HTMLElement[] = [];
  private nextFx = 0;
  private readonly v = new Vector3();

  constructor(layer: HTMLElement) {
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      layer.appendChild(el);
      this.els.push(el);
    }
    for (let i = 0; i < FX_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'fx';
      layer.appendChild(el);
      this.fx.push(el);
    }
  }

  /** A floating "+45 XP" at a sunk ship's position (rises and fades, a little bigger and gold). */
  showXp(camera: PerspectiveCamera, simX: number, simY: number, xp: number): void {
    const el = this.floating('xp-pop');
    this.place(el, camera, simX, simY, 2.5);
    el.textContent = `+${Math.round(xp)} XP`;
  }

  /** Three arrows rising one after another from a ship that just became a bigger class. */
  showArrows(camera: PerspectiveCamera, simX: number, simY: number): void {
    for (let i = 0; i < 3; i++) {
      const el = this.floating('up-arrow');
      this.place(el, camera, simX, simY, 2);
      el.style.marginLeft = `${(i - 1) * 22}px`;
      el.style.animationDelay = `${i * 0.14}s`;
      el.innerHTML =
        '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.8 2.6 10.2c-.6.7-.1 1.5.7 1.5h3.4v2.4c0 .5.4.9.8.9h5c.5 0 .8-.4.8-.9v-2.4h3.4c.9 0 1.3-.8.7-1.5z"/></svg>';
    }
  }

  /** The next free element of the effect pool, with its CSS animation restarted. */
  private floating(cls: string): HTMLElement {
    const el = this.fx[this.nextFx]!;
    this.nextFx = (this.nextFx + 1) % this.fx.length;
    el.className = `fx ${cls}`;
    el.style.animationDelay = '';
    el.style.marginLeft = '';
    void el.offsetWidth;
    return el;
  }

  private place(
    el: HTMLElement,
    camera: PerspectiveCamera,
    simX: number,
    simY: number,
    h: number,
  ): void {
    this.v.set(simX, h, simY).project(camera);
    el.style.left = `${(this.v.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-this.v.y * 0.5 + 0.5) * 100}%`;
  }

  /** A floating "+8" for money picked up. */
  showGain(camera: PerspectiveCamera, simX: number, simY: number, value: number): void {
    this.show(camera, simX, simY, value, false);
    const el = this.els[(this.next + POOL - 1) % POOL];
    if (!el) return;
    el.textContent = `+${Math.round(value)}`;
    el.classList.add('gain');
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
    el.classList.remove('gain');
    // Restart the CSS animation.
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}
