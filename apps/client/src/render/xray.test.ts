import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { FX } from '@tidebreaker/shared';
import { XRay } from './xray.ts';

/** The instance matrix of the n-th silhouette. */
function matrixOf(xray: XRay, n: number): Matrix4 {
  const m = new Matrix4();
  m.fromArray(xray.mesh.instanceMatrix.array as Float32Array, n * 16);
  return m;
}

describe('X-ray silhouettes', () => {
  const cam = new Vector3(40, 90, 120);
  const ship = { x: 55, z: 30, heading: 0.8, length: 12, width: 3.5, top: 4 };

  function drawn(): XRay {
    const xray = new XRay();
    xray.begin(cam.x, cam.y, cam.z);
    xray.add(ship.x, ship.z, ship.heading, ship.length, ship.width, ship.top, 1);
    xray.end();
    return xray;
  }

  it('puts the shape at the height of the top of the ship, on the line of sight to the middle of its body', () => {
    const xray = drawn();
    expect(xray.mesh.count).toBe(1);
    const centre = new Vector3(0, 0, 0).applyMatrix4(matrixOf(xray, 0));
    expect(centre.y).toBeCloseTo(ship.top, 5);
    // The camera, the middle of the body (at `align` of the height) and the centre of the shape are in one line.
    const body = new Vector3(ship.x, ship.top * FX.xray.align, ship.z);
    const toBody = body.clone().sub(cam).normalize();
    const toCentre = centre.clone().sub(cam).normalize();
    expect(toBody.distanceTo(toCentre)).toBeLessThan(1e-5);
  });

  it('turns the shape like the ship (bow along its heading) and makes it as big as the body looks', () => {
    const xray = drawn();
    const m = matrixOf(xray, 0);
    const centre = new Vector3(0, 0, 0).applyMatrix4(m);
    const bow = new Vector3(0.5, 0, 0).applyMatrix4(m).sub(centre);
    expect(bow.normalize().x).toBeCloseTo(Math.cos(ship.heading), 5);
    expect(bow.z).toBeCloseTo(Math.sin(ship.heading), 5);
    // Nearer to the camera than the body by the share k, so smaller by k.
    const mid = ship.top * FX.xray.align;
    const k = (cam.y - ship.top) / (cam.y - mid);
    const length = new Vector3(0.5, 0, 0).applyMatrix4(m).distanceTo(new Vector3(-0.5, 0, 0).applyMatrix4(m));
    expect(length).toBeCloseTo(ship.length * k, 4);
    const width = new Vector3(0, 0, 0.5).applyMatrix4(m).distanceTo(new Vector3(0, 0, -0.5).applyMatrix4(m));
    expect(width).toBeCloseTo(ship.width * k, 4);
  });

  it('draws nothing when no ship was added, and keeps within its capacity', () => {
    const xray = new XRay();
    xray.begin(0, 100, 0);
    xray.end();
    expect(xray.mesh.count).toBe(0);
    xray.begin(0, 100, 0);
    for (let i = 0; i < 1000; i++) xray.add(i, 0, 0, 5, 2, 3, 0);
    xray.end();
    expect(xray.mesh.count).toBeLessThanOrEqual(xray.mesh.instanceMatrix.count);
  });
});
