import { Group, Mesh } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { disposeNameTag } from '../render/barKit.ts';
import type { BarKit } from '../render/barKit.ts';

type Team = 'blue' | 'red';
import { GhostTracker } from './ghost.ts';

const WIDTH = 5;
const HEIGHT_ABOVE_WATER = 4.2;

/** Camera-facing hull/shield bar floating above a ship. */
export class HealthBar {
  private readonly group = new Group();
  private readonly hull: Mesh;
  private readonly shield: Mesh;
  private readonly hullGhost: Mesh;
  private readonly shieldGhost: Mesh;
  private readonly hullTrack = new GhostTracker();
  private readonly shieldTrack = new GhostTracker();
  private readonly tag: Mesh | null;

  /** `name`: shows a name plate above the bar (omit it for ships that need none). */
  constructor(scene: Scene, kit: BarKit, team: Team, name?: string) {
    const bg = new Mesh(kit.bgGeo, kit.bgMat);
    this.hullGhost = new Mesh(kit.hullGeo, kit.ghostMat);
    this.shieldGhost = new Mesh(kit.shieldGeo, kit.ghostMat);
    this.hull = new Mesh(kit.hullGeo, kit.hullMat[team]);
    this.shield = new Mesh(kit.shieldGeo, kit.shieldMat);
    bg.renderOrder = 10;
    this.hullGhost.renderOrder = 11;
    this.shieldGhost.renderOrder = 11;
    this.hull.renderOrder = 12;
    this.shield.renderOrder = 12;
    this.hull.position.set(0, -0.14, 0.01);
    this.hullGhost.position.set(0, -0.14, 0.005);
    this.shield.position.set(0, 0.2, 0.01);
    this.shieldGhost.position.set(0, 0.2, 0.005);
    this.group.add(bg, this.hullGhost, this.shieldGhost, this.hull, this.shield);
    this.tag = name ? kit.makeNameTag(name, team) : null;
    if (this.tag) {
      this.tag.position.set(0, 1.55, 0.02);
      this.group.add(this.tag);
    }
    scene.add(this.group);
  }

  /** Takes the bar out of the scene (the ship is gone). */
  remove(scene: Scene): void {
    scene.remove(this.group);
    if (this.tag) disposeNameTag(this.tag);
  }

  update(
    camera: PerspectiveCamera,
    x: number,
    z: number,
    hullFrac: number,
    shieldFrac: number,
    visible: boolean,
    dtSec: number,
  ): void {
    this.group.visible = visible;
    if (!visible) {
      // Start the next life with a clean bar.
      this.hullTrack.reset(1);
      this.shieldTrack.reset(1);
      return;
    }
    this.group.position.set(x, HEIGHT_ABOVE_WATER, z);
    this.group.quaternion.copy(camera.quaternion);
    this.fill(this.hull, hullFrac);
    this.fill(this.shield, shieldFrac);
    this.fill(this.hullGhost, this.hullTrack.update(hullFrac, dtSec));
    this.fill(this.shieldGhost, this.shieldTrack.update(shieldFrac, dtSec));
  }

  private fill(mesh: Mesh, frac: number): void {
    const f = frac < 0.0001 ? 0.0001 : frac > 1 ? 1 : frac;
    mesh.scale.x = f;
    mesh.position.x = -(1 - f) * (WIDTH / 2);
  }
}
