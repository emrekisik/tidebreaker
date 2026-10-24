import { describe, expect, it } from 'vitest';
import { PIRATE_TYPES } from './pirates.ts';
import { WEAPONS } from './weapons.ts';

describe('pirate ships', () => {
  it('carry cannons only: on the broadsides, or in the bow for the channel sentries', () => {
    for (const t of PIRATE_TYPES) {
      expect(t.def.mounts.length).toBeGreaterThan(0);
      for (const m of t.def.mounts) {
        expect(WEAPONS[m.weapon].visual).toBe('shell');
        expect(m.weapon.startsWith('pirate_cannon')).toBe(true);
        if (t.style === 'broadside') expect(Math.abs(m.facingDeg)).toBe(90);
        else expect(m.facingDeg).toBe(0);
      }
    }
  });

  it('grow stronger with the class (the sea pirates; the channel sentry is a raider that fights ahead)', () => {
    const sea = PIRATE_TYPES.filter((t) => t.style === 'broadside');
    expect(sea.length).toBe(3);
    for (let i = 1; i < sea.length; i++) {
      const a = sea[i - 1]!;
      const b = sea[i]!;
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
