import type { Scene } from 'three';
import {
  DEG2RAD,
  FX,
  MAX_PROJECTILES,
  MENU_BATTLE,
  Mulberry32,
  ProjectileSet,
  SHIPS,
  STEP_SEC,
  TAU,
  TEAM_A,
  TEAM_B,
  applyWorldBounds,
  circleVsWorld,
  clamp,
  COMBAT,
  collideIslands,
  createCombatant,
  lineOfFire,
  normalizeAngle,
  regenHull,
  regenShield,
  resetShipState,
  resolveCollisions,
  segmentVsWorld,
  stepShip,
  updateMounts,
} from '@tidebreaker/shared';
import type {
  CollisionSink,
  Combatant,
  HitSink,
  IslandSink,
  Obstacles,
  ProjectileSink,
  ShipId,
  WorldMap,
} from '@tidebreaker/shared';
import { ShipEntity } from '../frame/entity.ts';
import type { AssetProvider } from '../render/assets.ts';
import type { GameEvents } from './localGame.ts';
import type { ProjectileLayer } from './session.ts';

/** Ship `1 + i` is `entities[i]`. */
const FIRST_ID = 1;
/** A hit circle of this size must be clear of land where a ship is put. */
const PLACE_CLEAR = 10;
/** Tries (each closer to the middle) to find a free spot for a ship. */
const PLACE_TRIES = 4;
/** How many rings of candidates are looked at when the middle of the fight needs a new place. */
const SEARCH_RINGS = 9;
const SEARCH_STEP = 24;
/** The middle of the fight looks for open water this often (ticks). */
const SEARCH_EVERY = 10;
/** Muzzle speed of a cannon shell, for leading a target. */
const SHELL_SPEED = 60;

/**
 * The fight behind the start screen: two small fleets of AI ships that circle each other and trade fire, run by the same
 * simulation as a match (movement, mounts, projectiles, hits, collisions), with nothing but the pictures and the
 * effects on top. The middle of the fight follows open water near a point the caller gives, and the camera follows the
 * middle. Sunk ships come back after a while. Purely cosmetic: nothing here is sent anywhere.
 */
export class MenuBattle implements HitSink, CollisionSink, IslandSink {
  readonly entities: ShipEntity[] = [];
  readonly combatants: Combatant[] = [];
  readonly projectiles = new ProjectileSet(MAX_PROJECTILES);
  readonly layers: ProjectileLayer[] = [{ set: this.projectiles, alpha: 0 }];
  /** The middle of the fight (the camera looks here). */
  arenaX = 0;
  arenaY = 0;
  private goalX = 0;
  private goalY = 0;
  private ticks = 0;
  private readonly rng = new Mulberry32(0x6a09e667);
  private readonly obstacles: Obstacles;
  private readonly hit = new Float32Array(3);
  /** What each ship decided this tick. */
  private readonly steer: Float32Array;
  private readonly throttle: Float32Array;
  private readonly fire: Uint8Array;
  /** Which way each ship circles its target (+1 / -1), and where it stands in its team's line. */
  private readonly dir: Int8Array;
  private readonly slot: Uint8Array;
  private shooter: Combatant | null = null;
  /** The projectiles of this fight are told apart from nothing: every shot carries its team. */
  private readonly shotSink: ProjectileSink = {
    spawn: (x, y, angle, speed, range, radius, damage, ownerId, weaponIdx) => {
      this.projectiles.spawn(x, y, angle, speed, range, radius, damage, ownerId, weaponIdx, this.shooter?.team);
      this.events.onShot(x, y, angle, weaponIdx, 0, false);
    },
  };

