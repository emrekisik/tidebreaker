import type { Scene } from 'three';
import {
  DEG2RAD,
  MAX_PROJECTILES,
  Mulberry32,
  ProjectileSet,
  SHIPS,
  STEP_SEC,
  TRAINING,
  createShipState,
  resetShipState,
  stepShip,
  updateMounts,
} from '@tidebreaker/shared';
import type { Combatant, HitSink, ShipId } from '@tidebreaker/shared';
import { ShipEntity } from '../frame/entity.ts';
import { HealthBar } from '../frame/healthBar.ts';
import type { AssetProvider } from '../render/assets.ts';
import type { BarKit } from '../render/barKit.ts';

export interface GameEvents {
  onHit(x: number, y: number, damage: number, shieldHit: boolean, killed: boolean): void;
}

const PLAYER_ID = 1;

/**
 * Offline sandbox world for phase 1a: one player ship and a few stationary targets. All rules
 * come from `@tidebreaker/shared`, the same code the authoritative server will run later.
 */
export class LocalGame implements HitSink {
  readonly player: ShipEntity;
  readonly entities: ShipEntity[] = [];
  readonly combatants: Combatant[] = [];
  readonly projectiles = new ProjectileSet(MAX_PROJECTILES);
  kills = 0;
  ticks = 0;
  private readonly rng = new Mulberry32(0x1d3a5c71);
  private readonly events: GameEvents;
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
      scene,
      assets.createShip(playerModelKey ?? playerDef.modelKey, 'player'),
      playerDef,
      spawn.x,
      spawn.y,
      spawn.heading,
      null,
    );

    const targetDef = SHIPS[TRAINING.targetShip as ShipId];
    for (const off of TRAINING.targetOffsets) {
      this.addShip(
        scene,
        assets.createShip(targetDef.modelKey, 'target'),
        targetDef,
        spawn.x + off.x,
        spawn.y + off.y,
        Math.PI * 0.5,
        new HealthBar(scene, bars),
      );
    }
  }

  /** Visual-only: swaps the player's model. Sim data (speed, hit shape, mounts) is unchanged. */
  setPlayerModel(modelKey: string): void {
    const model = this.assets.createShip(modelKey, 'player');
    this.scene.remove(this.player.model.root);
    this.scene.add(model.root);
    this.player.setModel(model);
  }

  private addShip(
    scene: Scene,
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
    scene.add(model.root);
    this.entities.push(entity);
    this.combatants.push(combatant);
    return entity;
  }

  /** One fixed simulation tick (GAME_DESIGN.md §11.2 order, reduced to what exists in 1a). */
  step(moveX: number, moveY: number, aim: number, fire: boolean): void {
    for (const e of this.entities) {
      const s = e.combatant.state;
      e.pose.capture(s.x, s.y, s.heading);
    }

    const p = this.player;
    const ps = p.combatant.state;
    const pdef = p.combatant.def;
    stepShip(ps, moveX, moveY, pdef.vMax, pdef.turnRateDeg * DEG2RAD, STEP_SEC);
    p.aim = aim;
    updateMounts(ps, pdef, PLAYER_ID, aim, fire, STEP_SEC, this.rng, this.projectiles);

    this.projectiles.step(STEP_SEC, this.combatants, this);

    for (const e of this.entities) {
      if (e === p) continue;
      const s = e.combatant.state;
      if (s.alive) {
        e.respawnSeconds = 0;
        continue;
      }
      e.respawnSeconds += STEP_SEC;
      if (e.respawnSeconds >= TRAINING.targetRespawnSec) {
        const index = this.entities.indexOf(e) - 1;
        const off = TRAINING.targetOffsets[index];
        if (!off) continue;
        resetShipState(
          s,
          e.combatant.def,
          TRAINING.playerSpawn.x + off.x,
          TRAINING.playerSpawn.y + off.y,
          Math.PI * 0.5,
        );
        e.pose.snap(s.x, s.y, s.heading);
        e.respawnSeconds = 0;
      }
    }
    this.ticks++;
  }

  onHit(
    ownerId: number,
    targetId: number,
    x: number,
    y: number,
    damage: number,
    shieldHit: boolean,
    killed: boolean,
  ): void {
    const target = this.entities[targetId - PLAYER_ID];
    if (target) target.flashSeconds = 0.12;
    if (killed && ownerId === PLAYER_ID) this.kills++;
    this.events.onHit(x, y, damage, shieldHit, killed);
  }
}
