import { CHANNEL } from '../config/world.ts';
import { Mulberry32 } from '../math/rng.ts';

const Q = 16;

function quant(v: number): number {
  return Math.round(v * Q) / Q;
}

/** A round rock of a channel wall (an obstacle like a reef). */
export interface ChannelRock {
  x: number;
  y: number;
  r: number;
}

/** The lane's middle line at fraction `u` (0 = west end, 1 = east end): writes x, y and the unit direction (tx, ty) to `out[0..4)`. */
function laneInto(u: number, out: Float64Array): void {
  const C = CHANNEL;
  out[0] = C.x - C.length / 2 + C.length * u;
  out[1] = C.y - C.bow * Math.sin(Math.PI * u);
  // Slope of the arch.
  const dy = (-C.bow * Math.PI * Math.cos(Math.PI * u)) / C.length;
  const len = Math.hypot(1, dy);
  out[2] = 1 / len;
  out[3] = dy / len;
}

const scratch = new Float64Array(4);

/** The lane's middle line at fraction `u` as an object (for setup code; the per-tick code uses `channelPointInto`). */
function lane(u: number): { x: number; y: number; tx: number; ty: number } {
  laneInto(u, scratch);
  return { x: scratch[0]!, y: scratch[1]!, tx: scratch[2]!, ty: scratch[3]! };
}

let cachedRocks: readonly ChannelRock[] | null = null;
let cachedMiddle: readonly { x: number; y: number }[] | null = null;

/**
 * The rocks of both walls, west to east, a pair (one each side) at every step. Fixed by `CHANNEL` alone (the same
 * channel on every map); the rocks' sizes come from a fixed seed. Built once.
 */
export function channelRocks(): readonly ChannelRock[] {
  if (cachedRocks) return cachedRocks;
  const C = CHANNEL;
  const rng = new Mulberry32(0xc4a77e1);
  const steps = Math.max(1, Math.round(C.length / C.rock.spacing));
  const rocks: ChannelRock[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = lane(i / steps);
    for (const side of [-1, 1]) {
      const r = quant(C.rock.min + (C.rock.max - C.rock.min) * rng.next());
      // The rock's inner edge is at least half the gap from the lane's middle line, so the lane never narrows.
      const off = C.gap / 2 + r + C.rock.ragged * rng.next();
      rocks.push({ x: quant(p.x - p.ty * side * off), y: quant(p.y + p.tx * side * off), r });
    }
  }
  cachedRocks = rocks;
  return rocks;
}

/**
 * A point on the lane's middle line at fraction `u` (0 = west end, 1 = east end; a little beyond either end is the
 * open water outside): writes `out[0] = x`, `out[1] = y` and `out[2]` = the direction (radians) the lane runs there.
 * Allocation-free, for the pirates' AI.
 */
export function channelPointInto(u: number, out: Float32Array): void {
  laneInto(u, scratch);
  out[0] = scratch[0]!;
  out[1] = scratch[1]!;
  out[2] = Math.atan2(scratch[3]!, scratch[2]!);
}

/** `count` points along the middle of the lane, evenly spread (where the gold floats). */
export function channelSpots(count: number): readonly { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (let k = 0; k < count; k++) {
    const p = lane((k + 0.5) / count);
    spots.push({ x: quant(p.x), y: quant(p.y) });
  }
  return spots;
}

/** How far the walls reach from the lane's middle line (the outer edge of the farthest rock). */
export const CHANNEL_REACH = CHANNEL.gap / 2 + 2 * CHANNEL.rock.max + CHANNEL.rock.ragged;

/**
 * Distance from (x, y) to the lane's middle line (sampled every few units, so a little over the true value). Placing
 * something needs this to be at least `CHANNEL_REACH + CHANNEL.clearance` plus its own radius.
 */
export function channelDistance(x: number, y: number): number {
  if (!cachedMiddle) {
    const pts: { x: number; y: number }[] = [];
    const n = Math.ceil(CHANNEL.length / 3);
    for (let i = 0; i <= n; i++) {
      const p = lane(i / n);
      pts.push({ x: p.x, y: p.y });
    }
    cachedMiddle = pts;
  }
  let best = Infinity;
  for (let i = 0; i < cachedMiddle.length; i++) {
    const p = cachedMiddle[i]!;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < best) best = d;
  }
  return best;
}
