import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, Vector3 } from 'three';
import { FX } from '@tidebreaker/shared';
import { bakeShipPlace } from './assets.ts';

describe('team paint livery', () => {
  it('writes where each vertex lies in the ship: stern/bow, keel/top, port/starboard', () => {
    // A hull box 4 long (x, bow at +x), 1 tall and 2 wide, with the keel at y = 0, put in the middle of the ship space.
    const box = { min: new Vector3(-2, 0, -1), max: new Vector3(2, 1, 1) };
    const mesh = new Mesh(new BoxGeometry(4, 1, 2).translate(0, 0.5, 0));
    mesh.updateMatrixWorld(true);
    bakeShipPlace(mesh, box);
    const place = mesh.geometry.getAttribute('aShip');
    const seen = new Set<string>();
    for (let i = 0; i < place.count; i++) seen.add([place.getX(i), place.getY(i), place.getZ(i)].map((n) => n.toFixed(2)).join(','));
    // The eight corners are the extremes of every axis.
    for (const u of [-1, 1]) for (const v of [0, 1]) for (const w of [-1, 1]) expect(seen).toContain(`${u.toFixed(2)},${v.toFixed(2)},${w.toFixed(2)}`);
  });

  it('applies the mesh transform (a model turned or scaled by its node)', () => {
    const box = { min: new Vector3(-4, 0, -1), max: new Vector3(4, 2, 1) };
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.scale.set(8, 2, 2);
    mesh.position.set(0, 1, 0);
    mesh.updateMatrixWorld(true);
    bakeShipPlace(mesh, box);
    const place = mesh.geometry.getAttribute('aShip');
    let maxU = -Infinity;
    for (let i = 0; i < place.count; i++) maxU = Math.max(maxU, place.getX(i));
    expect(maxU).toBeCloseTo(1, 5);
  });

  it('is written once per geometry', () => {
    const box = { min: new Vector3(-1, 0, -1), max: new Vector3(1, 1, 1) };
    const mesh = new Mesh(new BoxGeometry(2, 1, 2));
    mesh.updateMatrixWorld(true);
    bakeShipPlace(mesh, box);
    const first = mesh.geometry.getAttribute('aShip');
    bakeShipPlace(mesh, { min: new Vector3(-9, 0, -9), max: new Vector3(9, 5, 9) });
    expect(mesh.geometry.getAttribute('aShip')).toBe(first);
  });

  it('keeps part of every ship unpainted by default (the flank stripe and the bow cap leave the rest)', () => {
    const L = FX.livery;
    expect(L.flank).toBeGreaterThan(0.5);
    expect(L.flank).toBeLessThanOrEqual(1);
    expect(L.hi - L.lo).toBeLessThan(0.7);
    expect(L.bow).toBeGreaterThan(0.3);
  });
});
