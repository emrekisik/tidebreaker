import type { ShipDef } from '../config/ships.ts';
import type { ShipState } from './types.ts';

/** Distance from the point (x, y) to the hull of a ship (negative inside it): the nearest hit circle's surface. */
export function hullDistance(state: ShipState, def: ShipDef, x: number, y: number): number {
  const cos = Math.cos(state.heading);
  const sin = Math.sin(state.heading);
  let near = Infinity;
  const circles = def.hitCircles;
  for (let k = 0; k < circles.length; k++) {
    const c = circles[k]!;
    const dx = x - (state.x + cos * c.offset);
    const dy = y - (state.y + sin * c.offset);
    const d = Math.sqrt(dx * dx + dy * dy) - c.radius;
    if (d < near) near = d;
  }
  return near;
}
