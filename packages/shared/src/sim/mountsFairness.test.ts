import { describe, expect, it } from 'vitest';
import { WEAPONS, weaponIndex } from '../config/weapons.ts';
import { SHIPS } from '../config/ships.ts';
import { reloadMul } from './progress.ts';
import { updateMounts } from './mounts.ts';
import { createShipState } from './types.ts';

describe('mounts take turns', () => {
  it('a fast machine gun never starves the cruiser rocket, whatever the reload upgrade', () => {
    const def = SHIPS.cruiser;
    const rocket = weaponIndex('cruiser_rocket');
    for (let level = 0; level <= 8; level++) {
      const ship = createShipState(def, 0, 0, 0);
      let rockets = 0;
      const sink = {
        spawn: (_x: number, _y: number, _a: number, _s: number, _r: number, _rad: number, _d: number, _o: number, w: number): void => {
          if (w === rocket) rockets++;
        },
      };
      const seconds = 60;
      for (let t = 0; t < seconds * 20; t++) {
        updateMounts(ship, def, 1, 0, true, 0.05, { next: () => 0.5 }, sink, 0, reloadMul(level), 0);
      }
      // About one rocket per (reload x the upgrade) seconds; allow a few ticks of slack per shot.
      const expected = seconds / (WEAPONS.cruiser_rocket.intervalSec * reloadMul(level));
      expect(rockets, `reload level ${level}`).toBeGreaterThanOrEqual(Math.floor(expected * 0.8));
    }
  });
});
