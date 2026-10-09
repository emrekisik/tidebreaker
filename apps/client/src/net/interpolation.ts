import { lerp, lerpAngle } from '@tidebreaker/shared';

const CAPACITY = 32;
/** How long a ship may be extrapolated past its newest sample (GAME_DESIGN.md §10.1). */
export const EXTRAPOLATE_MAX_MS = 250;

/** A sampled pose of a remote ship. */
export interface PoseSample {
  x: number;
  y: number;
  heading: number;
  speed: number;
  hp: number;
  shield: number;
}

/**
 * The last few snapshots of one remote ship, indexed by server time (ms). The game shows the ship
 * at `now - 150 ms`, between two samples, so network jitter does not make it stutter. When data
 * runs out it is extrapolated along its heading for at most 250 ms, then it stops.
 */
export class SnapshotBuffer {
  private readonly t = new Float64Array(CAPACITY);
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly h = new Float32Array(CAPACITY);
  private readonly v = new Float32Array(CAPACITY);
  private readonly hp = new Float32Array(CAPACITY);
  private readonly sh = new Float32Array(CAPACITY);
  private start = 0;
  count = 0;

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  push(
    timeMs: number,
    x: number,
    y: number,
    heading: number,
    speed: number,
    hp: number,
    shield: number,
  ): void {
    // Out-of-order data (should not happen on TCP) is dropped.
    if (this.count > 0 && timeMs <= this.timeAt(this.count - 1)) return;
    let slot: number;
    if (this.count < CAPACITY) {
      slot = (this.start + this.count) % CAPACITY;
      this.count++;
    } else {
      slot = this.start;
      this.start = (this.start + 1) % CAPACITY;
    }
    this.t[slot] = timeMs;
    this.x[slot] = x;
    this.y[slot] = y;
    this.h[slot] = heading;
    this.v[slot] = speed;
    this.hp[slot] = hp;
    this.sh[slot] = shield;
  }

  private slot(i: number): number {
    return (this.start + i) % CAPACITY;
  }

  private timeAt(i: number): number {
    return this.t[this.slot(i)]!;
  }

  /** Time of the newest sample, or -Infinity when empty. */
  get newest(): number {
    return this.count === 0 ? -Infinity : this.timeAt(this.count - 1);
  }

  /** Writes the pose at server time `timeMs` into `out`. Returns false when there is no data. */
  sample(timeMs: number, out: PoseSample): boolean {
    const n = this.count;
    if (n === 0) return false;
    const first = this.slot(0);
    if (timeMs <= this.t[first]!) {
      this.copy(first, out);
      return true;
    }
    const lastIdx = this.slot(n - 1);
    if (timeMs >= this.t[lastIdx]!) {
      this.copy(lastIdx, out);
      // Keep going the way it was going, for a short while.
      const dt = Math.min(timeMs - this.t[lastIdx]!, EXTRAPOLATE_MAX_MS) / 1000;
      out.x += Math.cos(out.heading) * out.speed * dt;
      out.y += Math.sin(out.heading) * out.speed * dt;
      return true;
    }
    // Between two samples: find the last one at or before the time.
    let i = n - 2;
    while (i > 0 && this.timeAt(i) > timeMs) i--;
    const a = this.slot(i);
    const b = this.slot(i + 1);
    const span = this.t[b]! - this.t[a]!;
    const f = span > 0 ? (timeMs - this.t[a]!) / span : 1;
    out.x = lerp(this.x[a]!, this.x[b]!, f);
    out.y = lerp(this.y[a]!, this.y[b]!, f);
    out.heading = lerpAngle(this.h[a]!, this.h[b]!, f);
    out.speed = lerp(this.v[a]!, this.v[b]!, f);
    out.hp = lerp(this.hp[a]!, this.hp[b]!, f);
    out.shield = lerp(this.sh[a]!, this.sh[b]!, f);
    return true;
  }

  private copy(slot: number, out: PoseSample): void {
    out.x = this.x[slot]!;
    out.y = this.y[slot]!;
    out.heading = this.h[slot]!;
    out.speed = this.v[slot]!;
    out.hp = this.hp[slot]!;
    out.shield = this.sh[slot]!;
  }
}
