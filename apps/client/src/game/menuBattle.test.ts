import { describe, expect, it } from 'vitest';
import type { Scene } from 'three';
import { MENU_BATTLE, TRAINING, WORLD_SIZE, circleVsWorld, generateMap } from '@tidebreaker/shared';
import type { AssetProvider } from '../render/assets.ts';
import { MenuBattle } from './menuBattle.ts';
import type { GameEvents } from './localGame.ts';

/** Just enough of a model for the sim side of the fight (nothing is drawn). */
const fakeAssets = {
  createShip: () => ({ root: { rotation: {} } }),
} as unknown as AssetProvider;
const fakeScene = { add: () => undefined, remove: () => undefined } as unknown as Scene;

function setup() {
  const counts = { shots: 0, hits: 0, kills: 0 };
  const events = {
    onShot: () => counts.shots++,
    onHit: (_x: number, _y: number, _d: number, _s: boolean, killed: boolean) => {
      counts.hits++;
      if (killed) counts.kills++;
    },
    onMiss: () => undefined,
    onBlocked: () => undefined,
    onIslandHit: () => undefined,
    onCollision: () => undefined,
  } as unknown as GameEvents;
  const map = generateMap(TRAINING.mapSeed);
  const battle = new MenuBattle(fakeScene, fakeAssets, events, map, WORLD_SIZE / 2, WORLD_SIZE / 2);
  return { battle, map, counts };
}

describe('menu battle', () => {
  it('puts a fleet of each team on the water, in open sea', () => {
    const { battle, map } = setup();
    expect(battle.entities.length).toBe(MENU_BATTLE.fleet.length * 2);
    const out = new Float32Array(3);
    for (const e of battle.entities) {
      const s = e.combatant.state;
      expect(circleVsWorld(map, s.x, s.y, 5, out)).toBe(false);
    }
  });

  it('fights: ships shoot, hit and sink each other, and the sunk ones come back', () => {
    const { battle, counts } = setup();
    let sunkOnce = false;
    let backAgain = false;
    // Five minutes of the fight at 20 Hz, with the camera drifting over the map.
    for (let tick = 0; tick < 20 * 300; tick++) {
      const a = tick * 0.0017;
      battle.step(WORLD_SIZE / 2 + Math.cos(a) * 240, WORLD_SIZE / 2 - 70 + Math.sin(a * 1.3) * 150);
      for (const e of battle.entities) {
        const alive = e.combatant.state.alive;
        if (!alive) sunkOnce = true;
        else if (sunkOnce && e.respawnSeconds === 0) backAgain = true;
      }
    }
    expect(counts.shots).toBeGreaterThan(100);
    expect(counts.hits).toBeGreaterThan(20);
    expect(counts.kills).toBeGreaterThan(0);
    expect(sunkOnce).toBe(true);
    expect(backAgain).toBe(true);
  });

  it('keeps the ships on the water near the middle of the fight', () => {
    const { battle, map } = setup();
    const out = new Float32Array(3);
    let onLand = 0;
    let samples = 0;
    let near = 0;
    for (let tick = 0; tick < 20 * 120; tick++) {
      const a = tick * 0.0017;
      battle.step(WORLD_SIZE / 2 + Math.cos(a) * 240, WORLD_SIZE / 2 - 70 + Math.sin(a * 1.3) * 150);
      if (tick % 20 !== 0) continue;
      for (const e of battle.entities) {
        const s = e.combatant.state;
        if (!s.alive) continue;
        samples++;
        if (circleVsWorld(map, s.x, s.y, 1, out)) onLand++;
        // (A ship that just came back sails in from the edge of the view, `startGap` away.)
        if (Math.hypot(s.x - battle.arenaX, s.y - battle.arenaY) < MENU_BATTLE.startGap * 1.3) near++;
      }
    }
    // (A ship grazing a coast now and then is fine; sitting on land is not.)
    expect(onLand / samples).toBeLessThan(0.02);
    expect(near / samples).toBeGreaterThan(0.9);
  });
});
