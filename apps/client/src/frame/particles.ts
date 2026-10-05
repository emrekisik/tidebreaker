import type { ParticleBuffers } from '../render/particleKit.ts';

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

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
  private readonly col: Float32Array; // r0 g0 b0 r1 g1 b1
  private readonly a0: Float32Array;
  private readonly a1: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  /** Lowest allowed y (debris disappears once it sinks below it). */
  private readonly floorY: number;

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
    this.col = new Float32Array(n * 6);
    this.a0 = new Float32Array(n);
    this.a1 = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
  }

  /** Colors are sRGB hex (converted to linear once here, then blended in linear space). */
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
    const o = i * 6;
    this.col[o] = srgbToLinear(((hex0 >> 16) & 255) / 255);
    this.col[o + 1] = srgbToLinear(((hex0 >> 8) & 255) / 255);
    this.col[o + 2] = srgbToLinear((hex0 & 255) / 255);
    this.col[o + 3] = srgbToLinear(((hex1 >> 16) & 255) / 255);
    this.col[o + 4] = srgbToLinear(((hex1 >> 8) & 255) / 255);
    this.col[o + 5] = srgbToLinear((hex1 & 255) / 255);
    this.a0[i] = alpha0;
    this.a1[i] = alpha1;
    this.rot[i] = 0;
    this.spin[i] = spin;
  }

  update(dt: number): void {
    const mat = this.buf.mesh.instanceMatrix.array as Float32Array;
    const colAttr = this.buf.color.array as Float32Array;
    const alphaAttr = this.buf.alpha.array as Float32Array;
    const rotates = this.buf.rotates;
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
        continue;
      }

      const u = age / life;
      const size = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * u;
      const m = j * 16;
      if (rotates) {
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
      } else {
        mat[m] = size;
        mat[m + 5] = size;
        mat[m + 10] = size;
      }
      mat[m + 12] = this.x[i]!;
      mat[m + 13] = this.y[i]!;
      mat[m + 14] = this.z[i]!;

      const c = i * 6;
      const k = j * 3;
      colAttr[k] = this.col[c]! + (this.col[c + 3]! - this.col[c]!) * u;
      colAttr[k + 1] = this.col[c + 1]! + (this.col[c + 4]! - this.col[c + 1]!) * u;
      colAttr[k + 2] = this.col[c + 2]! + (this.col[c + 5]! - this.col[c + 2]!) * u;
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
