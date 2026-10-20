import { Object3D } from 'three';
import type { InstancedMesh } from 'three';
import { FX, KIND, PICKUP_CAPACITY, PICKUP_ID_BASE } from '@tidebreaker/shared';
import { waveHeight, waveSlope } from '../render/waves.ts';

const slope = new Float32Array(2);
/** How strongly floating things lean with the swell (1 = exactly with the surface). */
const LEAN = 1.3;

/**
 * Everything floating in the sea that can be picked up. One `InstancedMesh` per kind (so four draw
 * calls however many there are); each item bobs on the waves. Nothing is allocated per frame.
 */
export class PickupView {
  private readonly meshes: InstancedMesh[];
  /** Compact list of the pickups currently shown. */
  private readonly ids = new Int16Array(PICKUP_CAPACITY).fill(-1);
  private readonly kinds = new Uint8Array(PICKUP_CAPACITY);
  private readonly looks = new Uint8Array(PICKUP_CAPACITY);
  private readonly xs = new Float32Array(PICKUP_CAPACITY);
  private readonly zs = new Float32Array(PICKUP_CAPACITY);
  /** Slot -> position in the compact list, -1 when absent. */
  private readonly where = new Int16Array(PICKUP_CAPACITY).fill(-1);
  private count = 0;
  /** Called for every floating pickup (not banknotes) with its position and radius: where it touches the water. */
  contact: ((x: number, z: number, radius: number) => void) | null = null;
  private readonly dummy = new Object3D();
  private readonly perKind = new Uint16Array(4);

  /** `meshes`: crates, barrels, chests and banknote piles, in that order (see makePickupMeshes). */
  constructor(meshes: InstancedMesh[]) {
    this.meshes = meshes;
  }

  /** A pickup appeared (an ENTER entry of kind crate, barrel, chest or banknote). */
  add(id: number, kind: number, look: number, x: number, y: number): void {
    const slot = id - PICKUP_ID_BASE;
    if (slot < 0 || slot >= PICKUP_CAPACITY) return;
    let at = this.where[slot]!;
    if (at < 0) {
      if (this.count >= PICKUP_CAPACITY) return;
      at = this.count++;
      this.where[slot] = at;
    }
    this.ids[at] = slot;
    this.kinds[at] = kind;
    this.looks[at] = look;
    this.xs[at] = x;
    this.zs[at] = y;
  }

  /** The pickup is gone (taken or expired). */
  remove(id: number): void {
    const slot = id - PICKUP_ID_BASE;
    if (slot < 0 || slot >= PICKUP_CAPACITY) return;
    const at = this.where[slot]!;
    if (at < 0) return;
    const last = --this.count;
    if (at !== last) {
      const moved = this.ids[last]!;
      this.ids[at] = moved;
      this.kinds[at] = this.kinds[last]!;
      this.looks[at] = this.looks[last]!;
      this.xs[at] = this.xs[last]!;
      this.zs[at] = this.zs[last]!;
      this.where[moved] = at;
    }
    this.where[slot] = -1;
    this.ids[last] = -1;
  }

  /** Forgets everything (a new match). */
  clear(): void {
    this.where.fill(-1);
    this.ids.fill(-1);
    this.count = 0;
  }

  /** Positions every item on the waves. */
  update(timeSec: number, focusX = 0, focusZ = 0): void {
    const d = this.dummy;
    this.perKind.fill(0);
    for (let i = 0; i < this.count; i++) {
      const k = this.kinds[i]!;
      const kindIdx = k === KIND.CRATE ? 0 : k === KIND.BARREL ? 1 : k === KIND.CHEST ? 2 : 3;
      const x = this.xs[i]!;
      const z = this.zs[i]!;
      const phase = this.ids[i]! * 1.7;
      const bob = Math.sin(timeSec * 1.5 + phase) * 0.17;
      // Floating things ride the swell (they sit low, partly under water); banknotes lie on top of it.
      let y = waveHeight(x, z, timeSec) * (kindIdx === 3 ? 0.5 : 0.9) + (kindIdx === 3 ? 0.35 : 0.12) + bob;
      let size = (this.meshes[kindIdx]!.userData['scale'] as number | undefined) ?? 1;
      if (kindIdx === 3) {
        // Banknote piles: bigger piles are bigger, and lie flat on the water.
        size *= 0.9 + this.looks[i]! * 0.35;
        y -= 0.2;
      } else if (kindIdx === 2) {
        y += 0.25;
        // A pirate's loot chest (the big look) is bigger than the ordinary treasure chests.
        if (this.looks[i]! === 3) size *= 1.2;
      }
      d.position.set(x, y, z);
      // (Only what is inside the foam map, which follows the camera focus.)
      if (kindIdx !== 3 && Math.abs(x - focusX) < 96 && Math.abs(z - focusZ) < 96) {
        this.contact?.(x, z, size * FX.pickupContact.radius);
      }
      if (kindIdx === 3) {
        d.rotation.set(
          Math.sin(timeSec * 1.1 + phase) * 0.12,
          timeSec * 0.5 + phase,
          Math.cos(timeSec * 0.9 + phase) * 0.12,
        );
      } else {
        // Lean with the water under it, plus a slow roll of its own, and drift a little around.
        waveSlope(x, z, timeSec, slope);
        d.rotation.set(
          -Math.atan(slope[1]!) * LEAN + Math.sin(timeSec * 1.3 + phase) * 0.1,
          phase + Math.sin(timeSec * 0.35 + phase) * 0.35,
          Math.atan(slope[0]!) * LEAN + Math.cos(timeSec * 1.05 + phase) * 0.1,
        );
      }
      d.scale.setScalar(size);
      d.updateMatrix();
      this.meshes[kindIdx]!.setMatrixAt(this.perKind[kindIdx]!++, d.matrix);
    }
    for (let m = 0; m < this.meshes.length; m++) {
      const mesh = this.meshes[m]!;
      mesh.count = this.perKind[m]!;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
