import { describe, expect, it } from 'vitest';
import { PIRATE_TYPES } from './pirates.ts';
import { WEAPONS } from './weapons.ts';

describe('pirate ships', () => {
  it('carry cannons only, on the broadsides', () => {
    for (const t of PIRATE_TYPES) {
      expect(t.def.mounts.length).toBeGreaterThan(0);
      for (const m of t.def.mounts) {
        expect(WEAPONS[m.weapon].visual).toBe('shell');
        expect(m.weapon.startsWith('pirate_cannon')).toBe(true);
        expect(Math.abs(m.facingDeg)).toBe(90);
      }
    }
  });

  it('grow stronger with the class', () => {
    for (let i = 1; i < PIRATE_TYPES.length; i++) {
      const a = PIRATE_TYPES[i - 1]!;
      const b = PIRATE_TYPES[i]!;
      expect(b.def.hull).toBeGreaterThan(a.def.hull);
      expect(b.def.length).toBeGreaterThan(a.def.length);
      expect(b.def.mounts.length).toBeGreaterThan(a.def.mounts.length);
      expect(b.reward).toBeGreaterThan(a.reward);
    }
  });
});

describe('cannon reload', () => {
  it('is slower than the machine gun by a wide margin and grows with the tier', () => {
    expect(WEAPONS.cannon_t3.intervalSec).toBeGreaterThanOrEqual(1);
    expect(WEAPONS.cannon_t4.intervalSec).toBeGreaterThanOrEqual(WEAPONS.cannon_t3.intervalSec);
    expect(WEAPONS.cannon_t5.intervalSec).toBeGreaterThanOrEqual(WEAPONS.cannon_t4.intervalSec);
  });
});
