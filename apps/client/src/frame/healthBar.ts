import { Group, Mesh } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { BarKit } from '../render/barKit.ts';

const WIDTH = 5;
const HEIGHT_ABOVE_WATER = 4.2;
/** Lost health stays visible as a white chunk for this long, then drains away (like Dota 2). */
const GHOST_HOLD_SEC = 0.5;
const GHOST_DRAIN_PER_SEC = 0.9;

/** Camera-facing hull/shield bar floating above a ship. */
export class HealthBar {
  private readonly group = new Group();
  private readonly hull: Mesh;
  private readonly shield: Mesh;
  private readonly hullGhost: Mesh;
  private readonly shieldGhost: Mesh;
  /** Index 0 = hull, 1 = shield. */
  private readonly ghost = new Float32Array(2).fill(1);
  private readonly hold = new Float32Array(2);
  private readonly last = new Float32Array(2).fill(1);

  constructor(scene: Scene, kit: BarKit) {
    const bg = new Mesh(kit.bgGeo, kit.bgMat);
    this.hullGhost = new Mesh(kit.fillGeo, kit.ghostMat);
    this.shieldGhost = new Mesh(kit.fillGeo, kit.ghostMat);
    this.hull = new Mesh(kit.fillGeo, kit.hullMat);
    this.shield = new Mesh(kit.fillGeo, kit.shieldMat);
    bg.renderOrder = 10;
    this.hullGhost.renderOrder = 11;
    this.shieldGhost.renderOrder = 11;
    this.hull.renderOrder = 12;
    this.shield.renderOrder = 12;
    this.hull.position.set(0, -0.23, 0.01);
    this.hullGhost.position.set(0, -0.23, 0.005);
    this.shield.position.set(0, 0.23, 0.01);
    this.shieldGhost.position.set(0, 0.23, 0.005);
    this.group.add(bg, this.hullGhost, this.shieldGhost, this.hull, this.shield);
    scene.add(this.group);
  }

  update(
    camera: PerspectiveCamera,
    x: number,
    z: number,
    hullFrac: number,
    shieldFrac: number,
    visible: boolean,
    dtSec: number,
  ): void {
    this.group.visible = visible;
    if (!visible) {
      // Start the next life with a clean bar.
      this.ghost[0] = 1;
      this.ghost[1] = 1;
      this.last[0] = 1;
      this.last[1] = 1;
      return;
    }
    this.group.position.set(x, HEIGHT_ABOVE_WATER, z);
    this.group.quaternion.copy(camera.quaternion);
    this.fill(this.hull, hullFrac);
    this.fill(this.shield, shieldFrac);
    this.fill(this.hullGhost, this.trackGhost(0, hullFrac, dtSec));
    this.fill(this.shieldGhost, this.trackGhost(1, shieldFrac, dtSec));
  }

  /** The white "recently lost" part: waits after damage, then shrinks toward the real value. */
  private trackGhost(i: number, frac: number, dtSec: number): number {
    if (frac < this.last[i]! - 1e-4) this.hold[i] = GHOST_HOLD_SEC;
    this.last[i] = frac;
    let g = this.ghost[i]!;
    if (g <= frac) {
      g = frac;
    } else if (this.hold[i]! > 0) {
      this.hold[i] = this.hold[i]! - dtSec;
    } else {
      g = Math.max(frac, g - GHOST_DRAIN_PER_SEC * dtSec);
    }
    this.ghost[i] = g;
    return g;
  }

  private fill(mesh: Mesh, frac: number): void {
    const f = frac < 0.0001 ? 0.0001 : frac > 1 ? 1 : frac;
    mesh.scale.x = f;
    mesh.position.x = -(1 - f) * (WIDTH / 2);
  }
}
