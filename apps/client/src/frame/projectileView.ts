import type { InstancedMesh } from 'three';
import type { ProjectileSet } from '@tidebreaker/shared';

const HEIGHT = 1.2;

/** Writes projectile positions straight into the instance buffer (no allocation per frame). */
export class ProjectileView {
  private readonly mesh: InstancedMesh;

  constructor(mesh: InstancedMesh) {
    this.mesh = mesh;
  }

  /** Positions are rendered between the previous and current sim step using `alpha`. */
  update(set: ProjectileSet, stepSec: number, alpha: number): void {
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    const back = stepSec * (1 - alpha);
    let j = 0;
    for (let i = 0; i < set.highWater; i++) {
      if (set.active[i] === 0) continue;
      const o = j * 16;
      arr[o + 12] = set.x[i]! - set.vx[i]! * back;
      arr[o + 13] = HEIGHT;
      arr[o + 14] = set.y[i]! - set.vy[i]! * back;
      j++;
    }
    this.mesh.count = j;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