  constructor(
    private readonly scene: Scene,
    assets: AssetProvider,
    private readonly events: GameEvents,
    private readonly land: WorldMap,
    startX: number,
    startY: number,
  ) {
    this.obstacles = { segmentHit: (a, b, c, d) => segmentVsWorld(land, a, b, c, d) };
    const per = MENU_BATTLE.fleet.length;
    this.steer = new Float32Array(per * 2);
    this.throttle = new Float32Array(per * 2);
    this.fire = new Uint8Array(per * 2);
    this.dir = new Int8Array(per * 2);
    this.slot = new Uint8Array(per * 2);
    this.openSeaNear(startX, startY);
    this.arenaX = this.goalX;
    this.arenaY = this.goalY;
    for (const team of [TEAM_A, TEAM_B]) {
      for (let k = 0; k < per; k++) {
        const i = this.entities.length;
        const def = SHIPS[MENU_BATTLE.fleet[k] as ShipId];
        const combatant = createCombatant(i + FIRST_ID, def, team);
        const model = assets.createShip(def.modelKey, team === TEAM_A ? 'a' : 'b');
        // (No health bars: the start screen stays clean.)
        const entity = new ShipEntity(combatant, model, null);
        scene.add(model.root);
        this.entities.push(entity);
        this.combatants.push(combatant);
        this.dir[i] = i % 2 === 0 ? 1 : -1;
        this.slot[i] = k;
        this.place(i);
      }
    }
  }

  /** Takes the ships out of the scene (the match is starting). */
  dispose(): void {
    for (const e of this.entities) this.scene.remove(e.model.root);
  }

  /** Every rendered frame, before the ships are drawn. */
  frame(fixedAlpha: number): void {
    this.layers[0]!.alpha = fixedAlpha;
  }

