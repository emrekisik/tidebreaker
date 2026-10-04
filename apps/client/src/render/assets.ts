import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Palette = 'player' | 'target';

const PALETTES: Record<Palette, { hull: number; deck: number; trim: number; gun: number }> = {
  player: { hull: 0x2f6fb5, deck: 0xe8edf2, trim: 0xf2c14e, gun: 0x394150 },
  target: { hull: 0xb5412f, deck: 0xe8d9c8, trim: 0x3a2a24, gun: 0x2b2b2b },
};

/** A ship's scene objects. Hull and turret are separate meshes so the turret can rotate. */
export class ShipModel {
  readonly root = new Group();
  readonly turret = new Group();
  private readonly hullMesh: Mesh;
  private readonly turretMesh: Mesh;
  private readonly normal: MeshLambertMaterial;
  private readonly flash: MeshLambertMaterial;
  private flashing = false;

  constructor(
    hull: BufferGeometry,
    turretGeo: BufferGeometry,
    shadow: Mesh,
    normal: MeshLambertMaterial,
    flash: MeshLambertMaterial,
    turretOffsetX: number,
  ) {
    this.normal = normal;
    this.flash = flash;
    this.hullMesh = new Mesh(hull, normal);
    this.turretMesh = new Mesh(turretGeo, normal);
    this.turret.position.set(turretOffsetX, 0.8, 0);
    this.turret.add(this.turretMesh);
    this.root.add(shadow, this.hullMesh, this.turret);
  }

  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    const m = on ? this.flash : this.normal;
    this.hullMesh.material = m;
    this.turretMesh.material = m;
  }
}

function part(
  geo: BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  matrix?: Matrix4,
): BufferGeometry {
  if (matrix) geo.applyMatrix4(matrix);
  geo.translate(x, y, z);
  const c = new Color(color);
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Supplies models by key. Today everything is a procedural placeholder built from boxes; final
 * GLB models plug in here later without touching the game code (GAME_DESIGN.md §12.5).
 */
export class AssetProvider {
  private readonly normal = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly flash = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    emissive: 0xffffff,
    emissiveIntensity: 0.7,
  });
  private readonly shadowGeo = new CircleGeometry(1, 20).rotateX(-Math.PI / 2).scale(3.4, 1, 1.9);
  private readonly shadowMat = new MeshBasicMaterial({
    color: 0x061c2e,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  private readonly cache = new Map<string, { hull: BufferGeometry; turret: BufferGeometry }>();

  createShip(modelKey: string, palette: Palette): ShipModel {
    const cacheKey = `${modelKey}:${palette}`;
    let geos = this.cache.get(cacheKey);
    if (!geos) {
      geos = this.buildPlaceholderShip(palette);
      this.cache.set(cacheKey, geos);
    }
    const shadow = new Mesh(this.shadowGeo, this.shadowMat);
    shadow.position.y = 0.25;
    return new ShipModel(geos.hull, geos.turret, shadow, this.normal, this.flash, 0.3);
  }

  private buildPlaceholderShip(palette: Palette): { hull: BufferGeometry; turret: BufferGeometry } {
    const p = PALETTES[palette];
    // Bow: a 4-sided pyramid pointing along +x.
    const bowRot = new Matrix4()
      .makeRotationZ(-Math.PI / 2)
      .multiply(new Matrix4().makeRotationY(Math.PI / 4));
    const hull = merge([
      part(new BoxGeometry(3.6, 0.9, 1.9), p.hull, -0.6, 0.45, 0),
      part(new ConeGeometry(0.95 * Math.SQRT2, 1.4, 4), p.hull, 1.9, 0.45, 0, bowRot),
      // Deck slab is narrower than the hull so the hull color stays visible as a rim.
      part(new BoxGeometry(3.3, 0.1, 1.45), p.deck, -0.6, 0.93, 0),
      part(new BoxGeometry(1.3, 0.8, 1.1), p.trim, -1.0, 1.35, 0),
      part(new BoxGeometry(0.5, 0.2, 0.8), p.gun, -1.0, 1.85, 0),
    ]);
    const turret = merge([
      part(new CylinderGeometry(0.42, 0.5, 0.35, 8), p.gun, 0, 0.17, 0),
      part(new BoxGeometry(1.2, 0.2, 0.2), p.gun, 0.7, 0.35, 0),
    ]);
    return { hull, turret };
  }
}
