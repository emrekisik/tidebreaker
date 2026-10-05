import { MODE_STREAK, MODE_TUMBLE } from '../render/particleKit.ts';
import type { ParticleBuffers } from '../render/particleKit.ts';

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LANDED_MAX = 24;

/**
 * Fixed-size particle pool (struct of arrays) feeding one InstancedMesh. Spawning recycles the
 * oldest slot when full, and nothing is allocated after construction.
 */
export class ParticlePool {
  private readonly buf: ParticleBuffers;
  private readonly cap: number;
  private cursor = 0;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly col: Float32Array; // start rgb, middle rgb, end rgb
  private readonly a0: Float32Array;
  private readonly a1: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  /** Lowest allowed y (a particle that sinks below it ends). */
  private readonly floorY: number;
  /** Where tumbling particles hit the water this frame (x, z pairs); read, then reset the count. */
  readonly landed = new Float32Array(LANDED_MAX * 2);
  landedCount = 0;

  constructor(buf: ParticleBuffers, floorY: number) {
    this.buf = buf;
    this.floorY = floorY;
    const n = buf.mesh.instanceMatrix.count;
    this.cap = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.col = new Float32Array(n * 9);
    this.a0 = new Float32Array(n);
    this.a1 = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
  }

  /**
   * Colors are sRGB hex, converted to linear once here and blended in linear space. `hexMid`
   * adds a middle color stop (fire: white-hot -> orange -> dark); pass -1 for a plain blend.
   */
  spawn(
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    gravity: number,
    drag: number,
    hex0: number,
    hex1: number,
    alpha0: number,
    alpha1: number,
    spin: number,
    hexMid = -1,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    this.x[i] = px;
    this.y[i] = py;
    this.z[i] = pz;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    const o = i * 9;
    const r0 = srgbToLinear(((hex0 >> 16) & 255) / 255);
    const g0 = srgbToLinear(((hex0 >> 8) & 255) / 255);
    const b0 = srgbToLinear((hex0 & 255) / 255);
    const r1 = srgbToLinear(((hex1 >> 16) & 255) / 255);
    const g1 = srgbToLinear(((hex1 >> 8) & 255) / 255);
    const b1 = srgbToLinear((hex1 & 255) / 255);
    this.col[o] = r0;
    this.col[o + 1] = g0;
    this.col[o + 2] = b0;
    if (hexMid < 0) {
      this.col[o + 3] = (r0 + r1) * 0.5;
      this.col[o + 4] = (g0 + g1) * 0.5;
      this.col[o + 5] = (b0 + b1) * 0.5;
    } else {
      this.col[o + 3] = srgbToLinear(((hexMid >> 16) & 255) / 255);
      this.col[o + 4] = srgbToLinear(((hexMid >> 8) & 255) / 255);
      this.col[o + 5] = srgbToLinear((hexMid & 255) / 255);
    }
    this.col[o + 6] = r1;
    this.col[o + 7] = g1;
    this.col[o + 8] = b1;
    this.a0[i] = alpha0;
    this.a1[i] = alpha1;
    this.rot[i] = 0;
    this.spin[i] = spin;
  }

