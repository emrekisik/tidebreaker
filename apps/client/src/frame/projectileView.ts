import type { InstancedMesh } from 'three';
import { rocketHeight, rocketPitch } from './rocketArc.ts';
import { FX, WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import type { ProjectileSet, ProjectileVisual } from '@tidebreaker/shared';

const HEIGHT = 1.2;
/** Index of the rocket mesh in the order given by createProjectileMeshes (bullet, shell, rocket). */
const ROCKET_MESH = 2;

/** Writes projectile transforms straight into the instance buffers (no allocation per frame). */
export class ProjectileView {
  private readonly meshes: readonly InstancedMesh[];
  /** mesh index -> how much a damage level thickens the body */
  private readonly thickenOfMesh = new Float32Array(3);
  /** weapon index -> mesh index */
  private readonly meshOfWeapon: Uint8Array;
  private readonly counts: Int32Array;
  /** weapon index -> max range, to turn the remaining distance into a flight fraction */
  private readonly rangeOfWeapon: Float32Array;

  constructor(meshes: readonly InstancedMesh[], order: readonly ProjectileVisual[]) {
    this.meshes = meshes;
    this.counts = new Int32Array(meshes.length);
    for (let m = 0; m < 3; m++) {
      const v = order[m];
      this.thickenOfMesh[m] = v ? FX.power.thicken[v] : 0;
    }
    this.meshOfWeapon = new Uint8Array(WEAPON_IDS.length);
    this.rangeOfWeapon = new Float32Array(WEAPON_IDS.length);
    for (let w = 0; w < WEAPON_IDS.length; w++) {
      this.rangeOfWeapon[w] = WEAPONS[WEAPON_IDS[w]!].range;
      this.meshOfWeapon[w] = Math.max(0, order.indexOf(WEAPONS[WEAPON_IDS[w]!].visual));
    }
  }

  /** Draws one set (offline sandbox). */
  update(set: ProjectileSet, stepSec: number, alpha: number): void {
    this.begin();
    this.add(set, stepSec, alpha);
    this.end();
  }

  /** Starts a frame that draws several sets (online: other players' shots and your own). */
  begin(): void {
    this.counts.fill(0);
  }

  /** Positions are rendered between the previous and current sim step using `alpha`. */
  add(set: ProjectileSet, stepSec: number, alpha: number): void {
    const back = stepSec * (1 - alpha);
    for (let i = 0; i < set.highWater; i++) {
      if (set.active[i] === 0) continue;
      const m = this.meshOfWeapon[set.weapon[i]!]!;
      const arr = this.meshes[m]!.instanceMatrix.array as Float32Array;
      const c = this.counts[m]!;
      this.counts[m] = c + 1;
      const o = c * 16;
      const vx = set.vx[i]!;
      const vy = set.vy[i]!;
      const speed = Math.sqrt(vx * vx + vy * vy) || 1;
      const dx = vx / speed;
      const dy = vy / speed;
      // Shots of a ship with the damage upgrade are thicker (and a little longer).
      const thick = 1 + this.thickenOfMesh[m]! * set.power[i]!;
      const long = 1 + (thick - 1) * 0.5;
      if (m === ROCKET_MESH) {
        // Lobbed flight: climb a little, then drop; the nose follows the arc.
        const w = set.weapon[i]!;
        // Remaining distance as it was `back` seconds ago, so the arc moves smoothly.
        const u = 1 - (set.remaining[i]! + speed * back) / this.rangeOfWeapon[w]!;
        const pitch = rocketPitch(u, this.rangeOfWeapon[w]!);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const fx = cp * dx;
        const fy = sp;
        const fz = cp * dy;
        const ux = -sp * dx;
        const uy = cp;
        const uz = -sp * dy;
        arr[o] = fx * long;
        arr[o + 1] = fy * long;
        arr[o + 2] = fz * long;
        arr[o + 4] = ux * thick;
        arr[o + 5] = uy * thick;
        arr[o + 6] = uz * thick;
        arr[o + 8] = (fy * uz - fz * uy) * thick;
        arr[o + 9] = (fz * ux - fx * uz) * thick;
        arr[o + 10] = (fx * uy - fy * ux) * thick;
        arr[o + 12] = set.x[i]! - vx * back;
        arr[o + 13] = rocketHeight(u);
        arr[o + 14] = set.y[i]! - vy * back;
        continue;
      }
      // Rotation about y that turns local +x toward the velocity (sim y is world z).
      arr[o] = dx * long;
      arr[o + 2] = dy * long;
      arr[o + 5] = thick;
      arr[o + 8] = -dy * thick;
      arr[o + 10] = dx * thick;
      arr[o + 12] = set.x[i]! - vx * back;
      arr[o + 13] = HEIGHT;
      arr[o + 14] = set.y[i]! - vy * back;
    }
  }

  end(): void {
    for (let m = 0; m < this.meshes.length; m++) {
      const mesh = this.meshes[m]!;
      mesh.count = this.counts[m]!;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, this.counts[m]! * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
