import type { ProjectileSet, WorldMap } from '@tidebreaker/shared';
import type { ShipEntity } from '../frame/entity.ts';

/** One set of projectiles to draw, and how far between its last two steps the picture is. */
export interface ProjectileLayer {
  set: ProjectileSet;
  /** 0..1 between the previous and the latest simulation step. */
  alpha: number;
}

/**
 * What the render loop needs from a running game, whether it is the offline sandbox or a match on
 * a server. Both own the ships, the projectiles and the simulation clock.
 */
export interface GameSession {
  /** Every ship in the scene (the player's own first), carriers included. */
  readonly entities: readonly ShipEntity[];
  readonly player: ShipEntity;
  readonly layers: readonly ProjectileLayer[];
  readonly land: WorldMap;
  /** Kills counter shown in the HUD (the player's own offline, the team's online). */
  readonly kills: number;
  /** Simulation ticks run so far (debug HUD). */
  readonly ticks: number;
  /** One fixed simulation step (20 Hz) with the player's controls. */
  step(steer: number, throttle: number, aim: number, aimDist: number, fire: boolean): void;
  /** Every rendered frame, before ships are drawn. `fixedAlpha` = progress to the next fixed step. */
  frame(nowMs: number, dtSec: number, fixedAlpha: number): void;
}
