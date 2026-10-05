import type { PerspectiveCamera } from 'three';
import { TRAINING } from '@tidebreaker/shared';
import type { Combatant } from '@tidebreaker/shared';
import type { ShipModel } from '../render/assets.ts';
import type { HealthBar } from './healthBar.ts';
import { PoseInterp } from './pose.ts';

/** A ship in the scene: sim state plus its interpolated visual. */
export class ShipEntity {
  readonly combatant: Combatant;
  readonly model: ShipModel;
  readonly bar: HealthBar | null;
  readonly pose = new PoseInterp();
  /** World-space aim angle of the turret (sim radians). */
  aim = 0;
  sinkSeconds = 0;
  flashSeconds = 0;
  respawnSeconds = 0;

  constructor(combatant: Combatant, model: ShipModel, bar: HealthBar | null) {
    this.combatant = combatant;
    this.model = model;
    this.bar = bar;
    this.model.root.rotation.order = 'YXZ';
    this.aim = combatant.state.heading;
    this.pose.snap(combatant.state.x, combatant.state.y, combatant.state.heading);
  }

  render(alpha: number, dtSec: number, camera: PerspectiveCamera): void {
    const s = this.combatant.state;
    this.pose.resolve(s.x, s.y, s.heading, alpha);

    let sink = 0;
    if (s.alive) {
      this.sinkSeconds = 0;
    } else {
      this.sinkSeconds += dtSec;
      sink = Math.min(1, this.sinkSeconds / TRAINING.sinkAnimSec);
    }
    const root = this.model.root;
    root.visible = sink < 1;
    root.position.set(this.pose.x, -sink * 2.4, this.pose.y);
    root.rotation.y = -this.pose.heading;
    root.rotation.x = sink * 0.45;
    // Turret yaw is relative to the hull: world yaw is -aim, hull yaw is -heading.
    this.model.aimTurrets(this.pose.heading, this.aim);

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
      );
    }
  }
}