  update(dt: number): void {
    const mat = this.buf.mesh.instanceMatrix.array as Float32Array;
    const colAttr = this.buf.color.array as Float32Array;
    const alphaAttr = this.buf.alpha.array as Float32Array;
    const mode = this.buf.mode;
    let j = 0;
    for (let i = 0; i < this.cap; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const age = this.age[i]! + dt;
      if (age >= life) {
        this.life[i] = 0;
        continue;
      }
      this.age[i] = age;

      this.vy[i] = this.vy[i]! - this.grav[i]! * dt;
      const keep = Math.max(0, 1 - this.drag[i]! * dt);
      this.vx[i] = this.vx[i]! * keep;
      this.vz[i] = this.vz[i]! * keep;
      if (this.drag[i]! > 0) this.vy[i] = this.vy[i]! * keep;
      this.x[i] = this.x[i]! + this.vx[i]! * dt;
      this.y[i] = this.y[i]! + this.vy[i]! * dt;
      this.z[i] = this.z[i]! + this.vz[i]! * dt;
      if (this.y[i]! < this.floorY) {
        this.life[i] = 0;
        if (mode === MODE_TUMBLE && this.landedCount < LANDED_MAX) {
          this.landed[this.landedCount * 2] = this.x[i]!;
          this.landed[this.landedCount * 2 + 1] = this.z[i]!;
          this.landedCount++;
        }
        continue;
      }

      const u = age / life;
      const size = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * u;
      const m = j * 16;
      if (mode === MODE_TUMBLE) {
        const a = (this.rot[i] = this.rot[i]! + this.spin[i]! * dt);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const cb = Math.cos(a * 0.7);
        const sb = Math.sin(a * 0.7);
        mat[m] = ca * size;
        mat[m + 1] = 0;
        mat[m + 2] = -sa * size;
        mat[m + 4] = sa * sb * size;
        mat[m + 5] = cb * size;
        mat[m + 6] = ca * sb * size;
        mat[m + 8] = sa * cb * size;
        mat[m + 9] = -sb * size;
        mat[m + 10] = ca * cb * size;
      } else if (mode === MODE_STREAK) {
        // Long axis along the velocity; faster particles stretch more.
        const vx = this.vx[i]!;
        const vy = this.vy[i]!;
        const vz = this.vz[i]!;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp < 0.05) {
          mat[m] = size;
          mat[m + 1] = 0;
          mat[m + 2] = 0;
          mat[m + 4] = 0;
          mat[m + 5] = size;
          mat[m + 6] = 0;
          mat[m + 8] = 0;
          mat[m + 9] = 0;
          mat[m + 10] = size;
        } else {
          const stretch = Math.min(5, 1 + sp * 0.22);
          const xx = vx / sp;
          const xy = vy / sp;
          const xz = vz / sp;
          // y axis: world up made perpendicular to x (falls back to z when moving straight up).
          let yx = -xx * xy;
          let yy = 1 - xy * xy;
          let yz = -xz * xy;
          const yl = Math.sqrt(yx * yx + yy * yy + yz * yz);
          if (yl < 1e-4) {
            yx = 0;
            yy = 0;
            yz = 1;
          } else {
            yx /= yl;
            yy /= yl;
            yz /= yl;
          }
          const zx = xy * yz - xz * yy;
          const zy = xz * yx - xx * yz;
          const zz = xx * yy - xy * yx;
          const sx = size * stretch;
          mat[m] = xx * sx;
          mat[m + 1] = xy * sx;
          mat[m + 2] = xz * sx;
          mat[m + 4] = yx * size;
          mat[m + 5] = yy * size;
          mat[m + 6] = yz * size;
          mat[m + 8] = zx * size;
          mat[m + 9] = zy * size;
          mat[m + 10] = zz * size;
        }
      } else {
        mat[m] = size;
        mat[m + 5] = size;
        mat[m + 10] = size;
      }
      mat[m + 12] = this.x[i]!;
      mat[m + 13] = this.y[i]!;
      mat[m + 14] = this.z[i]!;

      // Three color stops: start -> middle (first half of life) -> end (second half).
      const c = i * 9;
      const k = j * 3;
      const h = u < 0.5 ? 0 : 3;
      const f = u < 0.5 ? u * 2 : (u - 0.5) * 2;
      colAttr[k] = this.col[c + h]! + (this.col[c + h + 3]! - this.col[c + h]!) * f;
      colAttr[k + 1] = this.col[c + h + 1]! + (this.col[c + h + 4]! - this.col[c + h + 1]!) * f;
      colAttr[k + 2] = this.col[c + h + 2]! + (this.col[c + h + 5]! - this.col[c + h + 2]!) * f;
      alphaAttr[j] = this.a0[i]! + (this.a1[i]! - this.a0[i]!) * u;
      j++;
    }

    const mesh = this.buf.mesh;
    mesh.count = j;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, j * 16);
    mesh.instanceMatrix.needsUpdate = true;
    this.buf.color.clearUpdateRanges();
    this.buf.color.addUpdateRange(0, j * 3);
    this.buf.color.needsUpdate = true;
    this.buf.alpha.clearUpdateRanges();
    this.buf.alpha.addUpdateRange(0, j);
    this.buf.alpha.needsUpdate = true;
  }
}
