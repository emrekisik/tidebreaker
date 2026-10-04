import type { PerspectiveCamera } from 'three';
import { CAMERA, DEG2RAD } from '@tidebreaker/shared';

/** Follows a ground point with exponential smoothing, at a fixed pitch (GAME_DESIGN.md §12.3). */
export class CameraRig {
  focusX = 0;
  focusZ = 0;
  private ready = false;
  private readonly sinPitch = Math.sin(CAMERA.pitchDeg * DEG2RAD);
  private readonly cosPitch = Math.cos(CAMERA.pitchDeg * DEG2RAD);

  update(
    camera: PerspectiveCamera,
    targetX: number,
    targetZ: number,
    dtSec: number,
    tier: number,
  ): void {
    if (!this.ready) {
      this.focusX = targetX;
      this.focusZ = targetZ;
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-CAMERA.followRate * dtSec);
      this.focusX += (targetX - this.focusX) * k;
      this.focusZ += (targetZ - this.focusZ) * k;
    }
    const distance = CAMERA.baseDistance + CAMERA.perTier * tier;
    // Camera sits on the +z side looking toward -z, so screen-up is -z (sim -y).
    camera.position.set(
      this.focusX,
      distance * this.sinPitch,
      this.focusZ + distance * this.cosPitch,
    );
    camera.lookAt(this.focusX, 0, this.focusZ);
  }
}
