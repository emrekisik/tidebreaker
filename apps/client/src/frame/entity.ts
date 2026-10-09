import type { PerspectiveCamera } from 'three';
import { TRAINING } from '@tidebreaker/shared';
import type { Combatant } from '@tidebreaker/shared';
import type { ShipModel } from '../render/assets.ts';
import type { HealthBar } from './healthBar.ts';
import { PoseInterp } from './pose.ts';
import { waveHeight, waveSlope } from '../render/waves.ts';

const slope = new Float32Array(2);
/** How strongly ships follow the waves (1 = exactly). Tilt is exaggerated so it reads from above. */
const BOB = 0.5;
const TILT = 1.0;

/** A ship in the scene: sim state plus its interpolated visual. */
export class ShipEntity {
  readonly combatant: Combatant;
  model: ShipModel;
  readonly bar: HealthBar | null;
  readonly pose = new PoseInterp();
  /** World-space aim angle of the turret (sim radians). */
  aim = 0;
  /** Distance from the ship to the aim point (turrets converge there). */
  aimDist = 0;
  /** Prediction smoothing: added to the drawn position (world units). */
  visualOffsetX = 0;
  visualOffsetY = 0;
  /** When set, every turret aims at its own angle (the carrier's turrets pick their own targets). */
  mountAims: Float32Array | null = null;
  sinkSeconds = 0;
  flashSeconds = 0;
  respawnSeconds = 0;
  /** Collision rattle: starts at the impact strength and dies out (cosmetic). */
  shake = 0;
  /** Where this ship (re)appears. */
  homeX = 0;
  homeY = 0;
  homeHeading = 0;
  /** Fractional effect timers (see Effects.ship). */
  /** Travel since the last scattered wake blob. */
  blobCarry = 0;
  /** Stern position last frame, so the wake trail has no gaps. */
  wakeX = 0;
  wakeZ = 0;
  wakeReady = false;
  smokeCarry = 0;
  fireCarry = 0;
  /** Where this ship smokes and burns: (forward, sideways) pairs, picked on first damage. */
  readonly spots = new Float32Array(6);
  spotsReady = false;

  constructor(combatant: Combatant, model: ShipModel, bar: HealthBar | null) {
    this.combatant = combatant;
    this.model = model;
    this.bar = bar;
    this.setModel(model);
    this.aim = combatant.state.heading;
    this.pose.snap(combatant.state.x, combatant.state.y, combatant.state.heading);
  }

  /** Replaces the visual (the caller adds/removes the roots from the scene). */
  setModel(model: ShipModel): void {
    this.model = model;
    model.root.rotation.order = 'YXZ';
  }

  render(alpha: number, dtSec: number, camera: PerspectiveCamera, timeSec: number): void {
    const s = this.combatant.state;
    this.pose.resolve(s.x, s.y, s.heading, alpha);
    this.pose.x += this.visualOffsetX;
    this.pose.y += this.visualOffsetY;

    let sink = 0;
    if (s.alive) {
      this.sinkSeconds = 0;
    } else {
      this.sinkSeconds += dtSec;
      sink = Math.min(1, this.sinkSeconds / TRAINING.sinkAnimSec);
    }
    const root = this.model.root;
    root.visible = sink < 1;
    // Ride the same waves that are drawn: bob, pitch along the hull, roll across it.
    const bob = waveHeight(this.pose.x, this.pose.y, timeSec) * BOB;
    waveSlope(this.pose.x, this.pose.y, timeSec, slope);
    const c = Math.cos(this.pose.heading);
    const sn = Math.sin(this.pose.heading);
    const pitch = Math.atan(slope[0]! * c + slope[1]! * sn) * TILT;
    const roll = -Math.atan(-slope[0]! * sn + slope[1]! * c) * TILT;
    let rattleY = 0;
    let rattleRoll = 0;
    let rattlePitch = 0;
    if (this.shake > 0.01) {
      rattleY = Math.sin(timeSec * 47) * this.shake * 0.1;
      rattleRoll = Math.sin(timeSec * 36) * this.shake * 0.1;
      rattlePitch = Math.sin(timeSec * 29 + 1) * this.shake * 0.07;
      this.shake *= Math.exp(-dtSec * 3.2);
    } else {
      this.shake = 0;
    }
    root.position.set(this.pose.x, bob + rattleY - sink * 2.4, this.pose.y);
    root.rotation.y = -this.pose.heading;
    root.rotation.x = roll + rattleRoll + sink * 0.45;
    root.rotation.z = pitch + rattlePitch;
    // Foam ring and blob shadow stay on the real water surface, level, however the hull rocks.
    this.model.layDecals(
      waveHeight(this.pose.x, this.pose.y, timeSec),
      root.position.y,
      root.rotation.x,
      root.rotation.z,
    );
    // Turret yaw is relative to the hull: world yaw is -aim, hull yaw is -heading.
    if (this.mountAims) this.model.aimTurretsEach(this.pose.heading, this.mountAims);
    else this.model.aimTurrets(this.pose.x, this.pose.y, this.pose.heading, this.aim, this.aimDist);

    this.flashSeconds = this.flashSeconds > dtSec ? this.flashSeconds - dtSec : 0;
    this.model.setFlash(this.flashSeconds > 0);

    if (this.bar) {
      const def = this.combatant.def;
      this.bar.update(
        camera,
        this.pose.x,
        this.pose.y,
        s.hull / def.hull,
        s.shield / def.shield,
        s.alive,
        dtSec,
      );
    }
  }
}
