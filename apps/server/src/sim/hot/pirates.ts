import {
  DEG2RAD,
  MATCH,
  Mulberry32,
  PIRATE,
  PIRATE_COUNT,
  PIRATE_COVES,
  PIRATE_GARRISONS,
  PIRATE_TYPES,
  STEP_SEC,
  TAU,
  TEAM_PIRATE,
  WEAPONS,
  angleDiff,
  clamp,
  resetShipState,
  segmentVsWorld,
} from '@tidebreaker/shared';
import type { Combatant } from '@tidebreaker/shared';
import type { World } from './world.ts';

/** Pirate behavior states (GAME_DESIGN.md §8). */
const PATROL = 0;
const ENGAGE = 1;
const FLEE = 2;
const RETURN = 3;

const THINK_SEC = PIRATE.thinkEveryTicks * STEP_SEC;
const PI = Math.PI;
/** Rudder per radian of heading error, and the error above which a ship slows down to turn. */
const STEER_GAIN = 2.2;
const SHARP_TURN = 1.3;
/** A pirate waiting at its cove picks a new spot to sail to this often (seconds). */
const WANDER_MIN_SEC = 6;
const WANDER_RANGE_SEC = 6;

/**
 * The pirates of a room (GAME_DESIGN.md §7.2, §8): neutral ships hostile to both teams, each tied to
 * a cove. A pirate patrols near its cove, attacks the nearest player that comes close (never one
 * under a carrier's guns), runs home when it is losing or has strayed too far, and comes back some
 * time after being sunk. They use the same ship, weapon and collision code as players: the AI only
 * produces steering, throttle and aim. Plain data in typed arrays; lives in `hot/`, so no allocation.
 *
 * Pirates occupy the last entity slots of the world (`World.playerEnd` and up).
 */
export class Pirates {
  /** Index into `PIRATE_TYPES` of each pirate. */
  readonly type = new Uint8Array(PIRATE_COUNT);
  private readonly cove = new Uint8Array(PIRATE_COUNT);
  private readonly state = new Uint8Array(PIRATE_COUNT);
  /** Slot of the player being attacked, or -1. */
  private readonly target = new Int16Array(PIRATE_COUNT);
  private readonly lockLeft = new Float32Array(PIRATE_COUNT);
  private readonly wanderX = new Float32Array(PIRATE_COUNT);
  private readonly wanderY = new Float32Array(PIRATE_COUNT);
  private readonly wanderLeft = new Float32Array(PIRATE_COUNT);
  /** Which way the pirate circles its target (-1 or 1). */
  private readonly orbit = new Int8Array(PIRATE_COUNT);
  private readonly noise = new Float32Array(PIRATE_COUNT);
  /** 1 when nothing but water lies between the pirate and its target. */
  private readonly lineClear = new Uint8Array(PIRATE_COUNT);
  /** Heading the pirate wants to sail and the throttle for it. */
  private readonly want = new Float32Array(PIRATE_COUNT);
  private readonly cruise = new Float32Array(PIRATE_COUNT);
  /** Seconds until a sunk pirate returns (0 = afloat). */
  private readonly returnLeft = new Float32Array(PIRATE_COUNT);
  /** Per type: farthest distance it opens fire at, preferred fighting distance, shot speed. */
  private readonly fireRange = new Float32Array(PIRATE_TYPES.length);
  private readonly fightDist = new Float32Array(PIRATE_TYPES.length);
  private readonly shotSpeed = new Float32Array(PIRATE_TYPES.length);
  private readonly rng: Mulberry32;

  constructor(
    private readonly w: World,
    seed: number,
  ) {
    this.rng = new Mulberry32(seed ^ 0x7f4a7c15);
    let p = 0;
    for (let c = 0; c < PIRATE_GARRISONS.length; c++) {
      const crew = PIRATE_GARRISONS[c]!;
      for (let k = 0; k < crew.length; k++) {
        this.type[p] = crew[k]!;
        this.cove[p] = c;
        p++;
      }
    }
    for (let t = 0; t < PIRATE_TYPES.length; t++) {
      const def = PIRATE_TYPES[t]!;
      let range = Infinity;
      let speed = 0;
      for (let m = 0; m < def.def.mounts.length; m++) {
        const weapon = WEAPONS[def.def.mounts[m]!.weapon];
        range = Math.min(range, weapon.range);
        speed = Math.max(speed, weapon.projectileSpeed);
      }
      this.fireRange[t] = range;
      this.fightDist[t] = range * def.fightRange;
      this.shotSpeed[t] = speed;
    }
  }

  /** Slot of pirate `p`. */
  slotOf(p: number): number {
    return this.w.playerEnd + p;
  }

  /** Reload multiplier of the pirate in `slot` (above 1 = slower than the model's weapons). */
  reloadOf(slot: number): number {
    return PIRATE_TYPES[this.type[slot - this.w.playerEnd]!]!.reload;
  }

  /** The pirate ships join the world's combatant list once and stay there (dead ones are skipped). */
  join(): void {
    for (let p = 0; p < PIRATE_COUNT; p++) this.w.combatants.push(this.w.slots[this.slotOf(p)]!);
  }

