import type { InstancedMesh } from 'three';
import { FX, WEAPONS, WEAPON_IDS } from '@tidebreaker/shared';
import type { ProjectileSet, ProjectileVisual, WeaponDef } from '@tidebreaker/shared';

const HEIGHT = 1.2;
/** Mesh indices in the order given by createProjectileMeshes (bullet, shell, rocket, missile, heavy rocket). */
const ROCKET_MESH = 2;
const MISSILE_MESH = 3;
const HEAVY_MESH = 4;

/** Writes projectile transforms straight into the instance buffers (no allocation per frame). */
export class ProjectileView {
  private readonly meshes: readonly InstancedMesh[];
  /** mesh index -> how much a damage level thickens the body */
  private readonly thickenOfMesh = new Float32Array(5);
  /** weapon index -> mesh index */
  private readonly meshOfWeapon: Uint8Array;
  private readonly counts: Int32Array;
  /** weapon index -> visual size (1 = normal) */
  private readonly sizeOfWeapon: Float32Array;
  /** weapon index -> max range, to turn the remaining distance into a flight fraction */
  private readonly rangeOfWeapon: Float32Array;

  constructor(meshes: readonly InstancedMesh[], order: readonly ProjectileVisual[]) {
    this.meshes = meshes;
    this.counts = new Int32Array(meshes.length);
    for (let m = 0; m < meshes.length; m++) {
      const v = order[m];
      this.thickenOfMesh[m] = v ? FX.power.thicken[v] : 0;
    }
    this.meshOfWeapon = new Uint8Array(WEAPON_IDS.length);
    this.rangeOfWeapon = new Float32Array(WEAPON_IDS.length);
    this.sizeOfWeapon = new Float32Array(WEAPON_IDS.length);
    for (let w = 0; w < WEAPON_IDS.length; w++) {
      this.rangeOfWeapon[w] = WEAPONS[WEAPON_IDS[w]!].range;
      this.sizeOfWeapon[w] = (WEAPONS[WEAPON_IDS[w]!] as WeaponDef).size ?? 1;
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
      const grown = 1 + this.thickenOfMesh[m]! * set.power[i]!;
      const size = this.sizeOfWeapon[set.weapon[i]!]!;
      const thick = grown * size;
      const long = (1 + (grown - 1) * 0.5) * size;
      // Rotation about y that turns local +x toward the velocity (sim y is world z).
      arr[o] = dx * long;
      arr[o + 2] = dy * long;
      arr[o + 5] = thick;
      arr[o + 8] = -dy * thick;
      arr[o + 10] = dx * thick;
      arr[o + 12] = set.x[i]! - vx * back;
      // (Everything flies level: rockets and missiles at their own height, no lobbed arc.)
      arr[o + 13] =
        m === MISSILE_MESH
          ? FX.missileTrail.height
          : m === HEAVY_MESH
            ? FX.heavyRocketHeight
            : m === ROCKET_MESH
              ? FX.rocketHeight
              : HEIGHT;
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
