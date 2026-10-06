import {
  BackSide,
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
  ShaderMaterial,
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

export type Team = 'blue' | 'red';

/**
 * Team colors. They are applied only to the model's mid-grey "hull paint" texels: white lines,
 * concrete/light greys, dark details (guns, vents) and the blue windows keep their own colors.
 */
/** Default team paint colors (the Appearance panel can change them at runtime). */
export const DEFAULT_TEAM_TINT: Record<Team, number> = { blue: 0x7ad6ff, red: 0xff6b78 };
/** Glow ring and accent color of each team (sRGB). */
export const DEFAULT_TEAM_RING: Record<Team, number> = { blue: 0x23b4ff, red: 0xff2a45 };
/** Outline thickness around the hull, in world units. */
const OUTLINE_WORLD = 0.13;
/** Brightness boost so the tinted paint does not come out darker than the original grey. */
export const DEFAULT_TEAM_BOOST = 2.6;
/** Self-illumination of the tinted paint (so the team color glows). */
export const DEFAULT_TEAM_GLOW = 0.3;

/** Shared, live-editable team paint settings: materials read these uniforms every frame. */
export interface TeamStyle {
  tint: Record<Team, Color>;
  boost: { value: number };
  glow: { value: number };
}

const PALETTES: Record<Team, { hull: number; deck: number; trim: number; gun: number }> = {
  blue: { hull: 0x2f6fb5, deck: 0xe8edf2, trim: 0xf2c14e, gun: 0x394150 },
  red: { hull: 0xb5412f, deck: 0xe8d9c8, trim: 0x3a2a24, gun: 0x2b2b2b },
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
  private readonly normals: readonly MeshLambertMaterial[];
  private readonly flashes: readonly MeshLambertMaterial[];
  readonly turrets: readonly TurretRig[];
  /** Hull footprint after normalization (world units). */
  hullLength = 0;
  hullWidth = 0;
  private flashing = false;
  private readonly tmp = new Quaternion();
  /** Flat things that must stay on the water surface (blob shadow, foam ring). */
  private readonly decals: Mesh[] = [];
  private readonly decalLift: number[] = [];

  /** `normals[i]` / `flashes[i]` are the materials of `meshes[i]` (weapons are not team-tinted). */
  constructor(
    meshes: readonly Mesh[],
    normals: readonly MeshLambertMaterial[],
    flashes: readonly MeshLambertMaterial[],
    turrets: readonly TurretRig[],
  ) {
    this.meshes = meshes;
    this.normals = normals;
    this.flashes = flashes;
    this.turrets = turrets;
    for (let i = 0; i < meshes.length; i++) meshes[i]!.material = normals[i]!;
  }

  /** Adds a flat mesh that is kept `lift` above the water surface under the ship. */
  addDecal(mesh: Mesh, lift: number): void {
    mesh.rotation.order = 'ZXY';
    this.decals.push(mesh);
    this.decalLift.push(lift);
    this.root.add(mesh);
  }

  /**
   * Keeps the decals level and on the real water surface while the hull bobs and tilts, so the
   * foam ring never dips into the sea (or floats above it) when the ship rocks.
   * @param tiltX root.rotation.x, @param tiltZ root.rotation.z
   */
  layDecals(surfaceY: number, rootY: number, tiltX: number, tiltZ: number): void {
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i]!;
      d.position.y = surfaceY + this.decalLift[i]! - rootY;
      d.rotation.set(-tiltX, 0, -tiltZ);
    }
  }

  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i]!.material = on ? this.flashes[i]! : this.normals[i]!;
    }
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

