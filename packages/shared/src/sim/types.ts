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
}

/** Anything that can be hit by projectiles. */
export interface Combatant {
  id: number;
  state: ShipState;
  def: ShipDef;
}
