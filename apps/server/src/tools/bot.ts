import { WebSocket } from 'ws';
import {
  MATCH,
  SHIP_IDS,
  WEAPONS,
  Writer,
  angleDiff,
  decodeServer,
  encodeHello,
  encodeInput,
  encodePlay,
  qAimDist,
  qAngle16,
  qAxis,
} from '@tidebreaker/shared';
import type { ServerHandler } from '@tidebreaker/shared';

/**
 * A simple bot for trying the game with a second player (and, later, for load tests): it joins,
 * sails toward the nearest enemy (or the enemy carrier) and shoots whenever something is in range.
 *
 *   pnpm --filter @tidebreaker/server exec tsx src/tools/bot.ts [--name Bot] [--ship corvette]
 *                                                              [--url ws://localhost:9001] [--passive]
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const url = arg('url', 'ws://127.0.0.1:9001');
const name = arg('name', 'Bot');
const shipIdx = Math.max(0, SHIP_IDS.indexOf(arg('ship', 'corvette') as (typeof SHIP_IDS)[number]));
const passive = process.argv.includes('--passive');

interface Seen {
  x: number;
  y: number;
  team: number;
  kind: number;
}
const seen = new Map<number, Seen>();
const me = { x: 0, y: 0, heading: 0, team: -1, id: 0, ready: false, hull: 1 };
let seq = 0;
let hitCount = 0;

const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
ws.binaryType = 'nodebuffer';
const out = new Writer(64);
const send = (): void => {
  ws.send(out.toBytes());
  out.reset();
};

const handler: ServerHandler = {
  welcome: () => {
    encodePlay(out, name, shipIdx);
    send();
  },
  joined: (id, team) => {
    me.id = id;
    me.team = team;
    me.ready = true;
    console.log(`[${name}] joined as entity ${id}, team ${team === 0 ? 'blue' : 'red'}`);
  },
  match: (state, winner, restart, kb, kr) =>
    console.log(
      `[${name}] match state=${state} winner=${winner} restart=${restart} kills=${kb}:${kr}`,
    ),
  youDied: (killer, killerName) => console.log(`[${name}] sunk by ${killer} ${killerName}`),
  kill: () => {},
  scores: () => {},
  pong: () => {},
  reject: (r) => {
    console.log(`[${name}] rejected (${r})`);
    process.exit(1);
  },
  snapshot: (_tick, _seq, self) => {
    me.x = self.x;
    me.y = self.y;
    me.heading = self.heading;
    me.hull = self.hull;
  },
  enter: (e) => seen.set(e.id, { x: e.x, y: e.y, team: e.team, kind: e.kind }),
  update: (u) => {
    const s = seen.get(u.id);
    if (s) {
      s.x = u.x;
      s.y = u.y;
    }
  },
  leave: (id) => seen.delete(id),
  projectileSpawn: () => {},
  projectileEnd: () => {},
  shipHit: (_t, target) => {
    if (target === me.id) hitCount++;
  },
  shipSunk: () => {},
  bump: () => {},
};

ws.on('open', () => {
  encodeHello(out);
  send();
});
ws.on('message', (data: Buffer) => {
  decodeServer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), handler);
});
ws.on('close', () => {
  console.log(`[${name}] disconnected`);
  process.exit(0);
});
ws.on('error', (e) => {
  console.log(`[${name}] error: ${e.message}`);
  process.exit(1);
});

setInterval(() => {
  if (!me.ready || ws.readyState !== WebSocket.OPEN) return;
  // Target: the nearest enemy ship, otherwise the enemy carrier.
  let best: Seen | null = null;
  let bestD = Infinity;
  for (const s of seen.values()) {
    if (s.team === me.team) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  seq = (seq + 1) & 0xffff;
  if (!best || passive) {
    encodeInput(out, seq, false, 0, passive ? 0 : qAxis(0.2), 0, 0);
    send();
    return;
  }
  const desired = Math.atan2(best.y - me.y, best.x - me.x);
  const steer = Math.max(-1, Math.min(1, angleDiff(desired, me.heading) * 2));
  // Keep some distance from a carrier (its guns hurt) but come close to ships.
  const standOff = best.kind === 10 ? 52 : 30;
  const throttle = bestD > standOff ? 1 : -0.2;
  const inRange = bestD < WEAPONS.cannon_t3.range * 0.95;
  encodeInput(out, seq, inRange, qAxis(steer), qAxis(throttle), qAngle16(desired), qAimDist(bestD));
  send();
}, 50);

process.on('SIGINT', () => {
  console.log(
    `[${name}] done; was hit ${hitCount} times; world is ${MATCH.maxPlayers} players max`,
  );
  process.exit(0);
});
