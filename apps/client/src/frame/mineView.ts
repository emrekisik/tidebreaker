import { Object3D } from 'three';
import type { InstancedMesh } from 'three';
import { FX, MINE_CAPACITY, MINE_ID_BASE } from '@tidebreaker/shared';
import { waveHeight, waveSlope } from '../render/waves.ts';

const slope = new Float32Array(2);
/** Size of a mine (world units across). */
const SIZE = 2.8;

/**
 * The sea mines in the water: one instanced mesh per team (blue and red paint), each floating on the
 * waves like the other things in the sea. Nothing is allocated per frame.
 */
export class MineView {
  private readonly ids = new Int16Array(MINE_CAPACITY).fill(-1);
  private readonly teams = new Uint8Array(MINE_CAPACITY);
  private readonly xs = new Float32Array(MINE_CAPACITY);
  private readonly zs = new Float32Array(MINE_CAPACITY);
  /** Slot -> position in the compact list, -1 when absent. */
  private readonly where = new Int16Array(MINE_CAPACITY).fill(-1);
  private count = 0;
  private readonly dummy = new Object3D();
  private readonly perTeam = new Uint16Array(2);
  /** Called for every mine in view with its position and radius: where it touches the water (foam). */
  contact: ((x: number, z: number, radius: number) => void) | null = null;

  /** `meshes`: the blue and the red team's mine mesh, in that order (see `AssetProvider.createMineMesh`). */
  constructor(private readonly meshes: readonly InstancedMesh[]) {}

  /** The meshes, to add to the scene. */
  get meshList(): readonly InstancedMesh[] {
    return this.meshes;
  }

  /** A mine appeared (an ENTER entry of kind mine). */
  add(id: number, team: number, x: number, y: number): void {
    const slot = id - MINE_ID_BASE;
    if (slot < 0 || slot >= MINE_CAPACITY) return;
    let at = this.where[slot]!;
    if (at < 0) {
      if (this.count >= MINE_CAPACITY) return;
      at = this.count++;
      this.where[slot] = at;
    }
    this.ids[at] = slot;
    this.teams[at] = team === 0 ? 0 : 1;
    this.xs[at] = x;
    this.zs[at] = y;
  }

  /** The mine is gone (it went off, was shot, or ran out of time). */
  remove(id: number): void {
    const slot = id - MINE_ID_BASE;
    if (slot < 0 || slot >= MINE_CAPACITY) return;
    const at = this.where[slot]!;
    if (at < 0) return;
    const last = --this.count;
    if (at !== last) {
      const moved = this.ids[last]!;
      this.ids[at] = moved;
      this.teams[at] = this.teams[last]!;
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

  /** Positions every mine on the waves. */
  update(timeSec: number, focusX = 0, focusZ = 0): void {
    const d = this.dummy;
    this.perTeam.fill(0);
    for (let i = 0; i < this.count; i++) {
      const x = this.xs[i]!;
      const z = this.zs[i]!;
      const phase = this.ids[i]! * 2.3;
      const bob = Math.sin(timeSec * 1.4 + phase) * 0.15;
      d.position.set(x, waveHeight(x, z, timeSec) * 0.9 + 0.1 + bob, z);
      waveSlope(x, z, timeSec, slope);
      d.rotation.set(
        -Math.atan(slope[1]!) * 1.2 + Math.sin(timeSec * 1.1 + phase) * 0.08,
        phase + timeSec * 0.15,
        Math.atan(slope[0]!) * 1.2 + Math.cos(timeSec * 0.95 + phase) * 0.08,
      );
      d.scale.setScalar(SIZE);
      d.updateMatrix();
      const team = this.teams[i]!;
      this.meshes[team]!.setMatrixAt(this.perTeam[team]!++, d.matrix);
      if (Math.abs(x - focusX) < 96 && Math.abs(z - focusZ) < 96) {
        this.contact?.(x, z, SIZE * FX.pickupContact.radius);
      }
    }
    for (let m = 0; m < this.meshes.length; m++) {
      const mesh = this.meshes[m]!;
      mesh.count = this.perTeam[m]!;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