  /** New round: every pirate is back at its cove. */
  reset(): void {
    for (let p = 0; p < PIRATE_COUNT; p++) this.spawn(p);
  }

  /** Pirate `p` went down (it returns after the type's respawn time). */
  onSunk(p: number): void {
    this.returnLeft[p] = PIRATE_TYPES[this.type[p]!]!.respawnSec;
    this.w.inFire[this.slotOf(p)] = 0;
  }

  private spawn(p: number): void {
    const w = this.w;
    const slot = this.slotOf(p);
    const t = PIRATE_TYPES[this.type[p]!]!;
    const cove = PIRATE_COVES[this.cove[p]!]!;
    const c = w.slots[slot]!;
    const a = this.rng.next() * TAU;
    const r = PIRATE.coveRadius * (0.15 + this.rng.next() * 0.5);
    c.def = t.def;
    c.team = TEAM_PIRATE;
    resetShipState(c.state, t.def, cove.x + Math.cos(a) * r, cove.y + Math.sin(a) * r, a + PI);
    w.used[slot] = 1;
    w.shipIdx[slot] = this.type[p]!;
    w.spawnGen[slot] = w.spawnGen[slot]! + 1;
    w.protectLeft[slot] = 0;
    w.inFire[slot] = 0;
    w.clearAssists(slot);
    this.state[p] = PATROL;
    this.target[p] = -1;
    this.lockLeft[p] = 0;
    this.wanderLeft[p] = 0;
    this.returnLeft[p] = 0;
    this.want[p] = c.state.heading;
    this.cruise[p] = 0.5;
    this.lineClear[p] = 0;
  }

  /** One tick: pirates return, think (a few per tick) and steer and shoot (every tick). */
  step(dt: number): void {
    const w = this.w;
    for (let p = 0; p < PIRATE_COUNT; p++) {
      const slot = this.slotOf(p);
      const c = w.slots[slot]!;
      if (!c.state.alive) {
        if (this.returnLeft[p]! > 0) {
          this.returnLeft[p] = this.returnLeft[p]! - dt;
          if (this.returnLeft[p]! <= 0) this.spawn(p);
        }
        continue;
      }
      if ((w.tick + p) % PIRATE.thinkEveryTicks === 0) this.think(p, c);
      this.act(p, slot, c);
    }
  }

  // ---- thinking (5 Hz)

  private think(p: number, c: Combatant): void {
    const w = this.w;
    const t = PIRATE_TYPES[this.type[p]!]!;
    const s = c.state;
    const cove = PIRATE_COVES[this.cove[p]!]!;
    const homeD = Math.hypot(s.x - cove.x, s.y - cove.y);
    let st: number = this.state[p]!;

    // Weak ships run for home when badly hurt and come back out when healed.
    const hullFrac = s.hull / c.def.hull;
    if (t.flees) {
      if (st !== FLEE && hullFrac < PIRATE.fleeHullPct) st = FLEE;
      else if (st === FLEE && hullFrac >= PIRATE.recoverHullPct) st = RETURN;
    }
    if (st === FLEE || st === RETURN) {
      this.target[p] = -1;
      if (st === RETURN && homeD < PIRATE.patrolRadius * 0.8) st = PATROL;
    } else {
      this.chooseTarget(p, t.detectRadius, s.x, s.y);
      if (homeD > PIRATE.leash) {
        this.target[p] = -1;
        st = RETURN;
      } else if (this.target[p]! >= 0) {
        st = ENGAGE;
      } else {
        st = homeD > PIRATE.patrolRadius * 1.2 ? RETURN : PATROL;
      }
    }
    this.state[p] = st;
    this.noise[p] = (this.rng.next() * 2 - 1) * PIRATE.aimErrorDeg * DEG2RAD;

    let want: number;
    let cruise: number;
    if (st === ENGAGE) {
      const ts = w.slots[this.target[p]!]!.state;
      const dx = ts.x - s.x;
      const dy = ts.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const bearing = Math.atan2(dy, dx);
      const desired = this.fightDist[this.type[p]!]!;
      const dir = this.orbit[p]!;
      if (d > desired * 1.2) {
        want = bearing;
        cruise = 1;
      } else if (d < desired * 0.6) {
        want = bearing + dir * 2.3;
        cruise = 0.85;
      } else {
        want = bearing + dir * (PI / 2);
        cruise = 0.7;
      }
      this.lineClear[p] = segmentVsWorld(w.land, s.x, s.y, ts.x, ts.y) < 0 ? 1 : 0;
    } else if (st === PATROL) {
      this.wanderLeft[p] = this.wanderLeft[p]! - THINK_SEC;
      if (
        this.wanderLeft[p]! <= 0 ||
        Math.hypot(this.wanderX[p]! - s.x, this.wanderY[p]! - s.y) < 8
      ) {
        const a = this.rng.next() * TAU;
        const r = PIRATE.patrolRadius * Math.sqrt(this.rng.next());
        this.wanderX[p] = cove.x + Math.cos(a) * r;
        this.wanderY[p] = cove.y + Math.sin(a) * r;
        this.wanderLeft[p] = WANDER_MIN_SEC + this.rng.next() * WANDER_RANGE_SEC;
      }
      want = Math.atan2(this.wanderY[p]! - s.y, this.wanderX[p]! - s.x);
      cruise = 0.55;
      this.lineClear[p] = 0;
    } else {
      want = Math.atan2(cove.y - s.y, cove.x - s.x);
      cruise = st === FLEE ? 1 : 0.85;
      this.lineClear[p] = 0;
    }

    // Stay out of the carriers' guns, whatever else is going on.
    for (let k = 0; k < MATCH.carriers.length; k++) {
      const base = MATCH.carriers[k]!;
      if (Math.hypot(s.x - base.x, s.y - base.y) < PIRATE.carrierAvoid * 0.85) {
        want = Math.atan2(s.y - base.y, s.x - base.x);
        cruise = 1;
      }
    }

    this.want[p] = this.openHeading(s.x, s.y, want, c.def.vMax, this.orbit[p]!);
    this.cruise[p] = cruise;
  }

