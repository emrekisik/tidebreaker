import type { Scene } from 'three';
import {
  DEG2RAD,
  FX,
  MAX_PROJECTILES,
  Mulberry32,
  ProjectileSet,
  SHIPS,
  STEP_SEC,
  TRAINING,
  createShipState,
  resetShipState,
  resolveCollisions,
  stepShip,
  updateMounts,
} from '@tidebreaker/shared';
import type {
  CollisionSink,
  Combatant,
  HitSink,
  ProjectileSink,
  ShipId,
} from '@tidebreaker/shared';
import { ShipEntity } from '../frame/entity.ts';
import { HealthBar } from '../frame/healthBar.ts';
import type { AssetProvider } from '../render/assets.ts';
import type { BarKit } from '../render/barKit.ts';

export interface GameEvents {
  /** A projectile left a barrel (muzzle position, fire angle, weapon index). */
  onShot(x: number, y: number, angle: number, weaponIdx: number): void;
  onHit(
    x: number,
    y: number,
    damage: number,
    shieldHit: boolean,
    killed: boolean,
    target: ShipEntity,
    weaponIdx: number,
  ): void;
  /** A projectile ended in the water. */
  onMiss(x: number, y: number, weaponIdx: number): void;
  /** Two ships collided at (x, y) with the given closing speed. */
  onCollision(
    x: number,
    y: number,
    impact: number,
    a: ShipEntity,
    b: ShipEntity,
    damageA: number,
    damageB: number,
    killedA: boolean,
    killedB: boolean,
  ): void;
}

const PLAYER_ID = 1;

/**
 * Offline sandbox world: the player (blue) and a fleet of stationary enemy ships (red). All rules
 * come from `@tidebreaker/shared`, the same code the authoritative server will run later.
 */
export class LocalGame implements HitSink, CollisionSink {
  readonly player: ShipEntity;
  readonly entities: ShipEntity[] = [];
  readonly combatants: Combatant[] = [];
  readonly projectiles = new ProjectileSet(MAX_PROJECTILES);
  kills = 0;
  ticks = 0;
  private readonly rng = new Mulberry32(0x1d3a5c71);
  private readonly events: GameEvents;
  /** Forwards new shots to the projectile set and tells the view about them. */
  private readonly shotSink: ProjectileSink = {
    spawn: (x, y, angle, speed, range, radius, damage, ownerId, weaponIdx) => {
      this.projectiles.spawn(x, y, angle, speed, range, radius, damage, ownerId, weaponIdx);
      this.events.onShot(x, y, angle, weaponIdx);
    },
  };
  private readonly scene: Scene;
  private readonly assets: AssetProvider;

  constructor(
    scene: Scene,
    assets: AssetProvider,
    bars: BarKit,
    events: GameEvents,
    /** Visual-only override of the player model (`?ship=<key>` preview). Sim data is unchanged. */
    playerModelKey?: string,
  ) {
    this.events = events;
    this.scene = scene;
    this.assets = assets;

    const spawn = TRAINING.playerSpawn;
    const playerDef = SHIPS[TRAINING.playerShip as ShipId];
    this.player = this.addShip(
      assets.createShip(playerModelKey ?? playerDef.modelKey, 'blue'),
      playerDef,
      spawn.x,
      spawn.y,
      spawn.heading,
      null,
    );

    for (const t of TRAINING.targets) {
      const def = SHIPS[t.ship as ShipId];
      this.addShip(
        assets.createShip(def.modelKey, 'red'),
        def,
        spawn.x + t.x,
        spawn.y + t.y,
        t.heading,
        new HealthBar(scene, bars, 'red'),
      );
    }
  }

  /**
   * Switches the player to another ship class: new stats, hit shape, mounts and model. Position
   * and heading are kept; hull, shield and cooldowns start fresh.
   */
  setPlayerShip(id: ShipId): void {
    const def = SHIPS[id];
    const c = this.player.combatant;
    const s = c.state;
    c.def = def;
    c.state = createShipState(def, s.x, s.y, s.heading);
    this.setPlayerModel(def.modelKey);
  }

