import { Group, Mesh } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { BarKit } from '../render/barKit.ts';

const WIDTH = 5;
const HEIGHT_ABOVE_WATER = 4.2;

/** Camera-facing hull/shield bar floating above a ship. */
export class HealthBar {
  private readonly group = new Group();
  private readonly hull: Mesh;
  private readonly shield: Mesh;

  constructor(scene: Scene, kit: BarKit) {
    const bg = new Mesh(kit.bgGeo, kit.bgMat);
    this.hull = new Mesh(kit.fillGeo, kit.hullMat);
    this.shield = new Mesh(kit.fillGeo, kit.shieldMat);
    bg.renderOrder = 10;
    this.hull.renderOrder = 11;
    this.shield.renderOrder = 11;
    this.hull.position.set(0, -0.23, 0.01);
    this.shield.position.set(0, 0.23, 0.01);
    this.group.add(bg, this.hull, this.shield);
    scene.add(this.group);
  }

  update(
    camera: PerspectiveCamera,
    x: number,
    z: number,
    hullFrac: number,
    shieldFrac: number,
    visible: boolean,
  ): void {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.set(x, HEIGHT_ABOVE_WATER, z);
    this.group.quaternion.copy(camera.quaternion);
    this.fill(this.hull, hullFrac);
    this.fill(this.shield, shieldFrac);
  }

  private fill(mesh: Mesh, frac: number): void {
    const f = frac < 0.0001 ? 0.0001 : frac > 1 ? 1 : frac;
    mesh.scale.x = f;
    mesh.position.x = -(1 - f) * (WIDTH / 2);
  }
}
