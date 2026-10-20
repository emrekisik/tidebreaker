import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { Mulberry32 } from '@tidebreaker/shared';

/** Tiles per side of the atlas (2 x 2 = four different clouds, picked per particle by its instance index). */
export const CLOUD_TILES = 2;

const TILE = 128;
const SIZE = TILE * CLOUD_TILES;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise on a lattice of `n` cells that wraps (so a tile has no seam), 0..1. */
function makeLattice(n: number, rng: Mulberry32): Float32Array {
  const a = new Float32Array(n * n);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return a;
}

function sample(lat: Float32Array, n: number, x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = smooth(x - fx);
  const ty = smooth(y - fy);
  const x0 = ((fx % n) + n) % n;
  const y0 = ((fy % n) + n) % n;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const a = lat[y0 * n + x0]! * (1 - tx) + lat[y0 * n + x1]! * tx;
  const b = lat[y1 * n + x0]! * (1 - tx) + lat[y1 * n + x1]! * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Four soft, billowy cloud sprites in one texture (red channel = density), drawn once at start-up from a
 * seed: fractal noise bent by a second noise (so it curls), shaped into a puff that fades to nothing at the
 * edge. Used for smoke and flames, which tint it, so no image file is needed.
 */
export function createCloudAtlas(seed = 0x5eed): DataTexture {
  const rng = new Mulberry32(seed);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const octaves = 4;
  const lattices: Float32Array[] = [];
  for (let o = 0; o < octaves; o++) lattices.push(makeLattice(4 << o, rng));
  const warp = makeLattice(6, rng);
  for (let tile = 0; tile < CLOUD_TILES * CLOUD_TILES; tile++) {
    const ox = (tile % CLOUD_TILES) * TILE;
    const oy = Math.floor(tile / CLOUD_TILES) * TILE;
    // Each tile reads another part of the noise so the four puffs differ.
    const shiftX = rng.next() * 40;
    const shiftY = rng.next() * 40;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const u = px / TILE;
        const v = py / TILE;
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        // Domain warp: the lookup point is pushed around by a slow noise.
        const wx = (sample(warp, 6, u * 3 + shiftX, v * 3 + shiftY) - 0.5) * 0.6;
        const wy = (sample(warp, 6, u * 3 + shiftY, v * 3 + shiftX + 7) - 0.5) * 0.6;
        let n = 0;
        let amp = 0.55;
        let total = 0;
        for (let o = 0; o < octaves; o++) {
          const cells = 4 << o;
          n += amp * sample(lattices[o]!, cells, (u + wx) * cells * 0.5 + shiftX, (v + wy) * cells * 0.5 + shiftY);
          total += amp;
          amp *= 0.55;
        }
        n /= total;
        // A puff: dense in the middle, and toward the rim only the strongest noise survives, so the edge breaks up
        // into ragged tongues instead of a smooth disc.
        const nc = Math.min(1, Math.max(0, (n - 0.25) / 0.5));
        const thr = Math.min(1, r) * 0.62;
        const d = smooth(Math.min(1, Math.max(0, (nc * 1.2 - thr) / 0.5)));
        const edge = 1 - smooth(Math.min(1, Math.max(0, (r - 0.86) / 0.14)));
        const value = Math.round(255 * d * edge);
        const i = ((oy + py) * SIZE + ox + px) * 4;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
    }
  }
  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  tex.colorSpace = NoColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
