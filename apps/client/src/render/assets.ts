import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  DynamicDrawUsage,
  SphereGeometry,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Material,
  Object3D,
  PropertyBinding,
  ShaderMaterial,
  RingGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { Texture } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FX, convergedAngle } from '@tidebreaker/shared';
import { MODEL_SPECS, PROP_SPECS } from './modelSpecs.ts';
import type { ModelSpec } from './modelSpecs.ts';

export type Team = 'blue' | 'red' | 'pirate';

/**
 * Team colors. They are applied only to the model's mid-grey "hull paint" texels: white lines,
 * concrete/light greys, dark details (guns, vents) and the blue windows keep their own colors.
 */
/** Default team paint colors (the Appearance panel can change them at runtime). */
export const DEFAULT_TEAM_TINT: Record<Team, number> = {
  blue: 0x72a9e4,
  red: 0xff6b78,
  pirate: 0x74604f,
};
/** Glow ring and accent color of each team (sRGB). */
export const DEFAULT_TEAM_RING: Record<Team, number> = {
  blue: 0x23b4ff,
  red: 0xff2a45,
  pirate: 0xffa83a,
};
/** Outline thickness around the hull, in world units. */
const OUTLINE_WORLD = 0.13;
/** Brightness boost so the tinted paint does not come out darker than the original grey. */
export const DEFAULT_TEAM_BOOST = 4;
/** Self-illumination of the tinted paint (so the team color glows). */
export const DEFAULT_TEAM_GLOW = 0.2;

/** Shared, live-editable team paint settings: materials read these uniforms every frame. */
export interface TeamStyle {
  tint: Record<Team, Color>;
  boost: { value: number };
  glow: { value: number };
}

