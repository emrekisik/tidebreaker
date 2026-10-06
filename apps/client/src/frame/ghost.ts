const MAX_CHUNKS = 48;
/** Every point of damage waits this long as white, then drains away on its own. */
const HOLD_SEC = 0.1;
/** Time a chunk takes to drain completely once its wait is over (slow and smooth). */
const DRAIN_SEC = 0.9;

/**
 * The white "recently lost" part of a health bar (Dota 2 style). Each damage hit becomes its own
 * chunk with its own timer, so constant incoming damage keeps shrinking old chunks instead of
 * piling up. `update` returns where the white region ends (>= the real value).
 */
export class GhostTracker {
  private readonly len = new Float32Array(MAX_CHUNKS);
  private readonly hold = new Float32Array(MAX_CHUNKS);
  private readonly rate = new Float32Array(MAX_CHUNKS);
  private last = 1;

  reset(frac: number): void {
    this.len.fill(0);
    this.last = frac;
  }

  update(frac: number, dtSec: number): number {
    const drop = this.last - frac;
    if (drop > 1e-4) {
      this.push(drop);
    } else if (drop < -0.3) {
      // A big jump up means a respawn or a class switch: start clean.
      this.len.fill(0);
    }
    this.last = frac;

    let total = 0;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      if (this.len[i]! <= 0) continue;
      if (this.hold[i]! > 0) {
        this.hold[i] = this.hold[i]! - dtSec;
      } else {
        this.len[i] = Math.max(0, this.len[i]! - this.rate[i]! * dtSec);
      }
      total += this.len[i]!;
    }
    return Math.min(1, frac + total);
  }

  private push(size: number): void {
    let slot = -1;
    let smallest = 0;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      if (this.len[i]! <= 0) {
        slot = i;
        break;
      }
      if (slot < 0 || this.len[i]! < this.len[smallest]!) smallest = i;
    }
    if (slot < 0) {
      // All slots busy (very rapid fire): fold the new damage into the smallest chunk.
      // The merged chunk keeps its own timer, so a flood of hits cannot keep it from draining.
      slot = smallest;
      this.len[slot] = this.len[slot]! + size;
    } else {
      this.len[slot] = size;
      this.hold[slot] = HOLD_SEC;
    }
    this.rate[slot] = this.len[slot]! / DRAIN_SEC;
  }
}
