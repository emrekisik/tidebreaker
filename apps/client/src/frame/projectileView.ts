import type { InstancedMesh } from 'three';
import { WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import type { ProjectileSet, ProjectileVisual } from '@tidebreaker/shared';

const HEIGHT = 1.2;

/** Writes projectile transforms straight into the instance buffers (no allocation per frame). */
export class ProjectileView {
  private readonly meshes: readonly InstancedMesh[];
  /** weapon index -> mesh index */
  private readonly meshOfWeapon: Uint8Array;
  private readonly counts: Int32Array;

  constructor(meshes: readonly InstancedMesh[], order: readonly ProjectileVisual[]) {
    this.meshes = meshes;
    this.counts = new Int32Array(meshes.length);
    this.meshOfWeapon = new Uint8Array(WEAPON_IDS.length);
    for (let w = 0; w < WEAPON_IDS.length; w++) {
      this.meshOfWeapon[w] = Math.max(0, order.indexOf(WEAPONS[WEAPON_IDS[w]!].visual));
    }
  }

  /** Positions are rendered between the previous and current sim step using `alpha`. */
  update(set: ProjectileSet, stepSec: number, alpha: number): void {
    const back = stepSec * (1 - alpha);
    this.counts.fill(0);
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
      // Rotation about y that turns local +x toward the velocity (sim y is world z).
      arr[o] = dx;
      arr[o + 2] = dy;
      arr[o + 8] = -dy;
      arr[o + 10] = dx;
      arr[o + 12] = set.x[i]! - vx * back;
      arr[o + 13] = HEIGHT;
      arr[o + 14] = set.y[i]! - vy * back;
    }
    for (let m = 0; m < this.meshes.length; m++) {
      const mesh = this.meshes[m]!;
      mesh.count = this.counts[m]!;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, this.counts[m]! * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
