import {
  ECONOMY,
  STAT_COUNT,
  TEAM_BLUE,
  TEAM_RED,
  angleDiff,
  segmentVsWorld,
  statCap,
  statCost,
} from '@tidebreaker/shared';
import { World } from '../sim/hot/world.ts';

/**
 * Pacing of the money economy (GAME_DESIGN.md §6, §7): `players` ships that do nothing but collect
 * crates, barrels, chests and loot, and spend everything on upgrades and class jumps. It shows how
 * long the pickups alone need to reach each class when the sea is shared. Combat income (kills,
 * damage to the carrier) comes on top of this, so this is the slow end of the real pacing.
 *
 *   pnpm balance-sim --economy [--players 10] [--minutes 20]
 */
export function simulateEconomy(players: number, minutes: number): void {
  const world = new World(1337);
  const slots: number[] = [];
  for (let i = 0; i < players; i++)
    slots.push(world.addPlayer(i % 2 === 0 ? TEAM_BLUE : TEAM_RED, 0));
  const reached = slots.map(() => [0, 0, 0, 0, 0].map(() => -1));
  const ticks = Math.floor(minutes * 60 * 20);
  const next = slots.map(() => 0);

  for (let t = 0; t < ticks; t++) {
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k]!;
      const ship = world.slots[s]!;
      const st = ship.state;
      // Greedy: sail to the nearest pickup, steering around land like the test bots do.
      let best = -1;
      let bestD = Infinity;
      const p = world.pickups;
      for (let i = 0; i < p.active.length; i++) {
        if (p.active[i] === 0) continue;
        const d = Math.hypot(p.x[i]! - st.x, p.y[i]! - st.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        const want = Math.atan2(p.y[best]! - st.y, p.x[best]! - st.x);
        let heading = want;
        for (const swerve of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9]) {
          const a = want + swerve;
          const len = 26;
          if (
            segmentVsWorld(
              world.land,
              st.x,
              st.y,
              st.x + Math.cos(a) * len,
              st.y + Math.sin(a) * len,
            ) < 0
          ) {
            heading = a;
            break;
          }
        }
        world.moveShip(s, Math.max(-1, Math.min(1, angleDiff(heading, st.heading) * 2.5)), 1);
      }
      // Spend: class jump first, then stats in turn.
      world.tierUp(s);
      for (let tries = 0; tries < STAT_COUNT; tries++) {
        const stat = next[k]!;
        const level = world.level(s, stat);
        if (level < statCap(world.tier[s]!) && world.cash[s]! >= statCost(level)) {
          world.upgrade(s, stat);
          next[k] = (stat + 1) % STAT_COUNT;
          break;
        }
        next[k] = (stat + 1) % STAT_COUNT;
      }
      const tier = world.tier[s]!;
      if (reached[k]![tier]! < 0) reached[k]![tier] = t / 20;
    }
    world.step();
  }

  console.log(
    `${players} greedy collectors, ${minutes} min, pickups only (no fights). Seconds to reach each class:`,
  );
  console.log('class   median    fastest   slowest   reached');
  for (let tier = 0; tier < 5; tier++) {
    const times = reached
      .map((r) => r[tier]!)
      .filter((v) => v >= 0)
      .sort((a, b) => a - b);
    const med = times.length ? times[Math.floor(times.length / 2)]! : NaN;
    const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(0).padStart(7) : '      -');
    console.log(
      `T${tier + 1}     ${f(med)}   ${f(times[0] ?? NaN)}   ${f(times[times.length - 1] ?? NaN)}   ${times.length}/${players}`,
    );
  }
  console.log(
    `\nTargets (medium pace): T2 ~90 s, T3 ~240 s, T4 ~480 s, T5 ~900 s. Income per crate ${ECONOMY.pickups.crate.cash} x zone multiplier.`,
  );
}
