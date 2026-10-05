import {
  Box3,
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
  MeshStandardMaterial,
  Object3D,
  PropertyBinding,
  RingGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { Texture } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODEL_SPECS } from './modelSpecs.ts';
import type { ModelSpec } from './modelSpecs.ts';

export type Palette = 'player' | 'target';

const PALETTES: Record<Palette, { hull: number; deck: number; trim: number; gun: number }> = {
  player: { hull: 0x2f6fb5, deck: 0xe8edf2, trim: 0xf2c14e, gun: 0x394150 },
  target: { hull: 0xb5412f, deck: 0xe8d9c8, trim: 0x3a2a24, gun: 0x2b2b2b },
};

const UP = new Vector3(0, 1, 0);

/** A part that yaws toward the aim direction. */
export interface TurretRig {
  node: Object3D;
  /** World-up expressed in the node's parent space. */
  axis: Vector3;
  /** Local rotation as exported. */
  rest: Quaternion;
  /** Direction the barrel points at rest, in sim heading terms (0 = bow, PI = stern). */
  restYaw: number;
  /** Pivot position in ship space (sim units): forward (+x) and starboard (+y). */
  forward: number;
  starboard: number;
  /** Pivot-to-muzzle distance along the barrel at rest. */
  muzzle: number;
}

/** A ship's scene objects: the hull plus any number of turrets that follow the aim. */
export class ShipModel {
  readonly root = new Group();
  private readonly meshes: readonly Mesh[];
  readonly turrets: readonly TurretRig[];
  /** Hull footprint after normalization (world units). */
  hullLength = 0;
  hullWidth = 0;
  private readonly normal: MeshLambertMaterial;
  private readonly flash: MeshLambertMaterial;
  private flashing = false;
  private readonly tmp = new Quaternion();

