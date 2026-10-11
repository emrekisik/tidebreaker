import { describe, expect, it } from 'vitest';
import { PIRATE_TYPES, SHIPS } from '@tidebreaker/shared';
import { MODEL_SPECS } from './modelSpecs.ts';

describe('ship configs vs 3D model specs', () => {
  const defs = [...Object.values(SHIPS), ...PIRATE_TYPES.map((t) => t.def)];
  for (const def of defs) {
    it(`${def.id}: model "${def.modelKey}" matches length and mount count`, () => {
      const spec = MODEL_SPECS[def.modelKey];
      expect(spec, `missing MODEL_SPECS entry for ${def.modelKey}`).toBeDefined();
      expect(spec?.length).toBe(def.length);
      expect(spec?.aimNodes.length).toBe(def.mounts.length);
    });
  }
});
