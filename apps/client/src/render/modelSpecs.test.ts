import { describe, expect, it } from 'vitest';
import { SHIPS } from '@tidebreaker/shared';
import { MODEL_SPECS } from './modelSpecs.ts';

describe('ship configs vs 3D model specs', () => {
  for (const def of Object.values(SHIPS)) {
    it(`${def.id}: model "${def.modelKey}" matches length and mount count`, () => {
      const spec = MODEL_SPECS[def.modelKey];
      expect(spec, `missing MODEL_SPECS entry for ${def.modelKey}`).toBeDefined();
      expect(spec?.length).toBe(def.length);
      expect(spec?.aimNodes.length).toBe(def.mounts.length);
    });
  }
});
