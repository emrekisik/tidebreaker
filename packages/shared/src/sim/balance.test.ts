import { describe, expect, it } from 'vitest';
import { CARRIER } from '../config/match.ts';
import { SHIPS } from '../config/ships.ts';
import { WEAPONS } from '../config/weapons.ts';
import { effectiveHealth, sustainedDps, timeToKill } from './balance.ts';

describe('balance helpers', () => {
  it('a single-gun ship deals damage / reload', () => {
    const t1 = SHIPS.coast_guard_boat;
    const w = WEAPONS[t1.mounts[0]!.weapon];
    // Reload is rounded up to whole ticks, so the result is a little below the plain ratio.
    expect(sustainedDps(t1)).toBeGreaterThan((w.damage / w.intervalSec) * 0.9);
    expect(sustainedDps(t1)).toBeLessThanOrEqual(w.damage / w.intervalSec + 1e-9);
  });

  it('never exceeds one shot per salvo gap', () => {
    for (const def of [...Object.values(SHIPS), CARRIER]) {
      const maxDamage = Math.max(...def.mounts.map((m) => WEAPONS[m.weapon].damage));
      expect(sustainedDps(def)).toBeLessThanOrEqual(maxDamage * 10 + 1e-9);
    }
  });

  it('time to kill scales with health, accuracy and the number of attackers', () => {
    const a = SHIPS.corvette;
    const v = SHIPS.cruiser;
    const base = timeToKill(a, v, 1);
    expect(base).toBeCloseTo(effectiveHealth(v) / sustainedDps(a));
    expect(timeToKill(a, v, 0.5)).toBeCloseTo(base * 2);
    expect(timeToKill(a, v, 1, 4)).toBeCloseTo(base / 4);
  });
});
