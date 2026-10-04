/**
 * Fixed-timestep accumulator (GAME_DESIGN.md §10.5). Call `advance` once per rendered frame,
 * run the sim that many times, then render with `alpha` between the last two sim states.
 */
export class FixedStep {
  private accumulatorMs = 0;
  private readonly stepMs: number;
  private readonly maxSteps: number;

  constructor(stepMs: number, maxSteps = 3) {
    this.stepMs = stepMs;
    this.maxSteps = maxSteps;
  }

  /** Returns how many sim steps to run. Backlog beyond `maxSteps` is dropped (no spiral of death). */
  advance(frameMs: number): number {
    this.accumulatorMs += frameMs > 0 ? frameMs : 0;
    let steps = 0;
    while (this.accumulatorMs >= this.stepMs && steps < this.maxSteps) {
      this.accumulatorMs -= this.stepMs;
      steps++;
    }
    if (this.accumulatorMs >= this.stepMs) this.accumulatorMs = 0;
    return steps;
  }

  /** Fraction [0, 1) of the next step already elapsed. */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }
}
