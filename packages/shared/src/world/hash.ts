import type { WorldMap } from './types.ts';

/**
 * 32-bit FNV-1a hash of everything in the map (quantized to 1/16 unit). The determinism test pins
 * this value per seed, so any change in generation (or an engine difference) shows up at once.
 */
export function mapHash(map: WorldMap): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    // Four bytes of the (signed) integer value.
    for (let i = 0; i < 4; i++) {
      h ^= (v >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  const q = (v: number): number => Math.round(v * 16) | 0;
  mix(map.islandCount);
  mix(map.reefCount);
  for (let i = 0; i < map.islandCount; i++) {
    mix(map.islandType[i]!);
    mix(q(map.islandX[i]!));
    mix(q(map.islandY[i]!));
    mix(q(map.islandR[i]!));
    for (let k = map.vertStart[i]! * 2; k < map.vertStart[i + 1]! * 2; k++) mix(q(map.verts[k]!));
  }
  for (let i = 0; i < map.reefCount; i++) {
    mix(q(map.reefX[i]!));
    mix(q(map.reefY[i]!));
    mix(q(map.reefR[i]!));
  }
  return h >>> 0;
}