  /** The open water near (x, y) with room around it becomes the goal of the middle of the fight. */
  private openSeaNear(x: number, y: number): void {
    this.goalX = x;
    this.goalY = y;
    for (let ring = 0; ring < SEARCH_RINGS; ring++) {
      const n = ring === 0 ? 1 : ring * 6;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + ring;
        const px = x + Math.cos(a) * ring * SEARCH_STEP;
        const py = y + Math.sin(a) * ring * SEARCH_STEP;
        if (!circleVsWorld(this.land, px, py, MENU_BATTLE.clearRadius, this.hit)) {
          this.goalX = px;
          this.goalY = py;
          return;
        }
      }
    }
  }

  /** (Re)starts ship `i` at its team's side of the middle of the fight, facing it. */
  private place(i: number): void {
    const e = this.entities[i]!;
    const c = e.combatant;
    const per = MENU_BATTLE.fleet.length;
    // The two teams face each other across the middle; the line turns slowly so the fight is never in the same place.
    const side = 0.6 + this.ticks * 0.0004 + (c.team === TEAM_A ? 0 : Math.PI);
    const nx = Math.cos(side);
    const ny = Math.sin(side);
    const lateral = (this.slot[i]! - (per - 1) / 2) * 15;
    let k = 1;
    let x = this.arenaX;
    let y = this.arenaY;
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      x = this.arenaX + (nx * MENU_BATTLE.startGap - ny * lateral) * k;
      y = this.arenaY + (ny * MENU_BATTLE.startGap + nx * lateral) * k;
      if (!circleVsWorld(this.land, x, y, PLACE_CLEAR, this.hit)) break;
      k *= 0.55;
    }
    resetShipState(c.state, c.def, x, y, side + Math.PI);
    e.pose.snap(x, y, c.state.heading);
    e.respawnSeconds = 0;
    e.aim = c.state.heading;
  }

  /** True when a ship at (x, y) heading `h` would run into land within `len`. */
  private blocked(x: number, y: number, h: number, len: number): boolean {
    return segmentVsWorld(this.land, x, y, x + Math.cos(h) * len, y + Math.sin(h) * len) >= 0;
  }

  /** What ship `i` does this tick: pick the nearest enemy, circle it, keep to the arena, stay off the land, shoot. */
  private think(i: number): void {
    const e = this.entities[i]!;
    const c = e.combatant;
    const s = c.state;
    this.fire[i] = 0;
    this.throttle[i] = 0.7;
    if (!s.alive) {
      this.steer[i] = 0;
      return;
    }
    let target = -1;
    let best = Infinity;
    for (let j = 0; j < this.combatants.length; j++) {
      const o = this.combatants[j]!;
      if (o.team === c.team || !o.state.alive) continue;
      const d2 = (o.state.x - s.x) ** 2 + (o.state.y - s.y) ** 2;
      if (d2 < best) {
        best = d2;
        target = j;
      }
    }
    let wx = Math.cos(s.heading);
    let wy = Math.sin(s.heading);
    if (target >= 0) {
      const t = this.combatants[target]!.state;
      const dist = Math.sqrt(best);
      const toward = Math.atan2(t.y - s.y, t.x - s.x);
      // Straight at the target when far, along a circle around it at the preferred range, away when too close.
      const k = clamp((dist - MENU_BATTLE.preferredRange) / 20, -1, 1);
      const want = toward + this.dir[i]! * (Math.PI / 2 - k * (Math.PI / 2 - 0.25));
      wx = Math.cos(want);
      wy = Math.sin(want);
      // Aim where the target will be when the shell gets there.
      const lead = dist / SHELL_SPEED;
      const ax = t.x + Math.cos(t.heading) * t.speed * lead;
      const ay = t.y + Math.sin(t.heading) * t.speed * lead;
      // (The aim wanders a little, each ship at its own pace, so some shots miss.)
      e.aim = Math.atan2(ay - s.y, ax - s.x) + Math.sin(this.ticks * 0.11 + i * 1.9) * MENU_BATTLE.aimError;
      e.aimDist = Math.hypot(ax - s.x, ay - s.y);
      if (dist < MENU_BATTLE.fireRange && lineOfFire(this.land, s.x, s.y, ax, ay, 1.5)) this.fire[i] = 1;
    } else {
      e.aim = s.heading;
      e.aimDist = 0;
    }
    // Back toward the middle of the fight when straying from it.
    const ox = this.arenaX - s.x;
    const oy = this.arenaY - s.y;
    const away = Math.sqrt(ox * ox + oy * oy);
    const pull = clamp((away - MENU_BATTLE.arenaRadius * 0.5) / MENU_BATTLE.arenaRadius, 0, 1) + (target < 0 ? 1 : 0);
    if (pull > 0 && away > 1) {
      const w = Math.min(1, pull);
      wx = wx * (1 - w) + (ox / away) * w;
      wy = wy * (1 - w) + (oy / away) * w;
    }
    // Keep clear of teammates.
    for (let j = 0; j < this.combatants.length; j++) {
      const o = this.combatants[j]!;
      if (j === i || !o.state.alive) continue;
      const dx = s.x - o.state.x;
      const dy = s.y - o.state.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const room = (c.def.length + o.def.length) * 0.7;
      if (d < room && d > 0.01) {
        wx += (dx / d) * (1 - d / room) * 1.5;
        wy += (dy / d) * (1 - d / room) * 1.5;
      }
    }
    let heading = Math.atan2(wy, wx);
    // Off the land: look ahead and turn to the side that is free.
    const look = 12 + Math.abs(s.speed) * 2.2;
    if (this.blocked(s.x, s.y, heading, look)) {
      for (let n = 1; n <= 3; n++) {
        const turn = n * 0.6;
        if (!this.blocked(s.x, s.y, heading + turn, look)) {
          heading += turn;
          break;
        }
        if (!this.blocked(s.x, s.y, heading - turn, look)) {
          heading -= turn;
          break;
        }
      }
    }
    const error = normalizeAngle(heading - s.heading);
    this.steer[i] = clamp(error * 2, -1, 1);
    if (Math.abs(error) > 1.2) this.throttle[i] = 0.45;
  }

  /** One fixed simulation tick; (driftX, driftY) is where the camera would like to be. */
  step(driftX: number, driftY: number): void {
    if (this.ticks % SEARCH_EVERY === 0) this.openSeaNear(driftX, driftY);
    const gx = this.goalX - this.arenaX;
    const gy = this.goalY - this.arenaY;
    const gd = Math.sqrt(gx * gx + gy * gy);
    const reach = MENU_BATTLE.moveSpeed * STEP_SEC;
    if (gd > reach) {
      this.arenaX += (gx / gd) * reach;
      this.arenaY += (gy / gd) * reach;
    } else {
      this.arenaX = this.goalX;
      this.arenaY = this.goalY;
    }

    for (let i = 0; i < this.entities.length; i++) {
      const s = this.entities[i]!.combatant.state;
      this.entities[i]!.pose.capture(s.x, s.y, s.heading);
      this.think(i);
    }
    for (let i = 0; i < this.entities.length; i++) {
      const c = this.entities[i]!.combatant;
      if (!c.state.alive) continue;
      stepShip(c.state, this.steer[i]!, this.throttle[i]!, c.def.vMax, c.def.turnRateDeg * DEG2RAD, STEP_SEC);
    }
    resolveCollisions(this.combatants, this);
    for (const e of this.entities) {
      const s = e.combatant.state;
      if (!s.alive) continue;
      collideIslands(this.land, s, e.combatant.def, e.combatant.id, this);
      applyWorldBounds(s, STEP_SEC);
    }
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i]!;
      const c = e.combatant;
      if (!c.state.alive) continue;
      this.shooter = c;
      updateMounts(c.state, c.def, c.id, e.aim, this.fire[i] === 1, STEP_SEC, this.rng, this.shotSink, e.aimDist);
    }
    this.shooter = null;
    this.projectiles.step(STEP_SEC, this.combatants, this, this.obstacles);
    // Shields recharge and hulls mend as in a match, so the fight goes on instead of wearing the ships down.
    for (const c of this.combatants) {
      regenShield(c.state, c.def.shield, COMBAT.shieldDelaySec, COMBAT.shieldRechargeSec, STEP_SEC);
      regenHull(c.state, c.def.hull, COMBAT.hullRegenDelaySec, COMBAT.hullRegenPctPerSec, STEP_SEC);
    }

    // Sunk ships come back, new and whole, at their team's side.
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i]!;
      if (e.combatant.state.alive) {
        e.respawnSeconds = 0;
        continue;
      }
      e.respawnSeconds += STEP_SEC;
      if (e.respawnSeconds >= MENU_BATTLE.respawnSec) this.place(i);
    }
    this.ticks++;
  }

  onExpire(x: number, y: number, weaponIdx: number): void {
    this.events.onMiss(x, y, weaponIdx);
  }

  onBlocked(x: number, y: number, weaponIdx: number): void {
    this.events.onBlocked(x, y, weaponIdx);
  }

  onIslandHit(shipId: number, x: number, y: number, impact: number): void {
    const e = this.entities[shipId - FIRST_ID];
    if (e) this.events.onIslandHit(x, y, impact, e);
  }

  onHit(
    _ownerId: number,
    targetId: number,
    x: number,
    y: number,
    damage: number,
    shieldHit: boolean,
    killed: boolean,
    weaponIdx: number,
  ): void {
    const target = this.entities[targetId - FIRST_ID];
    if (!target) return;
    target.flashSeconds = FX.hitFlashSec;
    this.events.onHit(x, y, damage, shieldHit, killed, target, weaponIdx, false);
  }

  onCollision(
    aId: number,
    bId: number,
    x: number,
    y: number,
    impact: number,
    damageA: number,
    damageB: number,
    killedA: boolean,
    killedB: boolean,
  ): void {
    const a = this.entities[aId - FIRST_ID];
    const b = this.entities[bId - FIRST_ID];
    if (!a || !b) return;
    const shake = Math.min(1.6, impact * 0.07);
    a.shake = Math.max(a.shake, shake);
    b.shake = Math.max(b.shake, shake);
    if (damageA > 0) a.flashSeconds = FX.hitFlashSec;
    if (damageB > 0) b.flashSeconds = FX.hitFlashSec;
    this.events.onCollision(x, y, impact, a, b, damageA, damageB, killedA, killedB);
  }
}