  constructor(
    meshes: readonly Mesh[],
    turrets: readonly TurretRig[],
    normal: MeshLambertMaterial,
    flash: MeshLambertMaterial,
  ) {
    this.meshes = meshes;
    this.turrets = turrets;
    this.normal = normal;
    this.flash = flash;
  }

  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    const m = on ? this.flash : this.normal;
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i]!.material = m;
  }

  /** Turns every turret toward `aim` (sim angle) for a hull heading of `heading`. */
  aimTurrets(heading: number, aim: number): void {
    for (let i = 0; i < this.turrets.length; i++) {
      const rig = this.turrets[i]!;
      // World yaw of a three.js node is -angle, so the relative turn is (heading - aim).
      this.tmp.setFromAxisAngle(rig.axis, heading - aim + rig.restYaw);
      rig.node.quaternion.copy(this.tmp).multiply(rig.rest);
    }
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

interface LoadedModel {
  spec: ModelSpec;
  scene: Object3D;
  normal: MeshLambertMaterial;
  flash: MeshLambertMaterial;
}

/** Meshes that belong to the hull node itself (not to its turret/child nodes). */
function hullMeshes(hull: Object3D): Mesh[] {
  const out: Mesh[] = [];
  for (const c of hull.children) if ((c as Mesh).isMesh) out.push(c as Mesh);
  return out;
}

function findNode(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(PropertyBinding.sanitizeNodeName(name));
}

/**
 * Supplies ship models by key. A GLB listed in `MODEL_SPECS` is used when it was preloaded;
 * otherwise (or on any load error) a procedural placeholder is built, so the game always runs
 * (GAME_DESIGN.md §12.5).
 */
export class AssetProvider {
  private readonly normal = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly flash = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    emissive: 0xffffff,
    emissiveIntensity: 0.7,
  });
  private readonly shadowGeo = new CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private readonly shadowMat = new MeshBasicMaterial({
    color: 0x061c2e,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  /** Foam where the hull meets the water. */
  private readonly ringGeo = new RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2);
  private readonly ringMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  private readonly cache = new Map<string, { hull: BufferGeometry; turret: BufferGeometry }>();
  private readonly loaded = new Map<string, LoadedModel>();
  /** Why a model fell back to the placeholder (shown in the test panel). */
  readonly failures = new Map<string, string>();

  /** Loads the GLBs for these model keys. Failures are logged and fall back to placeholders. */
  async preload(keys: readonly string[]): Promise<void> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    await Promise.all(
      keys.map(async (key) => {
        const spec = MODEL_SPECS[key];
        if (!spec || this.loaded.has(key)) return;
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${spec.file}`);
          const hull = findNode(gltf.scene, spec.hullNode);
          const hullMesh = hull ? hullMeshes(hull)[0] : undefined;
          const map = hullMesh ? ((hullMesh.material as MeshStandardMaterial).map ?? null) : null;
          this.loaded.set(key, { spec, scene: gltf.scene, ...this.makeMaterials(map) });
          this.failures.delete(key);
        } catch (err) {
          this.failures.set(
            key,
            `${spec.file}: ${err instanceof Error ? err.message : String(err)}`,
          );
          console.warn(`Model "${key}" failed to load, using the placeholder.`, err);
        }
      }),
    );
  }

  private makeMaterials(map: Texture | null): {
    normal: MeshLambertMaterial;
    flash: MeshLambertMaterial;
  } {
    return {
      normal: new MeshLambertMaterial({ map }),
      flash: new MeshLambertMaterial({ map, emissive: 0xffffff, emissiveIntensity: 0.7 }),
    };
  }

  createShip(modelKey: string, palette: Palette): ShipModel {
    const loaded = this.loaded.get(modelKey);
    if (!loaded && MODEL_SPECS[modelKey] && !this.failures.has(modelKey) && palette === 'player') {
      this.failures.set(modelKey, 'not loaded');
    }
    // Team/faction colors are not supported on GLB models yet, so only the player uses them.
    if (loaded && palette === 'player') {
      try {
        return this.buildFromGltf(loaded);
      } catch (err) {
        this.failures.set(modelKey, err instanceof Error ? err.message : String(err));
        console.warn(`Model "${modelKey}" could not be built, using the placeholder.`, err);
      }
    }
    return this.buildPlaceholder(modelKey, palette);
  }

  private foamRing(length: number, width: number): Mesh {
    const ring = new Mesh(this.ringGeo, this.ringMat);
    ring.scale.set(length * 0.56, 1, width * 0.7);
    ring.position.y = 0.14;
    ring.renderOrder = 2;
    return ring;
  }

  private shadow(length: number, width: number, y: number): Mesh {
    const shadow = new Mesh(this.shadowGeo, this.shadowMat);
    shadow.scale.set(length * 0.52, 1, width * 0.62);
    shadow.position.y = y;
    return shadow;
  }

  private buildFromGltf(loaded: LoadedModel): ShipModel {
    const { spec } = loaded;
    const scene = loaded.scene.clone(true);
    const hull = findNode(scene, spec.hullNode);
    const hullParts = hull ? hullMeshes(hull) : [];
    if (!hull || hullParts.length === 0)
      throw new Error(`hull node "${spec.hullNode}" has no mesh`);

    const fit = new Group();
    fit.add(scene);
    // The bow axis is +z or -z in the exported frame; turn it to +x (GAME_DESIGN.md §4.1).
    fit.rotation.y = spec.bow === '+z' ? Math.PI / 2 : -Math.PI / 2;

    // Measure the hull mesh alone (turrets and masts must not change the fit).
    const hullBox = (): { min: Vector3; max: Vector3 } => {
      fit.updateMatrixWorld(true);
      const all = new Box3();
      for (const part of hullParts) {
        part.geometry.computeBoundingBox();
        all.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld));
      }
      return { min: all.min, max: all.max };
    };
    let box = hullBox();
    fit.scale.setScalar(spec.length / (box.max.x - box.min.x));
    box = hullBox();
    const height = box.max.y - box.min.y;
    fit.position.set(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + spec.draft * height),
      -(box.min.z + box.max.z) / 2,
    );
    fit.updateMatrixWorld(true);

    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) {
        (o as Mesh).material = loaded.normal;
        meshes.push(o as Mesh);
      }
    });

    const turrets: TurretRig[] = [];
    const pivot = new Vector3();
    const center = new Vector3();
    const parentQuat = new Quaternion();
    for (const name of spec.aimNodes) {
      const node = findNode(scene, name);
      if (!node || !node.parent) {
        console.warn(`Turret node "${name}" not found in ${spec.file}`);
        continue;
      }
      node.parent.getWorldQuaternion(parentQuat).invert();
      let restYaw = 0;
      // The barrel sticks out of the base, so the bounds center sits toward the muzzle.
      const bounds = new Box3().setFromObject(node, true);
      if (!bounds.isEmpty()) {
        bounds.getCenter(center);
        node.getWorldPosition(pivot);
        const dx = center.x - pivot.x;
        const dz = center.z - pivot.z;
        if (Math.hypot(dx, dz) > spec.length * 0.01) restYaw = Math.atan2(dz, dx);
      }
      node.getWorldPosition(pivot);
      // Barrel reach: furthest bounds corner along the rest direction.
      const reach = new Box3().setFromObject(node, true);
      const dirX = Math.cos(restYaw);
      const dirZ = Math.sin(restYaw);
      let muzzle = 0;
      for (const cx of [reach.min.x, reach.max.x]) {
        for (const cz of [reach.min.z, reach.max.z]) {
          muzzle = Math.max(muzzle, (cx - pivot.x) * dirX + (cz - pivot.z) * dirZ);
        }
      }
      turrets.push({
        node,
        axis: UP.clone().applyQuaternion(parentQuat),
        rest: node.quaternion.clone(),
        restYaw,
        forward: pivot.x,
        starboard: pivot.z,
        muzzle,
      });
    }

    const model = new ShipModel(meshes, turrets, loaded.normal, loaded.flash);
    model.hullLength = box.max.x - box.min.x;
    model.hullWidth = box.max.z - box.min.z;
    model.root.add(
      fit,
      this.shadow(spec.length, box.max.z - box.min.z, 0.2),
      this.foamRing(spec.length, box.max.z - box.min.z),
    );
    return model;
  }

  private buildPlaceholder(modelKey: string, palette: Palette): ShipModel {
    const cacheKey = `${modelKey}:${palette}`;
    let geos = this.cache.get(cacheKey);
    if (!geos) {
      geos = this.buildPlaceholderGeometry(palette);
      this.cache.set(cacheKey, geos);
    }
    const hull = new Mesh(geos.hull, this.normal);
    const turretMesh = new Mesh(geos.turret, this.normal);
    const turret = new Group();
    turret.position.set(0.3, 0.8, 0);
    turret.add(turretMesh);
    const model = new ShipModel(
      [hull, turretMesh],
      [
        {
          node: turret,
          axis: UP.clone(),
          rest: new Quaternion(),
          restYaw: 0,
          forward: 0.3,
          starboard: 0,
          muzzle: 1.3,
        },
      ],
      this.normal,
      this.flash,
    );
    model.root.add(this.shadow(5, 1.9, 0.25), this.foamRing(5, 1.9), hull, turret);
    return model;
  }

  private buildPlaceholderGeometry(palette: Palette): {
    hull: BufferGeometry;
    turret: BufferGeometry;
  } {
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
