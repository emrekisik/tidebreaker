import { COLLISION, ISLAND_COLLISION } from './collision.ts';
import { CARRIER, MATCH } from './match.ts';
import { PROTOCOL_VERSION, SNAPSHOT_EVERY, TICK_RATE } from './net.ts';
import { SHIPS, SHIP_MOVEMENT } from './ships.ts';
import { SALVO_GAP_SEC, WEAPONS } from './weapons.ts';
import { MAP, WORLD_SIZE } from './world.ts';

let cached = 0;

/**
 * 32-bit FNV-1a hash of every config value that changes how the simulation behaves. The server
 * sends it in WELCOME; a client with a different value would predict wrongly, so it refuses to
 * connect ("game version mismatch").
 */
export function configHash(): number {
  if (cached !== 0) return cached;
  const text = JSON.stringify([
    PROTOCOL_VERSION,
    TICK_RATE,
    SNAPSHOT_EVERY,
    WORLD_SIZE,
    MAP,
    SHIPS,
    CARRIER,
    WEAPONS,
    SALVO_GAP_SEC,
    SHIP_MOVEMENT,
    COLLISION,
    ISLAND_COLLISION,
    MATCH,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  cached = h >>> 0 || 1;
  return cached;
}
