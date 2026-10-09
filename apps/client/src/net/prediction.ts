import {
  DEG2RAD,
  STEP_SEC,
  applyWorldBounds,
  collideIslands,
  createShipState,
  stepShip,
} from '@tidebreaker/shared';
import type { IslandSink, SelfState, ShipDef, ShipState, WorldMap } from '@tidebreaker/shared';

const HISTORY = 64;
/** Errors below this are invisible; above it they are blended away; above SNAP they teleport (§10.5). */
export const IGNORE_ERROR = 0.05;
export const SNAP_ERROR = 5;
/** Time constant of the visual correction: the offset is mostly gone after ~100 ms. */
const BLEND_SEC = 0.04;

const noIslandSink: IslandSink = { onIslandHit() {} };

/** Sequence numbers wrap at 65536: the signed distance from `b` to `a`. */
export function seqDiff(a: number, b: number): number {
  return ((a - b) << 16) >> 16;
}

/**
 * Client-side prediction of the player's own ship (GAME_DESIGN.md §10.5): inputs are applied to
 * the local ship immediately with the same shared code the server runs. When a snapshot arrives,
 * the server's state replaces ours and the inputs it has not seen yet are replayed on top. The
 * difference (error) is hidden in a short visual offset, or the ship teleports if it is large.
 */
export class Predictor {
  readonly state: ShipState;
  def: ShipDef;
  private readonly land: WorldMap;
  private readonly id: number;
  private readonly seqs = new Uint16Array(HISTORY);
  private readonly steers = new Float32Array(HISTORY);
  private readonly throttles = new Float32Array(HISTORY);
  private head = 0;
  private size = 0;
  /** Visual correction still to be blended out (world units). */
  offsetX = 0;
  offsetY = 0;
  /** Size of the last correction, for the debug HUD. */
  lastError = 0;
  /** Largest correction of the last second. */
  peakError = 0;
  /** When false (sunk), inputs are ignored and the ship stays where the server left it. */
  enabled = true;

  constructor(def: ShipDef, land: WorldMap, id: number) {
    this.def = def;
    this.land = land;
    this.id = id;
    this.state = createShipState(def, 0, 0, 0);
  }

  /** Puts the ship somewhere new (spawn, respawn): no history, no offset. */
  reset(x: number, y: number, heading: number): void {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.heading = heading;
    s.speed = 0;
    s.kx = 0;
    s.ky = 0;
    s.spin = 0;
    this.head = 0;
    this.size = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /** One fixed step with the controls that will also be sent to the server. */
  apply(seq: number, steer: number, throttle: number): void {
    if (this.enabled && this.state.alive) this.stepLocal(steer, throttle);
    const i = (this.head + this.size) % HISTORY;
    if (this.size < HISTORY) this.size++;
    else this.head = (this.head + 1) % HISTORY;
    this.seqs[i] = seq;
    this.steers[i] = steer;
    this.throttles[i] = throttle;
  }

  private stepLocal(steer: number, throttle: number): void {
    const def = this.def;
    stepShip(this.state, steer, throttle, def.vMax, def.turnRateDeg * DEG2RAD, STEP_SEC);
    collideIslands(this.land, this.state, def, this.id, noIslandSink);
    applyWorldBounds(this.state, STEP_SEC);
  }

  /** A snapshot arrived: the server's own-ship state and the last input it had processed. */
  reconcile(self: SelfState, lastInputSeq: number): void {
    const s = this.state;
    s.hull = self.hull;
    s.shield = self.shield;
    if (!this.enabled || !s.alive) {
      // A sunk ship does not move: just follow the server.
      s.x = self.x;
      s.y = self.y;
      s.heading = self.heading;
      return;
    }
    const oldX = s.x;
    const oldY = s.y;
    s.x = self.x;
    s.y = self.y;
    s.heading = self.heading;
    s.speed = self.speed;
    s.kx = self.kx;
    s.ky = self.ky;
    s.spin = self.spin;
    // Replay what the server has not processed yet, oldest first.
    for (let k = 0; k < this.size; k++) {
      const i = (this.head + k) % HISTORY;
      if (seqDiff(this.seqs[i]!, lastInputSeq) > 0)
        this.stepLocal(this.steers[i]!, this.throttles[i]!);
    }
    // Drop acknowledged inputs.
    while (this.size > 0 && seqDiff(this.seqs[this.head]!, lastInputSeq) <= 0) {
      this.head = (this.head + 1) % HISTORY;
      this.size--;
    }
    const ex = oldX - s.x;
    const ey = oldY - s.y;
    const err = Math.sqrt(ex * ex + ey * ey);
    this.lastError = err;
    if (err > this.peakError) this.peakError = err;
    if (err < IGNORE_ERROR || err > SNAP_ERROR) {
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      // Keep showing the ship where it was; the offset melts away over the next frames.
      this.offsetX += ex;
      this.offsetY += ey;
    }
  }

  /** Per rendered frame: melts the visual offset. */
  frame(dtSec: number): void {
    const k = Math.exp(-dtSec / BLEND_SEC);
    this.offsetX *= k;
    this.offsetY *= k;
  }
}
