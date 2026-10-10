import { SHIP_IDS } from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import { BotClient } from './botClient.ts';

/**
 * One bot that joins a running server (try the game with a second player).
 *
 *   pnpm bot [--name Bot] [--ship corvette] [--url ws://localhost:9001] [--passive]
 *
 * `--passive` makes a target dummy that never moves or shoots. For a whole crowd use `pnpm bots`.
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const ship = arg('ship', 'corvette') as ShipId;
if (!SHIP_IDS.includes(ship)) {
  console.log(`unknown ship "${ship}"; choose one of: ${SHIP_IDS.join(', ')}`);
  process.exit(1);
}
const bot = new BotClient({
  url: arg('url', 'ws://127.0.0.1:9001'),
  name: arg('name', 'Bot'),
  ship,
  passive: process.argv.includes('--passive'),
  verbose: true,
});
bot.start();

process.on('SIGINT', () => {
  bot.stop();
  console.log(`[${arg('name', 'Bot')}] done; was hit ${bot.hits} times`);
  process.exit(0);
});