  /** Visual-only: swaps the player's model. Sim data (speed, hit shape, mounts) is unchanged. */
  setPlayerModel(modelKey: string): void {
    const model = this.assets.createShip(modelKey, 'blue');
    this.scene.remove(this.player.model.root);
    this.scene.add(model.root);
    this.player.setModel(model);
  }

  private addShip(
    model: ConstructorParameters<typeof ShipEntity>[1],
    def: Combatant['def'],
    x: number,
    y: number,
    heading: number,
    bar: HealthBar | null,
  ): ShipEntity {
    const combatant: Combatant = {
      id: this.combatants.length + PLAYER_ID,
      state: createShipState(def, x, y, heading),
      def,
    };
    const entity = new ShipEntity(combatant, model, bar);
    entity.homeX = x;
    entity.homeY = y;
    entity.homeHeading = heading;
    this.scene.add(model.root);
    this.entities.push(entity);
    this.combatants.push(combatant);
    return entity;
  }

  /** One fixed simulation tick (GAME_DESIGN.md §11.2 order, reduced to what exists so far). */
  step(steer: number, throttle: number, aim: number, fire: boolean): void {
    for (const e of this.entities) {
      const s = e.combatant.state;
      e.pose.capture(s.x, s.y, s.heading);
    }

    // Movement. Enemies hold still (no AI yet) but still drift when knocked by a collision.
    for (const e of this.entities) {
      const s = e.combatant.state;
      if (!s.alive) continue;
      const def = e.combatant.def;
      const mine = e === this.player;
      stepShip(
        s,
        mine ? steer : 0,
        mine ? throttle : 0,
        def.vMax,
        def.turnRateDeg * DEG2RAD,
        STEP_SEC,
      );
    }

    resolveCollisions(this.combatants, this);

    const p = this.player;
    const ps = p.combatant.state;
    p.aim = aim;
    if (ps.alive) {
      updateMounts(ps, p.combatant.def, PLAYER_ID, aim, fire, STEP_SEC, this.rng, this.shotSink);
    }

    this.projectiles.step(STEP_SEC, this.combatants, this);

    // Sunk ships come back at their starting position after a while.
    for (const e of this.entities) {
      const s = e.combatant.state;
      if (s.alive) {
        e.respawnSeconds = 0;
        continue;
      }
      e.respawnSeconds += STEP_SEC;
      const delay = e === p ? TRAINING.playerRespawnSec : TRAINING.targetRespawnSec;
      if (e.respawnSeconds >= delay) {
        resetShipState(s, e.combatant.def, e.homeX, e.homeY, e.homeHeading);
        e.pose.snap(s.x, s.y, s.heading);
        e.respawnSeconds = 0;
      }
    }
    this.ticks++;
  }

  onExpire(x: number, y: number, weaponIdx: number): void {
    this.events.onMiss(x, y, weaponIdx);
  }

  onHit(
    ownerId: number,
    targetId: number,
    x: number,
    y: number,
    damage: number,
    shieldHit: boolean,
    killed: boolean,
    weaponIdx: number,
  ): void {
    const target = this.entities[targetId - PLAYER_ID];
    if (target) target.flashSeconds = FX.hitFlashSec;
    if (killed && ownerId === PLAYER_ID) this.kills++;
    if (target) this.events.onHit(x, y, damage, shieldHit, killed, target, weaponIdx);
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
    const a = this.entities[aId - PLAYER_ID];
    const b = this.entities[bId - PLAYER_ID];
    if (!a || !b) return;
    // Shake grows with the impact and is capped.
    const shake = Math.min(1.6, impact * 0.07);
    a.shake = Math.max(a.shake, shake);
    b.shake = Math.max(b.shake, shake);
    if (damageA > 0) a.flashSeconds = FX.hitFlashSec;
    if (damageB > 0) b.flashSeconds = FX.hitFlashSec;
    // The player gets the credit when a ship they rammed goes down.
    if (killedA && b === this.player) this.kills++;
    if (killedB && a === this.player) this.kills++;
    this.events.onCollision(x, y, impact, a, b, damageA, damageB, killedA, killedB);
  }
}
