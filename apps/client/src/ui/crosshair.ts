import crosshairSvg from './icons/crosshair1.svg?raw';

/** How hard a shot kicks the crosshair, by projectile visual (1 = the biggest kick). */
export const KICK = { bullet: 0.22, shell: 0.6, rocket: 0.8, missile: 1, heavy: 1 } as const;
/** The kick fades away by this share per second (exponential). */
const DECAY_PER_SEC = 9;
/** How far (share of its size) and how much (degrees) the crosshair swells and twists at a full kick. */
const SWELL = 0.6;
const TWIST_DEG = 16;

/**
 * The aiming pointer: the crosshair picture drawn over the mouse position (the system cursor is
 * hidden over the sea). Every shot of the player's ship kicks it: it swells and twists a little, the
 * more the heavier the shot (bullets only flutter it, shells and rockets snap it), then settles back.
 */
export class Crosshair {
  private readonly root = document.getElementById('crosshair') as HTMLElement;
  private readonly pic = document.createElement('div');
  private kick = 0;
  /** Alternates the twist direction of heavy shots. */
  private side = 1;
  private shown = false;

  constructor() {
    this.pic.className = 'ch-pic';
    this.pic.innerHTML = crosshairSvg.replace(/ width="\d+" height="\d+"/, '');
    this.root.append(this.pic);
  }

  /** The player's ship fired a shot of this weight (`KICK.*`). */
  shot(weight: number): void {
    this.kick = Math.min(1, this.kick + weight);
    if (weight >= KICK.shell) this.side = -this.side;
  }

  /** Per frame: follows the mouse (pixels), shows or hides, and lets the kick fade. */
  update(dtSec: number, x: number, y: number, visible: boolean): void {
    if (visible !== this.shown) {
      this.shown = visible;
      this.root.classList.toggle('hidden', !visible);
    }
    if (!visible) return;
    this.kick *= Math.exp(-DECAY_PER_SEC * dtSec);
    if (this.kick < 0.002) this.kick = 0;
    this.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.pic.style.transform = `scale(${(1 + SWELL * this.kick).toFixed(3)}) rotate(${(this.side * TWIST_DEG * this.kick).toFixed(2)}deg)`;
  }
}
