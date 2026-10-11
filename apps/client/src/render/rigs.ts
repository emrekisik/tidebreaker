import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import type { BufferGeometry, Material, Scene } from 'three';
import { RIG, RIGS, RIG_NO_OWNER, TEAM_BLUE } from '@tidebreaker/shared';
import type { RigState } from '@tidebreaker/shared';
import { WAVE_MAX } from './waves.ts';

const TEX = 256;
const BLUE = '#4aa8ff';
const RED = '#ff4d5a';
const NEUTRAL = '#dfeaf2';
/** The modelled platform is this much wider than the solid collision circle. */
const PLATFORM_FIT = 1.35;

/** One oil rig: the platform and a flat gauge ring on the water showing who is winning it. */
class RigModel {
  readonly group = new Group();
  private readonly canvas = document.createElement('canvas');
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private lastKey = '';

  constructor(
    x: number,
    y: number,
    model: { geometry: BufferGeometry; material: Material } | null,
  ) {
    this.group.position.set(x, 0, y);
    if (model) {
      // The modelled platform (the model is fitted to a unit footprint, sea level at y = 0).
      const platform = new Mesh(model.geometry, model.material);
      platform.scale.setScalar(RIG.platformRadius * 2 * PLATFORM_FIT);
      this.group.add(platform);
    } else {
      this.addProceduralPlatform();
    }

    // The capture circle: a flat plane just above the highest wave, textured with the gauge.
    this.addGauge();
  }

  /** The fallback look: four legs in the sea, a deck on top, a derrick tower and a flare. */
  private addProceduralPlatform(): void {
    const steel = new MeshLambertMaterial({ color: 0x6d7782, flatShading: true });
    const dark = new MeshLambertMaterial({ color: 0x2e353d, flatShading: true });
    const rust = new MeshLambertMaterial({ color: 0xb9633a, flatShading: true });
    const r = RIG.platformRadius;
    const leg = new CylinderGeometry(0.7, 0.9, 6, 8);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const m = new Mesh(leg, dark);
        m.position.set(sx * r * 0.62, 1.6, sz * r * 0.62);
        this.group.add(m);
      }
    }
    const deck = new Mesh(new BoxGeometry(r * 2.1, 0.9, r * 2.1), steel);
    deck.position.y = 4.4;
    this.group.add(deck);
    const cabin = new Mesh(new BoxGeometry(r * 0.8, 1.8, r * 0.8), rust);
    cabin.position.set(-r * 0.45, 5.7, -r * 0.35);
    this.group.add(cabin);
    const tower = new Mesh(new ConeGeometry(r * 0.42, 8, 4), dark);
    tower.position.set(r * 0.3, 9.1, r * 0.1);
    tower.rotation.y = Math.PI / 4;
    this.group.add(tower);
    const flare = new Mesh(
      new CylinderGeometry(0.12, 0.12, 5, 6),
      new MeshLambertMaterial({ color: 0x40464d }),
    );
    flare.position.set(r * 0.85, 7.2, -r * 0.8);
    this.group.add(flare);
    const flame = new Mesh(
      new ConeGeometry(0.45, 1.3, 6),
      new MeshBasicMaterial({ color: 0xffa83a }),
    );
    flame.position.set(r * 0.85, 10.3, -r * 0.8);
    this.group.add(flame);
  }

  private addGauge(): void {
    this.canvas.width = TEX;
    this.canvas.height = TEX;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const size = RIG.captureRadius * 2.1;
    const ring = new Mesh(
      new PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    ring.position.y = WAVE_MAX + 0.15;
    ring.renderOrder = 2;
    this.group.add(ring);
    this.draw(0, RIG_NO_OWNER);
  }

  /** Redraws the gauge texture when the state changed. */
  draw(meter: number, owner: number): void {
    const key = `${Math.round(meter * 100)}:${owner}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.ctx;
    const c = TEX / 2;
    const R = (RIG.captureRadius / (RIG.captureRadius * 1.05)) * c * 0.95;
    g.clearRect(0, 0, TEX, TEX);
    const team = owner === RIG_NO_OWNER ? NEUTRAL : owner === TEAM_BLUE ? BLUE : RED;
    // A faint fill in the owner's color, so a held rig is visible from far away.
    g.globalAlpha = owner === RIG_NO_OWNER ? 0.06 : 0.16;
    g.fillStyle = team;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    // The track of the gauge.
    g.globalAlpha = 0.55;
    g.lineWidth = 9;
    g.strokeStyle = NEUTRAL;
    g.beginPath();
    g.arc(c, c, R - 6, 0, Math.PI * 2);
    g.stroke();
    // The part of the track the leading team has filled, clockwise from the top.
    if (Math.abs(meter) > 0.005) {
      g.globalAlpha = 1;
      g.lineWidth = 13;
      g.strokeStyle = meter > 0 ? BLUE : RED;
      g.beginPath();
      g.arc(c, c, R - 6, -Math.PI / 2, -Math.PI / 2 + Math.abs(meter) * Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }
}

/** The oil rigs in the 3D world (positions come from the shared config). */
export class RigView {
  private readonly models: RigModel[] = [];

  constructor(scene: Scene, platform: { geometry: BufferGeometry; material: Material } | null) {
    for (const rig of RIGS) {
      const m = new RigModel(rig.x, rig.y, platform);
      this.models.push(m);
      scene.add(m.group);
    }
  }

  /** The server's latest gauges. */
  set(rows: readonly RigState[]): void {
    for (let i = 0; i < this.models.length; i++) {
      const r = rows[i];
      if (r) this.models[i]!.draw(r.meter, r.owner);
    }
  }
}
