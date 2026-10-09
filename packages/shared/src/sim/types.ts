import type { ShipDef } from '../config/ships.ts';

export interface ShipState {
  x: number;
  y: number;
  /** Radians, from +x toward +y. */
  heading: number;
  /** Scalar speed along the heading. */
  speed: number;
  hull: number;
  shield: number;
  alive: boolean;
  /** Seconds until each mount may fire again. */
  mountCooldown: Float32Array;
  /** Seconds until any mount of this ship may fire again (sequential salvos). */
  salvoCooldown: number;
  /** Sideways velocity from collisions (world units/s); fades out by itself. */
  kx: number;
  ky: number;
  /** Extra turn rate from collisions (rad/s); fades out by itself. */
  spin: number;
}

export function createShipState(def: ShipDef, x: number, y: number, heading: number): ShipState {
  return {
    x,
    y,
    heading,
    speed: 0,
    hull: def.hull,
    shield: def.shield,
    alive: true,
    mountCooldown: new Float32Array(def.mounts.length),
    salvoCooldown: 0,
    kx: 0,
    ky: 0,
    spin: 0,
  };
}

export function resetShipState(
  s: ShipState,
  def: ShipDef,
  x: number,
  y: number,
  heading: number,
): void {
  s.x = x;
  s.y = y;
  s.heading = heading;
  s.speed = 0;
  s.hull = def.hull;
  s.shield = def.shield;
  s.alive = true;
  s.mountCooldown.fill(0);
  s.salvoCooldown = 0;
  s.kx = 0;
  s.ky = 0;
  s.spin = 0;
}

/** Team value of a ship that belongs to no team (offline sandbox targets, free-for-all). */
export const NO_TEAM = 255;

/** Anything that can be hit by projectiles. */
export interface Combatant {
  id: number;
  state: ShipState;
  def: ShipDef;
  /** 0 = blue, 1 = red, NO_TEAM = none. Teammates never hurt each other. */
  team: number;
}
