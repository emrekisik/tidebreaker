import {
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  MaxEquation,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';

/** World size (units) of the square the foam map covers; it follows the camera focus. */
export const WAKE_EXTENT = 200;
const RES = 1024;
const TEXEL = WAKE_EXTENT / RES;
/** Max stamps per frame. */
const CAPACITY = 256;

/** Foam channel lifetimes (seconds): R = turbulent trail, G = bow wave and Kelvin arms. */
const TAU_TRAIL = 1.7;
const TAU_BOW = 0.3;
/** Sideways spread of the trail per second (the trail widens as it ages). */
const DIFFUSION = 26;

const FADE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Moves the old foam with the map origin, fades it, and lets it spread a little.
const FADE_FRAGMENT = /* glsl */ `
uniform sampler2D uPrev;
uniform vec2 uShift;
uniform vec2 uDecay;
uniform float uDiffuse;
uniform float uTexel;
varying vec2 vUv;

vec2 fetch(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture2D(uPrev, uv).rg * (inside.x * inside.y);
}

void main() {
  vec2 uv = vUv + uShift;
  vec2 c = fetch(uv);
  vec2 n = (fetch(uv + vec2(uTexel, 0.0)) + fetch(uv - vec2(uTexel, 0.0))
          + fetch(uv + vec2(0.0, uTexel)) + fetch(uv - vec2(0.0, uTexel))) * 0.25;
  vec2 v = mix(c, n, uDiffuse) * uDecay;
  v = max(v - 0.0006, 0.0);
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

// One stamp = a soft capsule from a to b (world xz); the two channels fade along its length.
const STAMP_VERTEX = /* glsl */ `
uniform vec2 uOrigin;
uniform float uExtent;
attribute vec2 aA;
attribute vec2 aB;
attribute float aW;
attribute vec2 aV0;
attribute vec2 aV1;
varying vec2 vWorld;
varying vec2 vA;
varying vec2 vB;
varying float vW;
varying vec2 vV0;
varying vec2 vV1;
void main() {
  vec2 ab = aB - aA;
  float len = length(ab);
  vec2 dir = len > 0.0001 ? ab / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 base = position.x < 0.0 ? aA : aB;
  vec2 w = base + dir * position.x * aW + perp * position.y * aW;
  vWorld = w;
  vA = aA;
  vB = aB;
  vW = aW;
  vV0 = aV0;
  vV1 = aV1;
  vec2 uvm = (w - uOrigin) / uExtent;
  gl_Position = vec4(uvm * 2.0 - 1.0, 0.0, 1.0);
}
`;

const STAMP_FRAGMENT = /* glsl */ `
varying vec2 vWorld;
varying vec2 vA;
varying vec2 vB;
varying float vW;
varying vec2 vV0;
varying vec2 vV1;
void main() {
  vec2 pa = vWorld - vA;
  vec2 ba = vB - vA;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.000001), 0.0, 1.0);
  float d = length(pa - ba * h);
  float f = 1.0 - smoothstep(vW * 0.2, vW, d);
  gl_FragColor = vec4(mix(vV0, vV1, h) * f, 0.0, 1.0);
}
`;

/**
 * A world-anchored foam map that follows the camera. Ships stamp soft capsules into it; the map
 * fades and spreads every frame, so wakes stay continuous, curve with the ship and dissolve into
 * lace. The water shader reads it (`texture`, `origin`, `WAKE_EXTENT`).
 *
 * Two half-float targets are ping-ponged: the fade pass reads one and writes the other, then the
 * stamps are max-blended on top. Nothing is allocated per frame.
 */
export class WakeMap {
  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private read = 0;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fadeScene = new Scene();
  private readonly stampScene = new Scene();
  private readonly fade: ShaderMaterial;
  private readonly stampGeo = new InstancedBufferGeometry();
  private readonly a = new Float32Array(CAPACITY * 2);
  private readonly b = new Float32Array(CAPACITY * 2);
  private readonly w = new Float32Array(CAPACITY);
  private readonly v0 = new Float32Array(CAPACITY * 2);
  private readonly v1 = new Float32Array(CAPACITY * 2);
  private readonly attrs: InstancedBufferAttribute[];
  private count = 0;
  private dt = 0;
  private ready = false;
  /** World xz of the map's lower corner (snapped to whole texels). */
  readonly origin = new Vector2();

  constructor() {
    const make = (): WebGLRenderTarget =>
      new WebGLRenderTarget(RES, RES, {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
    this.targets = [make(), make()];

    this.fade = new ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new Vector2() },
        uDecay: { value: new Vector2(1, 1) },
        uDiffuse: { value: 0 },
        uTexel: { value: 1 / RES },
      },
      vertexShader: FADE_VERTEX,
      fragmentShader: FADE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new PlaneGeometry(2, 2);
    const fadeMesh = new Mesh(quad, this.fade);
    fadeMesh.frustumCulled = false;
    this.fadeScene.add(fadeMesh);

    // One quad (x, y in -1..1) instanced per stamp.
    this.stampGeo.index = quad.index;
    this.stampGeo.setAttribute('position', quad.getAttribute('position'));
    this.attrs = [
      new InstancedBufferAttribute(this.a, 2),
      new InstancedBufferAttribute(this.b, 2),
      new InstancedBufferAttribute(this.w, 1),
      new InstancedBufferAttribute(this.v0, 2),
      new InstancedBufferAttribute(this.v1, 2),
    ];
    const names = ['aA', 'aB', 'aW', 'aV0', 'aV1'];
    for (let i = 0; i < names.length; i++) {
      this.attrs[i]!.setUsage(DynamicDrawUsage);
      this.stampGeo.setAttribute(names[i]!, this.attrs[i]!);
    }
    this.stampGeo.instanceCount = 0;
    const stampMat = new ShaderMaterial({
      uniforms: { uOrigin: { value: this.origin }, uExtent: { value: WAKE_EXTENT } },
      vertexShader: STAMP_VERTEX,
      fragmentShader: STAMP_FRAGMENT,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    const stampMesh = new Mesh(this.stampGeo, stampMat);
    stampMesh.frustumCulled = false;
    this.stampScene.add(stampMesh);
  }

  /** The foam map to sample in the water shader (valid after `render`). */
  get texture(): Texture {
    return this.targets[this.read]!.texture;
  }

  /** Start of a frame: recenters the map on the camera focus and clears the stamp list. */
  begin(focusX: number, focusZ: number, dtSec: number): void {
    this.count = 0;
    this.dt = dtSec;
    const ox = Math.floor((focusX - WAKE_EXTENT / 2) / TEXEL) * TEXEL;
    const oz = Math.floor((focusZ - WAKE_EXTENT / 2) / TEXEL) * TEXEL;
    const shift = this.fade.uniforms['uShift']!.value as Vector2;
    if (this.ready)
      shift.set((ox - this.origin.x) / WAKE_EXTENT, (oz - this.origin.y) / WAKE_EXTENT);
    else shift.set(0, 0);
    this.origin.set(ox, oz);
    this.ready = true;
  }

  /**
   * A soft capsule from (ax, az) to (bx, bz) in world xz, `width` = radius of influence, with foam
   * strengths (r0, g0) at the start and (r1, g1) at the end: r = turbulent trail, g = bow wave.
   */
  capsule(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    width: number,
    r0: number,
    g0: number,
    r1: number,
    g1: number,
  ): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.a[i * 2] = ax;
    this.a[i * 2 + 1] = az;
    this.b[i * 2] = bx;
    this.b[i * 2 + 1] = bz;
    this.w[i] = width;
    this.v0[i * 2] = r0;
    this.v0[i * 2 + 1] = g0;
    this.v1[i * 2] = r1;
    this.v1[i * 2 + 1] = g1;
  }

  /** Fades and shifts the old map, stamps this frame's capsules on top, and swaps the targets. */
  render(renderer: WebGLRenderer): void {
    const dt = this.dt;
    const u = this.fade.uniforms;
    (u['uDecay']!.value as Vector2).set(Math.exp(-dt / TAU_TRAIL), Math.exp(-dt / TAU_BOW));
    u['uDiffuse']!.value = Math.min(0.8, DIFFUSION * dt);
    u['uPrev']!.value = this.targets[this.read]!.texture;

    for (let i = 0; i < this.attrs.length; i++) this.attrs[i]!.needsUpdate = true;
    this.stampGeo.instanceCount = this.count;

    const write = 1 - this.read;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.targets[write]!);
    renderer.render(this.fadeScene, this.camera);
    if (this.count > 0) renderer.render(this.stampScene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    this.read = write;
  }
}
