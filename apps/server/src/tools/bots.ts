import { MATCH, SHIP_IDS } from '@tidebreaker/shared';
import type { ShipId } from '@tidebreaker/shared';
import { BotClient } from './botClient.ts';

/**
 * Fills a running server with bots, the same number on each team, so a single human can test the
 * whole game (carriers, team fights, kill feed, scoreboard). Joins are staggered so the server's
 * team balancing alternates blue, red, blue, ... and reconnects by itself, so it can be started
 * before the server is up.
 *
 *   pnpm bots                      5 per team
 *   pnpm bots --per-team 3 --url ws://localhost:9001
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const perTeam = Math.max(0, Math.min(MATCH.perTeam - 1, Math.floor(Number(arg('per-team', '5')))));
const url = arg('url', 'ws://127.0.0.1:9001');

// Every class but the smallest boats: each team gets the same mix.
const CLASSES: ShipId[] = ['corvette', 'frigate', 'cruiser', 'gunboat', 'heavy_frigate'].filter(
  (id): id is ShipId => SHIP_IDS.includes(id as ShipId),
);
const NAMES = [
  'Barbaros',
  'Piri Reis',
  'Turgut',
  'Oruç',
  'Kemal Reis',
  'Seydi Ali',
  'Burak Reis',
  'Hızır',
  'Salih Reis',
  'Cezayirli',
];

const bots: BotClient[] = [];
for (let i = 0; i < perTeam * 2; i++) {
  const bot = new BotClient({
    url,
    name: `Bot ${NAMES[i % NAMES.length]!}`.slice(0, 16),
    ship: CLASSES[i % CLASSES.length]!,
  });
  bots.push(bot);
  // Joins are one after another, so the server splits them evenly between the teams.
  setTimeout(() => bot.start(), i * 250);
}
console.log(`bots: ${perTeam * 2} (${perTeam} per team) -> ${url}`);

process.on('SIGINT', () => {
  for (const b of bots) b.stop();
  process.exit(0);
});