  /**
   * Keeps the current target while it stays valid and the lock time runs; otherwise picks the
   * nearest valid player within `detect`.
   */
  private chooseTarget(p: number, detect: number, x: number, y: number): void {
    this.lockLeft[p] = this.lockLeft[p]! - THINK_SEC;
    let cur = this.target[p]!;
    if (cur >= 0 && !this.valid(cur, x, y, detect * PIRATE.loseTargetFactor)) cur = -1;
    if (cur < 0 || this.lockLeft[p]! <= 0) {
      const w = this.w;
      let best = -1;
      let bestD2 = detect * detect;
      for (let slot = MATCH.carriers.length; slot < w.playerEnd; slot++) {
        if (!this.valid(slot, x, y, detect)) continue;
        const ts = w.slots[slot]!.state;
        const d2 = (ts.x - x) * (ts.x - x) + (ts.y - y) * (ts.y - y);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = slot;
        }
      }
      if (best >= 0 && best !== cur) {
        cur = best;
        this.lockLeft[p] = PIRATE.targetLockSec;
        this.orbit[p] = this.rng.next() < 0.5 ? -1 : 1;
      }
    }
    this.target[p] = cur;
  }

  /** A player ship the pirates may attack: afloat, not protected, in range, away from the carriers. */
  private valid(slot: number, x: number, y: number, range: number): boolean {
    const w = this.w;
    if (w.used[slot] === 0 || w.ghostLeft[slot]! > 0 || w.protectLeft[slot]! > 0) return false;
    const ts = w.slots[slot]!.state;
    if (!ts.alive) return false;
    if ((ts.x - x) * (ts.x - x) + (ts.y - y) * (ts.y - y) > range * range) return false;
    for (let k = 0; k < MATCH.carriers.length; k++) {
      const base = MATCH.carriers[k]!;
      if (Math.hypot(ts.x - base.x, ts.y - base.y) < PIRATE.carrierAvoid) return false;
    }
    return true;
  }

  /** The wanted heading, or the nearest one to it with open water ahead (whisker test). */
  private openHeading(x: number, y: number, ang: number, vMax: number, side: number): number {
    const len = vMax * PIRATE.whiskerSec + 6;
    if (this.free(x, y, ang, len)) return ang;
    const step = (side === 0 ? 1 : side) * PIRATE.whiskerDeg * DEG2RAD;
    for (let k = 1; k <= 4; k++) {
      if (this.free(x, y, ang + k * step, len)) return ang + k * step;
      if (this.free(x, y, ang - k * step, len)) return ang - k * step;
    }
    return ang + PI;
  }

  private free(x: number, y: number, ang: number, len: number): boolean {
    return segmentVsWorld(this.w.land, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len) < 0;
  }

  // ---- acting (every tick)

  private act(p: number, slot: number, c: Combatant): void {
    const w = this.w;
    const s = c.state;
    const diff = angleDiff(this.want[p]!, s.heading);
    const slow = Math.abs(diff) > SHARP_TURN ? 0.45 : 1;
    w.moveShip(slot, clamp(diff * STEER_GAIN, -1, 1), this.cruise[p]! * slow);

    w.inFire[slot] = 0;
    const target = this.target[p]!;
    if (this.state[p] !== ENGAGE || target < 0) return;
    const ts = w.slots[target]!.state;
    if (!ts.alive) return;
    const dx = ts.x - s.x;
    const dy = ts.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // Lead the target: where it will be when the shot arrives.
    const flight = d / this.shotSpeed[this.type[p]!]!;
    const vx = Math.cos(ts.heading) * ts.speed + ts.kx;
    const vy = Math.sin(ts.heading) * ts.speed + ts.ky;
    w.inAim[slot] = Math.atan2(dy + vy * flight, dx + vx * flight) + this.noise[p]!;
    w.inAimDist[slot] = d;
    if (d < this.fireRange[this.type[p]!]! * 0.95 && this.lineClear[p] === 1) w.inFire[slot] = 1;
  }
}
