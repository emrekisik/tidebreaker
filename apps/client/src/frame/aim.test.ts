import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { aimAngleFromScreen } from './aim.ts';

function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, 16 / 9, 1, 1000);
  cam.position.set(0, 80, 40);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('aimAngleFromScreen', () => {
  it('the screen center maps to the point the camera looks at', () => {
    const cam = makeCamera();
    // Ship west of the focus point: aim points toward +x (angle 0).
    expect(aimAngleFromScreen(cam, 0, 0, -10, 0)).toBeCloseTo(0, 5);
    // Ship at sim y = +10 (world z = +10): focus is at -y direction, angle -PI/2.
    expect(aimAngleFromScreen(cam, 0, 0, 0, 10)).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('screen up is toward -y and screen right is toward +x', () => {
    const cam = makeCamera();
    const up = aimAngleFromScreen(cam, 0, 0.5, 0, 0);
    const right = aimAngleFromScreen(cam, 0.5, 0, 0, 0);
    expect(Math.sin(up)).toBeLessThan(0);
    expect(Math.cos(right)).toBeGreaterThan(0);
  });

  it('returns NaN when the ray points above the horizon', () => {
    const cam = new PerspectiveCamera(45, 1, 1, 1000);
    cam.position.set(0, 10, 0);
    cam.lookAt(0, 20, -100);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    expect(aimAngleFromScreen(cam, 0, 0, 0, 0)).toBeNaN();
  });
});
