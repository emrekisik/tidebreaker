import type { PerspectiveCamera } from 'three';
import { CAMERA, DEG2RAD, Mulberry32 } from '@tidebreaker/shared';

/** Follows a ground point with exponential smoothing, at a fixed pitch (GAME_DESIGN.md §12.3). */
export class CameraRig {
  focusX = 0;
  focusZ = 0;
  private ready = false;
  /** Current shake strength (world units); decays on its own. */
  private shakeAmount = 0;
  private readonly rng = new Mulberry32(0x5eed);
  private readonly sinPitch = Math.sin(CAMERA.pitchDeg * DEG2RAD);
  private readonly cosPitch = Math.cos(CAMERA.pitchDeg * DEG2RAD);

  /** Adds a camera kick (hits, collisions); the strongest recent kick wins. */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

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
    let ox = 0;
    let oy = 0;
    if (this.shakeAmount > 0.005) {
      ox = (this.rng.next() - 0.5) * 2 * this.shakeAmount;
      oy = (this.rng.next() - 0.5) * 2 * this.shakeAmount;
      this.shakeAmount *= Math.exp(-dtSec * 7);
    } else {
      this.shakeAmount = 0;
    }
    camera.position.set(
      this.focusX + ox,
      distance * this.sinPitch + oy,
      this.focusZ + distance * this.cosPitch,
    );
    camera.lookAt(this.focusX, 0, this.focusZ);
  }
}