/** Lambert material whose mid-grey texels are tinted with the team color. */
function teamMaterial(
  map: Texture | null,
  team: Team,
  flash: boolean,
  style: TeamStyle,
): MeshLambertMaterial {
  const mat = new MeshLambertMaterial(
    flash ? { map, emissive: 0xffffff, emissiveIntensity: 0.4 } : { map },
  );
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uTeam'] = { value: style.tint[team] };
    shader.uniforms['uBoost'] = style.boost;
    shader.uniforms['uGlow'] = style.glow;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uTeam;\nuniform float uBoost;\nuniform float uGlow;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Paint mask: mid greys only, and not the saturated (blue window) texels.
        float tl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float ts = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float tm = smoothstep(0.17, 0.21, tl) * (1.0 - smoothstep(0.47, 0.51, tl)) * (1.0 - smoothstep(0.03, 0.08, ts));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTeam * uBoost, tm);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n        totalEmissiveRadiance += uTeam * tm * uGlow;',
      );
  };
  mat.customProgramCacheKey = () => 'team-tint';
  return mat;
}

interface TeamMaterials {
  normal: MeshLambertMaterial;
  flash: MeshLambertMaterial;
}

interface LoadedModel {
  spec: ModelSpec;
  scene: Object3D;
  materials: Record<Team, TeamMaterials>;
  /** Untinted materials for weapons. */
  neutral: TeamMaterials;
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
    emissiveIntensity: 0.4,
  });
  private readonly shadowGeo = new CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private readonly shadowMat = new MeshBasicMaterial({
    color: 0x061c2e,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  /** Foam where the hull meets the water. */
  /** Glowing team ring on the water under each ship. */
  private readonly glowRingGeo = new RingGeometry(0.93, 1, 56).rotateX(-Math.PI / 2);
  private readonly glowMats: Record<Team, MeshBasicMaterial> = {
    blue: this.makeGlow(DEFAULT_TEAM_RING.blue),
    red: this.makeGlow(DEFAULT_TEAM_RING.red),
  };
  /** Live team paint settings (see TeamStyle). */
  readonly style: TeamStyle = {
    tint: { blue: new Color(DEFAULT_TEAM_TINT.blue), red: new Color(DEFAULT_TEAM_TINT.red) },
    boost: { value: DEFAULT_TEAM_BOOST },
    glow: { value: DEFAULT_TEAM_GLOW },
  };
  private outlineOn = false;
  private readonly outlineMats = new Set<ShaderMaterial>();
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
          this.loaded.set(key, {
            spec,
            scene: gltf.scene,
            materials: this.makeMaterials(map),
            neutral: this.makeNeutral(map),
          });
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

  private makeNeutral(map: Texture | null): TeamMaterials {
    return {
      normal: new MeshLambertMaterial({ map }),
      flash: new MeshLambertMaterial({ map, emissive: 0xffffff, emissiveIntensity: 0.4 }),
    };
  }

  private makeMaterials(map: Texture | null): Record<Team, TeamMaterials> {
    return {
      blue: {
        normal: teamMaterial(map, 'blue', false, this.style),
        flash: teamMaterial(map, 'blue', true, this.style),
      },
      red: {
        normal: teamMaterial(map, 'red', false, this.style),
        flash: teamMaterial(map, 'red', true, this.style),
      },
    };
  }

  createShip(modelKey: string, team: Team): ShipModel {
    const loaded = this.loaded.get(modelKey);
    if (!loaded && MODEL_SPECS[modelKey] && !this.failures.has(modelKey)) {
      this.failures.set(modelKey, 'not loaded');
    }
    if (loaded) {
      try {
        return this.buildFromGltf(loaded, team);
      } catch (err) {
        this.failures.set(modelKey, err instanceof Error ? err.message : String(err));
        console.warn(`Model "${modelKey}" could not be built, using the placeholder.`, err);
      }
    }
    return this.buildPlaceholder(modelKey, team);
  }

  /** Team paint color (sRGB hex). */
  setTeamColor(team: Team, hex: number): void {
    this.style.tint[team].set(hex);
  }

  setTeamBoost(v: number): void {
    this.style.boost.value = v;
  }

  setTeamGlow(v: number): void {
    this.style.glow.value = v;
  }

  setRingColor(team: Team, hex: number): void {
    this.glowMats[team].color.set(hex);
  }

  /** Shows or hides the hull outline on every ship, present and future. */
  setOutline(on: boolean): void {
    this.outlineOn = on;
    for (const m of this.outlineMats) m.visible = on;
  }

  private makeGlow(color: number): MeshBasicMaterial {
    return new MeshBasicMaterial({ color, transparent: true, depthWrite: false, opacity: 0.95 });
  }

  /** Adds the glowing team ring under the ship. */
  private addTeamRing(model: ShipModel, length: number, team: Team): void {
    const radius = Math.max(1.5, length * 0.36);
    const ring = new Mesh(this.glowRingGeo, this.glowMats[team]);
    ring.scale.set(radius, 1, radius);
    ring.renderOrder = 2;
    model.addDecal(ring, 0.3);
  }

  /** Back-face copy pushed out along the normals by a fixed world-space thickness. */
  private outlineFor(mesh: Mesh): Mesh {
    // Local units differ per mesh (quantized geometry, node scales), so convert the thickness.
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    const mat = new ShaderMaterial({
      uniforms: { uT: { value: OUTLINE_WORLD / scale }, uColor: { value: new Color(0x020a14) } },
      vertexShader:
        'uniform float uT;\nvoid main() {\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uT, 1.0);\n}',
      fragmentShader:
        'uniform vec3 uColor;\nvoid main() {\n  gl_FragColor = vec4(uColor, 1.0);\n  #include <colorspace_fragment>\n}',
      side: BackSide,
    });
    mat.visible = this.outlineOn;
    this.outlineMats.add(mat);
    return new Mesh(mesh.geometry, mat);
  }

  private foamRing(length: number, width: number): Mesh {
    const ring = new Mesh(this.ringGeo, this.ringMat);
    ring.scale.set(length * 0.56, 1, width * 0.7);
    ring.renderOrder = 2;
    return ring;
  }

  private shadow(length: number, width: number): Mesh {
    const shadow = new Mesh(this.shadowGeo, this.shadowMat);
    shadow.scale.set(length * 0.52, 1, width * 0.62);
    return shadow;
  }

  private buildFromGltf(loaded: LoadedModel, team: Team): ShipModel {
    const mats = loaded.materials[team];
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
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
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

    // Thin dark outline around the hull (inverted-hull trick), so ships pop off the sea.
    for (const part of hullParts) part.add(this.outlineFor(part));

    // Weapons keep their own colors; only the hull gets the team tint.
    const weaponParts = new Set<Object3D>();
    for (const rig of turrets) rig.node.traverse((o) => weaponParts.add(o));
    const normals = meshes.map((m) => (weaponParts.has(m) ? loaded.neutral.normal : mats.normal));
    const flashes = meshes.map((m) => (weaponParts.has(m) ? loaded.neutral.flash : mats.flash));
    const model = new ShipModel(meshes, normals, flashes, turrets);
    model.hullLength = box.max.x - box.min.x;
    model.hullWidth = box.max.z - box.min.z;
    model.root.add(fit);
    model.addDecal(this.shadow(spec.length, box.max.z - box.min.z), 0.2);
    model.addDecal(this.foamRing(spec.length, box.max.z - box.min.z), 0.26);
    this.addTeamRing(model, spec.length, team);
    return model;
  }

  private buildPlaceholder(modelKey: string, team: Team): ShipModel {
    const cacheKey = `${modelKey}:${team}`;
    let geos = this.cache.get(cacheKey);
    if (!geos) {
      geos = this.buildPlaceholderGeometry(team);
      this.cache.set(cacheKey, geos);
    }
    const hull = new Mesh(geos.hull, this.normal);
    const turretMesh = new Mesh(geos.turret, this.normal);
    const turret = new Group();
    turret.position.set(0.3, 0.8, 0);
    turret.add(turretMesh);
    const model = new ShipModel(
      [hull, turretMesh],
      [this.normal, this.normal],
      [this.flash, this.flash],
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
    );
    model.root.add(hull, turret);
    model.addDecal(this.shadow(5, 1.9), 0.2);
    model.addDecal(this.foamRing(5, 1.9), 0.26);
    this.addTeamRing(model, 5, team);
    return model;
  }

  private buildPlaceholderGeometry(team: Team): {
    hull: BufferGeometry;
    turret: BufferGeometry;
  } {
    const p = PALETTES[team];
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
