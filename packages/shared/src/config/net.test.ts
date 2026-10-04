import { describe, expect, it } from 'vitest';
import { STEP_MS, TICK_RATE } from './net.ts';

describe('net config', () => {
  it('derives the fixed step from the tick rate', () => {
    expect(STEP_MS * TICK_RATE).toBeCloseTo(1000);
  });
});
