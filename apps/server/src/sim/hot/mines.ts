import { MINE, MINE_CAPACITY } from '@tidebreaker/shared';

/** The owner of a mine whose layer left the game (nobody is credited for it). */
export const NO_OWNER = 0xffff;

/**
 * The sea mines in the water (GAME_DESIGN.md §7.3c): plain data in typed arrays, one fixed slot per
 * mine, so nothing is allocated while the game runs. Lives in `hot/`: no allocation here.
 */
export class Mines {
  readonly active = new Uint8Array(MINE_CAPACITY);
  readonly x = new Float32Array(MINE_CAPACITY);
  readonly y = new Float32Array(MINE_CAPACITY);
  readonly team = new Uint8Array(MINE_CAPACITY);
  /** Slot of the player who laid it (`NO_OWNER` once that player left). */
  readonly owner = new Uint16Array(MINE_CAPACITY);
  readonly hp = new Float32Array(MINE_CAPACITY);
  /** Seconds until it is armed, and until it vanishes. */
  readonly arm = new Float32Array(MINE_CAPACITY);
  readonly life = new Float32Array(MINE_CAPACITY);
  /** Counts the mines a slot has held, so clients know when a slot holds a new mine. */
  readonly gen = new Uint16Array(MINE_CAPACITY);

  countOfTeam(team: number): number {
    let n = 0;
    for (let i = 0; i < MINE_CAPACITY; i++) if (this.active[i] === 1 && this.team[i] === team) n++;
    return n;
  }

  countOfOwner(owner: number): number {
    let n = 0;
    for (let i = 0; i < MINE_CAPACITY; i++) if (this.active[i] === 1 && this.owner[i] === owner) n++;
    return n;
  }

  /** The mine of `owner` with the least life left (its oldest), or -1. */
  oldestOf(owner: number): number {
    let best = -1;
    for (let i = 0; i < MINE_CAPACITY; i++) {
      if (this.active[i] === 0 || this.owner[i] !== owner) continue;
      if (best < 0 || this.life[i]! < this.life[best]!) best = i;
    }
    return best;
  }

  /** Lays a mine; returns its slot, or -1 when every slot is taken. */
  lay(x: number, y: number, team: number, owner: number): number {
    for (let i = 0; i < MINE_CAPACITY; i++) {
      if (this.active[i] === 1) continue;
      this.active[i] = 1;
      this.x[i] = x;
      this.y[i] = y;
      this.team[i] = team;
      this.owner[i] = owner;
      this.hp[i] = MINE.hp;
      this.arm[i] = MINE.armSec;
      this.life[i] = MINE.lifeSec;
      this.gen[i] = this.gen[i]! + 1;
      return i;
    }
    return -1;
  }

  remove(i: number): void {
    this.active[i] = 0;
  }

  /** The layer left the game: its mines stay but nobody is credited for them. */
  orphan(owner: number): void {
    for (let i = 0; i < MINE_CAPACITY; i++) if (this.owner[i] === owner) this.owner[i] = NO_OWNER;
  }

  /** Counts the timers down; mines that outlived their time vanish (quietly). */
  step(dt: number): void {
    for (let i = 0; i < MINE_CAPACITY; i++) {
      if (this.active[i] === 0) continue;
      if (this.arm[i]! > 0) this.arm[i] = this.arm[i]! - dt;
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) this.active[i] = 0;
    }
  }

  clear(): void {
    this.active.fill(0);
  }
}
