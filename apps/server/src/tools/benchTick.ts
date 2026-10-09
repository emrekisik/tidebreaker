import { MATCH, SHIP_IDS, STEP_SEC, WORLD_CENTER } from '@tidebreaker/shared';
import { MemoryTransport } from '../net/memTransport.ts';
import { TestClient, settle } from '../testing.ts';
import { Room } from '../room/room.ts';

/**
 * Server tick cost with a full room (GAME_DESIGN.md §16: p99 must stay far below the 50 ms
 * budget; the design target is <= 8 ms): 20 players all firing, both carriers shooting, hundreds
 * of projectiles in flight, a snapshot to every client every second tick.
 *
 *   pnpm bench
 */
const TICKS = 3000;
const transport = new MemoryTransport();
let now = 0;
const room = new Room({ transport, seed: 1337, clock: () => now });
const clients: TestClient[] = [];
for (let i = 0; i < MATCH.maxPlayers; i++) {
  const c = new TestClient(transport.connect(`10.0.0.${i}`));
  clients.push(c);
  c.hello();
  c.play(`P${i}`, SHIP_IDS.indexOf('corvette'));
}
await settle();

const w = room.world;
for (let s = 2; s < w.slotCount; s++) {
  // Two clusters in the middle of the map, shooting at each other across 40 units.
  const blue = w.slots[s]!.team === 0;
  const st = w.slots[s]!.state;
  st.x = WORLD_CENTER + (blue ? -20 : 20);
  st.y = WORLD_CENTER + (s - 12) * 4;
  st.heading = blue ? 0 : Math.PI;
  w.protectLeft[s] = 0;
  w.inFire[s] = 1;
  w.inAim[s] = blue ? 0 : Math.PI;
  w.inAimDist[s] = 40;
}

const times = new Float64Array(TICKS);
let maxProjectiles = 0;
for (let i = -200; i < TICKS; i++) {
  now += STEP_SEC * 1000;
  const t0 = performance.now();
  room.tick();
  const dt = performance.now() - t0;
  if (i >= 0) times[i] = dt;
  maxProjectiles = Math.max(maxProjectiles, w.projectiles.activeCount);
  // Keep everyone alive and in place: this measures the steady state, not a massacre.
  for (let s = 2; s < w.slotCount; s++) {
    const st = w.slots[s]!.state;
    st.hull = w.slots[s]!.def.hull;
    st.shield = w.slots[s]!.def.shield;
    st.x = WORLD_CENTER + (w.slots[s]!.team === 0 ? -20 : 20);
  }
  if (i % 100 === 0) {
    // Clients that stay silent are dropped after 20 s; a ping keeps them alive.
    for (const c of clients) c.ping(i);
    await settle(); // let the in-memory clients drain their queues
  }
}

const sorted = Array.from(times).sort((a, b) => a - b);
const pct = (p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
console.log(`players ${w.playerCount()}, projectiles in flight up to ${maxProjectiles}`);
console.log(
  `tick ms: mean ${mean.toFixed(3)}  p50 ${pct(0.5).toFixed(3)}  p99 ${pct(0.99).toFixed(3)}  max ${pct(1).toFixed(3)}  (budget 50, target p99 <= 8)`,
);
process.exit(pct(0.99) > 8 ? 1 : 0);
