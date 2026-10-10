import {
  CARRIER,
  SHIPS,
  TICK_RATE,
  WEAPONS,
  effectiveHealth,
  sustainedDps,
  timeToKill,
} from '@tidebreaker/shared';
import type { ShipDef } from '@tidebreaker/shared';

/**
 * Combat balance tables (GAME_DESIGN.md §6.3, §17 Phase 3): how long ships need to sink each
 * other and the enemy carrier, computed from the config. Estimates: they assume every mount can
 * fire and a fixed fraction of shots hit, with no recharge and no dodging.
 *
 *   pnpm balance-sim                 default: 50% of shots hit ships, 70% of the carrier's shots
 *   pnpm balance-sim --acc 0.3 --carrier-acc 0.5
 */
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
if (process.argv.includes('--economy')) {
  const { simulateEconomy } = await import('./balanceEconomy.ts');
  simulateEconomy(arg('players', 10), arg('minutes', 20));
  process.exit(0);
}
const acc = arg('acc', 0.5);
const carrierAcc = arg('carrier-acc', 0.7);

const ships: ShipDef[] = Object.values(SHIPS);
const label = (d: ShipDef): string => `T${d.tier} ${d.id}`.padEnd(24);
const num = (v: number, width = 7, digits = 1): string => v.toFixed(digits).padStart(width);
const rangeOf = (d: ShipDef): number => Math.max(...d.mounts.map((m) => WEAPONS[m.weapon].range));

console.log(
  `Tick rate ${TICK_RATE} Hz. Accuracy ${acc * 100}% (ships), ${carrierAcc * 100}% (carrier).\n`,
);

console.log('Ships'.padEnd(24) + '  shield    hull     EHP     DPS   range  speed');
for (const d of [...ships, CARRIER]) {
  console.log(
    `${label(d)}${num(d.shield)}${num(d.hull)}${num(effectiveHealth(d))}${num(sustainedDps(d))}${num(rangeOf(d), 7, 0)}${num(d.vMax, 7, 0)}`,
  );
}

console.log('\nSeconds for ONE attacker (row) to sink ONE victim (column):');
console.log(
  ''.padEnd(24) + ships.map((d) => `T${d.tier} ${d.id.slice(0, 5)}`.padStart(11)).join(''),
);
for (const a of ships) {
  console.log(label(a) + ships.map((v) => num(timeToKill(a, v, acc), 11)).join(''));
}

console.log(
  `\nSeconds for N ships of one class to sink the ENEMY CARRIER (EHP ${effectiveHealth(CARRIER)}):`,
);
const counts = [1, 3, 5, 10];
console.log(''.padEnd(24) + counts.map((n) => `${n} ships`.padStart(11)).join(''));
for (const a of ships) {
  console.log(label(a) + counts.map((n) => num(timeToKill(a, CARRIER, acc, n), 11)).join(''));
}

console.log('\nSeconds for the carrier turrets to sink a ship that stays in range of both:');
for (const v of ships) {
  console.log(
    `${label(v)}${num(timeToKill(CARRIER, v, carrierAcc), 7)}   (carrier DPS ${sustainedDps(CARRIER).toFixed(1)})`,
  );
}
