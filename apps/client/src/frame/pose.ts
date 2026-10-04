import { lerp, lerpAngle } from '@tidebreaker/shared';

/** Keeps the previous sim pose so rendering can interpolate between two fixed steps. */
export class PoseInterp {
  prevX = 0;
  prevY = 0;
  prevHeading = 0;
  x = 0;
  y = 0;
  heading = 0;

  /** Call right before each sim step with the pre-step state. */
  capture(x: number, y: number, heading: number): void {
    this.prevX = x;
    this.prevY = y;
    this.prevHeading = heading;
  }

  /** Teleport: no interpolation across the jump. */
  snap(x: number, y: number, heading: number): void {
    this.capture(x, y, heading);
    this.x = x;
    this.y = y;
    this.heading = heading;
  }

  resolve(curX: number, curY: number, curHeading: number, alpha: number): void {
    this.x = lerp(this.prevX, curX, alpha);
    this.y = lerp(this.prevY, curY, alpha);
    this.heading = lerpAngle(this.prevHeading, curHeading, alpha);
  }
}