const PALETTES: Record<Team, { hull: number; deck: number; trim: number; gun: number }> = {
  blue: { hull: 0x2f6fb5, deck: 0xe8edf2, trim: 0xf2c14e, gun: 0x394150 },
  red: { hull: 0xb5412f, deck: 0xe8d9c8, trim: 0x3a2a24, gun: 0x2b2b2b },
  pirate: { hull: 0x3a3f46, deck: 0x8a7a63, trim: 0xffa83a, gun: 0x1e2226 },
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

/**
 * The look of a ship under spawn protection (it cannot be hurt): see-through, glowing cyan edges and
 * light bands running over the hull, with a faint flicker, like a hologram. Shared by every ship.
 */
const hologramMaterial = new ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`,
  fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorld;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.5);
  // Light bands sliding over the hull.
  float scan = 0.5 + 0.5 * sin((vWorld.x * 0.55 + vWorld.z * 0.4) * 2.4 - uTime * 4.5);
  float bands = smoothstep(0.4, 0.7, scan);
  float flicker = 0.9 + 0.1 * sin(uTime * 41.0) * sin(uTime * 7.0);
  vec3 col = mix(vec3(0.12, 0.7, 1.0), vec3(0.85, 1.0, 1.0), fres);
  float a = (0.2 + 0.55 * fres + 0.28 * bands) * flicker;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
});

/** Time for the hologram animation (call once per frame). */
export function setHologramTime(timeSec: number): void {
  hologramMaterial.uniforms['uTime']!.value = timeSec;
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
  private hologram = false;
  private readonly tmp = new Quaternion();
  /** The turrets' own sizes as exported (the damage upgrade grows them from here). */
  private readonly baseScale: Vector3[] = [];
  private power = 0;
  /** Flat things that must stay on the water surface (the team ring). */
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
    for (const rig of turrets) this.baseScale.push(rig.node.scale.clone());
    for (let i = 0; i < meshes.length; i++) meshes[i]!.material = normals[i]!;
  }

  /** Damage upgrade level: the guns of the ship grow with it. */
  setPower(level: number): void {
    if (level === this.power) return;
    this.power = level;
    const k = 1 + FX.power.turret * level;
    for (let i = 0; i < this.turrets.length; i++) {
      this.turrets[i]!.node.scale.copy(this.baseScale[i]!).multiplyScalar(k);
    }
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
    this.applyMaterials();
  }

  /** Spawn protection: the whole ship is drawn as a hologram (it cannot be hurt). */
  setHologram(on: boolean): void {
    if (on === this.hologram) return;
    this.hologram = on;
    this.applyMaterials();
  }

  private applyMaterials(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i]!.material = this.hologram
        ? hologramMaterial
        : this.flashing
          ? this.flashes[i]!
          : this.normals[i]!;
    }
  }

  /** Turns turret i toward its own world angle (turrets that choose their own targets). */
  aimTurretsEach(heading: number, angles: Float32Array): void {
    for (let i = 0; i < this.turrets.length; i++) {
      const rig = this.turrets[i]!;
      this.tmp.setFromAxisAngle(rig.axis, heading - angles[i]! + rig.restYaw);
      rig.node.quaternion.copy(this.tmp).multiply(rig.rest);
    }
  }

  /**
   * Turns every turret toward the aim point: `aimDist` units from the ship at (x, y) along `aim`
   * (sim angle), seen from the turret's own pivot, for a hull heading of `heading`.
   */
  aimTurrets(x: number, y: number, heading: number, aim: number, aimDist: number): void {
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    for (let i = 0; i < this.turrets.length; i++) {
      const rig = this.turrets[i]!;
      const px = x + cosH * rig.forward - sinH * rig.starboard;
      const py = y + sinH * rig.forward + cosH * rig.starboard;
      const angle = convergedAngle(x, y, aim, aimDist, px, py);
      // World yaw of a three.js node is -angle, so the relative turn is (heading - angle).
      this.tmp.setFromAxisAngle(rig.axis, heading - angle + rig.restYaw);
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

/** One rock of the rock pack: its triangles (corners as x, y, z), the linear color of each corner and its size. Centered on x/z, lowest point at y = 0. */
export interface RockPiece {
  name: string;
  pos: Float32Array;
  col: Float32Array;
  w: number;
  h: number;
  d: number;
}

/** Copies an attribute into plain floats (the loader may hand out normalized integers). */
function floats(src: BufferAttribute | InterleavedBufferAttribute, items: number): Float32Array {
  const out = new Float32Array(src.count * items);
  for (let i = 0; i < src.count; i++) {
    out[i * items] = src.getX(i);
    out[i * items + 1] = src.getY(i);
    if (items > 2) out[i * items + 2] = src.getZ(i);
  }
  return out;
}

/** One mesh as standalone geometry in a unit footprint with the sea surface at y = 0 (see AssetProvider.prop). */
function fitProp(mesh: Mesh, sink: number): BufferGeometry {
  const src = mesh.geometry;
  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(floats(src.attributes['position']!, 3), 3),
  );
  if (src.attributes['normal']) {
    geo.setAttribute('normal', new Float32BufferAttribute(floats(src.attributes['normal'], 3), 3));
  }
  if (src.attributes['uv']) {
    geo.setAttribute('uv', new Float32BufferAttribute(floats(src.attributes['uv'], 2), 2));
  }
  if (src.index) geo.setIndex(src.index.clone());
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const k = 1 / Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const height = box.max.y - box.min.y;
  geo.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + sink * height),
    -(box.min.z + box.max.z) / 2,
  );
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
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
  /** The model's own paint, for hulls that take no team tint (`ModelSpec.plain`). */
  plain: TeamMaterials;
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
  /** Glowing team ring on the water under each ship. */
  private readonly glowRingGeo = new RingGeometry(0.93, 1, 56).rotateX(-Math.PI / 2);
  private readonly glowMats: Record<Team, MeshBasicMaterial> = {
    blue: this.makeGlow(DEFAULT_TEAM_RING.blue),
    red: this.makeGlow(DEFAULT_TEAM_RING.red),
    pirate: this.makeGlow(DEFAULT_TEAM_RING.pirate),
  };
  /** Live team paint settings (see TeamStyle). */
  readonly style: TeamStyle = {
    tint: {
      blue: new Color(DEFAULT_TEAM_TINT.blue),
      red: new Color(DEFAULT_TEAM_TINT.red),
      pirate: new Color(DEFAULT_TEAM_TINT.pirate),
    },
    boost: { value: DEFAULT_TEAM_BOOST },
    glow: { value: DEFAULT_TEAM_GLOW },
  };
  private outlineOn = false;
  private readonly outlineMats = new Set<ShaderMaterial>();
  private readonly cache = new Map<string, { hull: BufferGeometry; turret: BufferGeometry }>();
  private readonly loaded = new Map<string, LoadedModel>();
  /** Why a model fell back to the placeholder (shown in the test panel). */
  readonly failures = new Map<string, string>();

  /** Each GLB file is fetched and parsed once, however many model keys use it. */
  private readonly files = new Map<string, Promise<GLTF>>();
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  private gltfOf(file: string): Promise<GLTF> {
    let p = this.files.get(file);
    if (!p) {
      p = this.loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`);
      this.files.set(file, p);
    }
    return p;
  }

  /** Loads the GLBs for these model keys. Failures are logged and fall back to placeholders. */
  async preload(keys: readonly string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        const spec = MODEL_SPECS[key];
        if (!spec || this.loaded.has(key)) return;
        try {
          const gltf = await this.gltfOf(spec.file);
          const hull = findNode(gltf.scene, spec.hullNode);
          const hullMesh = hull ? hullMeshes(hull)[0] : undefined;
          const map = hullMesh ? ((hullMesh.material as MeshStandardMaterial).map ?? null) : null;
          this.loaded.set(key, {
            spec,
            scene: gltf.scene,
            materials: this.makeMaterials(map),
            neutral: this.makeNeutral(map),
            plain: this.makeNeutral(map, true),
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

  private readonly props = new Map<string, { geometry: BufferGeometry; material: Material }>();
  private rockPieces: RockPiece[] = [];

  /** Loads the rock pack (`rocks_pack.glb`). A failure leaves no rocks (the reefs and islands stay procedural). */
  async preloadRocks(): Promise<void> {
    try {
      const gltf = await this.gltfOf('rocks_pack.glb');
      gltf.scene.updateMatrixWorld(true);
      const out: RockPiece[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.geometry;
        const position = src.attributes['position'];
        const color = src.attributes['color'];
        if (!position || !color) return;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(floats(position, 3), 3));
        geo.setAttribute('color', new Float32BufferAttribute(floats(color, 3), 3));
        if (src.index) geo.setIndex(src.index.clone());
        geo.applyMatrix4(mesh.matrixWorld);
        // Corners in triangle order (the pack may come indexed).
        const flat = geo.index ? geo.toNonIndexed() : geo;
        flat.computeBoundingBox();
        const b = flat.boundingBox!;
        const name = mesh.name || (mesh.parent?.name ?? '').replace(/\.mesh$/, '');
        out.push({
          name,
          pos: flat.attributes['position']!.array as Float32Array,
          col: flat.attributes['color']!.array as Float32Array,
          w: b.max.x - b.min.x,
          h: b.max.y - b.min.y,
          d: b.max.z - b.min.z,
        });
      });
      this.rockPieces = out;
    } catch (err) {
      console.warn('The rock pack failed to load, using the procedural rocks.', err);
    }
  }

  /** The rocks of the rock pack (empty when it did not load). */
  rocks(): readonly RockPiece[] {
    return this.rockPieces;
  }

  /** Loads the static models (oil rig, islands). A failure leaves the prop missing (callers fall back). */
  async preloadProps(keys: readonly string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        const spec = PROP_SPECS[key];
        if (!spec || this.props.has(key)) return;
        try {
          const gltf = await this.gltfOf(spec.file);
          const node = findNode(gltf.scene, spec.node);
          const mesh = node ? hullMeshes(node)[0] : undefined;
          if (!node || !mesh) throw new Error(`node "${spec.node}" has no mesh`);
          gltf.scene.updateMatrixWorld(true);
          const geometry = fitProp(mesh, spec.sink);
          const map = (mesh.material as MeshStandardMaterial).map ?? null;
          const glow = spec.glow ?? 0;
          const material =
            glow > 0
              ? new MeshLambertMaterial({
                  map,
                  emissive: 0xffffff,
                  emissiveMap: map,
                  emissiveIntensity: glow,
                })
              : new MeshLambertMaterial({ map });
          this.props.set(key, { geometry, material });
        } catch (err) {
          console.warn(`Prop "${key}" failed to load, using the procedural look.`, err);
        }
      }),
    );
  }

  /**
   * A static model as one geometry: node transforms baked in, fitted to a footprint of 1 unit
   * (its longer side), centered on the origin, with the sea surface at y = 0. Scale it as needed.
   * Returns null when the model did not load.
   */
  prop(key: string): { geometry: BufferGeometry; material: Material } | null {
    return this.props.get(key) ?? null;
  }

  private makeNeutral(map: Texture | null, twoSided = false): TeamMaterials {
    const side = twoSided ? DoubleSide : FrontSide;
    return {
      normal: new MeshLambertMaterial({ map, side }),
      flash: new MeshLambertMaterial({ map, side, emissive: 0xffffff, emissiveIntensity: 0.4 }),
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
      pirate: {
        normal: teamMaterial(map, 'pirate', false, this.style),
        flash: teamMaterial(map, 'pirate', true, this.style),
      },
    };
  }

  /** `ring`: draws the glowing team ring under the ship (only the player's own ship has one). */
  createShip(modelKey: string, team: Team, ring = false): ShipModel {
    const loaded = this.loaded.get(modelKey);
    if (!loaded && MODEL_SPECS[modelKey] && !this.failures.has(modelKey)) {
      this.failures.set(modelKey, 'not loaded');
    }
    if (loaded) {
      try {
        return this.buildFromGltf(loaded, team, ring);
      } catch (err) {
        this.failures.set(modelKey, err instanceof Error ? err.message : String(err));
        console.warn(`Model "${modelKey}" could not be built, using the placeholder.`, err);
      }
    }
    return this.buildPlaceholder(modelKey, team, ring);
  }

  /**
   * A drone: one mesh (a static model fitted to `length` units, nose along +x) tinted a little toward
   * its team's color, and (`ring`: the player's own drones) a ring on the water below it. Placeholder:
   * a small box.
   */
  createDrone(modelKey: string, team: Team, length: number, ring = false): ShipModel {
    const prop = this.props.get(modelKey);
    const spec = PROP_SPECS[modelKey];
    const glow = this.glowMats[team].color;
    const map = prop ? ((prop.material as MeshLambertMaterial).map ?? null) : null;
    // Mostly its own paint, with parts painted in the team color: the texture's warm accents (red and
    // orange) and the outer ends of the wings or arms. The paint also lights itself a little, so the
    // drone stays lighter than the sea it flies over.
    const normal = new MeshLambertMaterial({ map });
    paintDrone(normal, glow, prop ? prop.geometry : null);
    const flash = new MeshLambertMaterial({ map, emissive: 0xffffff, emissiveIntensity: 0.7 });
    const mesh = new Mesh(prop ? prop.geometry : new BoxGeometry(1, 0.3, 0.8), normal);
    mesh.scale.setScalar(length);
    mesh.rotation.y = spec?.yaw ?? 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const model = new ShipModel([mesh], [normal], [flash], []);
    model.hullLength = length;
    model.hullWidth = length * 0.8;
    model.root.add(mesh);
    // The ring on the water is only for the owner's own drones.
    if (ring) this.addTeamRing(model, length * 2, team);
    return model;
  }

  /**
   * The instanced mesh of one team's sea mines: the mine model with its light parts painted in the
   * team color (a plain ball when the model did not load).
   */
  createMineMesh(team: Team, capacity: number): InstancedMesh {
    const prop = this.props.get('spiked_mine');
    const map = prop ? ((prop.material as MeshLambertMaterial).map ?? null) : null;
    const mat = new MeshLambertMaterial({ map, color: prop ? 0xffffff : 0x667788 });
    paintLightParts(mat, this.glowMats[team].color);
    const mesh = new InstancedMesh(prop ? prop.geometry : new SphereGeometry(0.5, 10, 8), mat, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
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

  private buildFromGltf(loaded: LoadedModel, team: Team, ring: boolean): ShipModel {
    const { spec } = loaded;
    const mats = spec.plain ? loaded.plain : loaded.materials[team];
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
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
    }

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
    if (ring) this.addTeamRing(model, spec.length, team);
    return model;
  }

  private buildPlaceholder(modelKey: string, team: Team, ring: boolean): ShipModel {
    const cacheKey = `${modelKey}:${team}`;
    let geos = this.cache.get(cacheKey);
    if (!geos) {
      geos = this.buildPlaceholderGeometry(team);
      this.cache.set(cacheKey, geos);
    }
    const hull = new Mesh(geos.hull, this.normal);
    const turretMesh = new Mesh(geos.turret, this.normal);
    for (const m of [hull, turretMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
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
    if (ring) this.addTeamRing(model, 5, team);
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


/**
 * Makes a drone material paint part of the model in the team color (see `createDrone`): texels that
 * lean toward red or orange, and light panels near the ends of the wings or arms (outer part of the
 * span, `z` of the model). Also adds the self-lighting that keeps the drone visible over water.
 */
function paintDrone(mat: MeshLambertMaterial, team: Color, geometry: BufferGeometry | null): void {
  const center = new Vector3();
  const half = new Vector3(1, 1, 1);
  if (geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      box.getCenter(center);
      box.getSize(half).multiplyScalar(0.5);
    }
  }
  const paint = team.clone();
  mat.customProgramCacheKey = () => 'drone-paint';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uTeam'] = { value: paint };
    shader.uniforms['uCenter'] = { value: center };
    shader.uniforms['uHalf'] = { value: half };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLocal;\nuniform vec3 uTeam;\nuniform vec3 uCenter;\nuniform vec3 uHalf;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 tc = diffuseColor.rgb;
          float lum = dot(tc, vec3(0.299, 0.587, 0.114));
          float sat = max(tc.r, max(tc.g, tc.b)) - min(tc.r, min(tc.g, tc.b));
          float warm = smoothstep(0.06, 0.2, tc.r - 0.9 * max(tc.g, tc.b));
          float outer = smoothstep(0.4, 0.62, abs(vLocal.z - uCenter.z) / uHalf.z);
          float light = smoothstep(0.08, 0.2, lum) * (1.0 - smoothstep(0.25, 0.5, sat));
          float mask = max(warm, light * outer);
          vec3 painted = uTeam * (0.45 + 1.1 * lum);
          diffuseColor.rgb = mix(tc, painted, mask);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * 0.45;',
      );
  };
}

/**
 * Paints the light parts of a model's texture in the team color (the dark parts stay as they are), and
 * lights the result a little by itself: used for the sea mines, whose texture is dark with light bands.
 */
function paintLightParts(mat: MeshLambertMaterial, team: Color): void {
  const paint = team.clone();
  mat.customProgramCacheKey = () => 'light-paint';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uTeam'] = { value: paint };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTeam;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 tc = diffuseColor.rgb;
          float lum = dot(tc, vec3(0.299, 0.587, 0.114));
          float mask = smoothstep(0.25, 0.5, lum);
          diffuseColor.rgb = mix(tc, uTeam * (0.55 + 0.9 * lum), mask);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * 0.4;',
      );
  };
}
