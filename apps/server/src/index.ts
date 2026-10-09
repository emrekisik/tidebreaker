import { TRAINING } from '@tidebreaker/shared';
import { WsTransport } from './net/wsTransport.ts';
import { Room } from './room/room.ts';

/**
 * Starts one room (GAME_DESIGN.md §10, §11). Settings come from the environment:
 *   PORT              listening port (default 9001)
 *   MAP_SEED          map seed (default: the practice map seed, so dev runs are repeatable)
 *   ALLOWED_ORIGINS   comma-separated Origin allow-list (default: the Vite dev server)
 *   REQUIRE_ORIGIN    "1" refuses connections without an Origin header (set in production)
 *   MAX_CONN_PER_IP   per-IP connection cap (default 4)
 */
const port = Number(process.env['PORT'] ?? 9001);
const seed = Number(process.env['MAP_SEED'] ?? TRAINING.mapSeed) >>> 0;
const origins = (
  process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173,http://127.0.0.1:5173'
).split(',');

let room: Room | null = null;
const transport = new WsTransport({
  port,
  allowedOrigins: origins,
  requireOrigin: process.env['REQUIRE_ORIGIN'] === '1',
  maxConnectionsPerIp: Number(process.env['MAX_CONN_PER_IP'] ?? 4),
  status: () => room?.status() ?? { room: 'starting' },
});
room = new Room({ transport, seed });
await room.start();
console.log(`room listening on :${port} (map seed ${seed})`);

// Clean shutdown (GAME_DESIGN.md §11.5).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void room?.stop().then(() => process.exit(0));
  });
}
