import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  GreaterDepth,
  InstancedMesh,
  ShaderMaterial,
} from 'three';
import { FX } from '@tidebreaker/shared';

/** How many ships can have a silhouette at once (players, pirates and the two carriers). */
const CAPACITY = 192;
/** The height of the ship (share of it) whose picture the silhouette overlays. */
const ALIGN = FX.xray.align;

/** The outline of a hull seen from above in a box one unit long (x, the bow at +0.5) and one wide (z): x, z pairs. */
const OUTLINE = [-0.5, -0.38, -0.42, -0.5, 0.18, -0.5, 0.5, 0, 0.18, 0.5, -0.42, 0.5, -0.5, 0.38];

/** The hull outline as a fan of triangles. `aEdge` is 0 in the middle and 1 on the outline (the shader draws the rim from it). */
function hullShape(): BufferGeometry {
  const n = OUTLINE.length / 2;
  const pos = new Float32Array((n + 1) * 3);
  const edge = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    pos[(i + 1) * 3] = OUTLINE[i * 2]!;
    pos[(i + 1) * 3 + 2] = OUTLINE[i * 2 + 1]!;
    edge[i + 1] = 1;
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) index.push(0, 1 + i, 1 + ((i + 1) % n));
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aEdge', new BufferAttribute(edge, 1));
  geo.setIndex(index);
  return geo;
}

const VERTEX = /* glsl */ `
attribute float aEdge;
varying float vEdge;
varying vec3 vColor;
void main() {
  vEdge = aEdge;
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform float uFill;
uniform float uHatch;
uniform float uHatchPx;
uniform float uRim;
uniform float uRimPx;
uniform float uRimLight;
varying float vEdge;
varying vec3 vColor;
void main() {
  // How many pixels away from the outline this pixel is (vEdge grows linearly toward it).
  float px = (1.0 - vEdge) / max(fwidth(vEdge), 1e-5);
  float rim = 1.0 - smoothstep(uRimPx * 0.5, uRimPx, px);
  float stripe = step(0.5, fract((gl_FragCoord.x - gl_FragCoord.y) / uHatchPx));
  float fill = uFill + uHatch * stripe;
  vec3 color = mix(vColor, vec3(1.0), uRimLight * rim);
  gl_FragColor = vec4(color, mix(fill, uRim, rim));
  #include <colorspace_fragment>
}`;

/**
 * The silhouettes of ships seen through what hides them (an island, a cliff, a rig, a tree): a flat hull shape in the
 * team's colour with a fine hatching and a thin outline. One instanced mesh for all ships, so it costs a single draw.
 *
 * How it works: the shape is drawn only where the depth buffer already holds something NEARER than the shape
 * (`GreaterDepth`). It is put at the height of the top of the ship, so the ship itself (lower than that) never hides it
 * and only a real occluder does. A shape up there would show higher on the screen than the ship below it, so it is
 * moved along the line of sight (and made smaller by the same share) until it lies over the picture of the ship's body
 * on the screen (at `FX.xray.align` of its height).
 */
export class XRay {
  readonly mesh: InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  /** Linear colours of team A, team B and the pirates (r, g, b each). */
  private readonly palette = new Float32Array(9);
  private count = 0;
  private cx = 0;
  private cy = 1;
  private cz = 0;

  constructor() {
    const X = FX.xray;
    const material = new ShaderMaterial({
      uniforms: {
        uFill: { value: X.fill },
        uHatch: { value: X.hatch },
        uHatchPx: { value: X.hatchPx },
        uRim: { value: X.rim },
        uRimPx: { value: X.rimPx },
        uRimLight: { value: X.rimLight },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      depthFunc: GreaterDepth,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(hullShape(), material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // (Allocates the colour buffer.)
    this.mesh.setColorAt(0, new Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // After everything that writes depth, so the depth buffer is complete when this is drawn.
    this.mesh.renderOrder = 100;
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.colors = this.mesh.instanceColor!.array as Float32Array;
    this.setTeamColors(0x3f98ff, 0xff4a5c);
  }

  /** The colours of team A and team B (sRGB hex); the pirates have their own bone colour. */
  setTeamColors(a: number, b: number): void {
    const c = new Color();
    [a, b, 0xd9d4c4].forEach((hex, i) => {
      c.set(hex);
      this.palette[i * 3] = c.r;
      this.palette[i * 3 + 1] = c.g;
      this.palette[i * 3 + 2] = c.b;
    });
  }

  /** Starts a frame; (x, y, z) is where the camera is. */
  begin(x: number, y: number, z: number): void {
    this.count = 0;
    this.cx = x;
    this.cy = y;
    this.cz = z;
  }

  /**
   * One ship: its position on the water (x, z), heading (radians), hull size and the height of its top. `team`: 0 = A,
   * 1 = B, 2 = pirates.
   */
  add(x: number, z: number, heading: number, length: number, width: number, top: number, team: number): void {
    if (this.count >= CAPACITY) return;
    // The line from the camera to the middle of the ship's body (`mid` above the water) crosses the plane `top` above
    // the water after the share k of its way: the shape put there looks as big as the body and lies over it.
    const mid = top * ALIGN;
    const k = (this.cy - top) / (this.cy - mid);
    const px = this.cx + (x - this.cx) * k;
    const pz = this.cz + (z - this.cz) * k;
    // Turned like the ship (the model's rotation.y is -heading) and stretched to its size.
    const c = Math.cos(-heading);
    const s = Math.sin(-heading);
    const sx = length * k;
    const sz = width * k;
    const m = this.matrices;
    const o = this.count * 16;
    m[o] = c * sx;
    m[o + 1] = 0;
    m[o + 2] = -s * sx;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s * sz;
    m[o + 9] = 0;
    m[o + 10] = c * sz;
    m[o + 11] = 0;
    m[o + 12] = px;
    m[o + 13] = top;
    m[o + 14] = pz;
    m[o + 15] = 1;
    const p = team * 3;
    const q = this.count * 3;
    this.colors[q] = this.palette[p]!;
    this.colors[q + 1] = this.palette[p + 1]!;
    this.colors[q + 2] = this.palette[p + 2]!;
    this.count++;
  }

  /** Ends the frame: the ships added are drawn. */
  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
