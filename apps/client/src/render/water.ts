import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

const VERTEX = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float h = sin(w.x * 0.35 + uTime * 1.2) * 0.05
          + sin(w.z * 0.27 - uTime * 0.9) * 0.05
          + sin((w.x + w.z) * 0.18 + uTime * 0.6) * 0.04;
  w.y += h;
  vWorld = w.xyz;
  vH = h;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWorld;
varying float vH;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 p = vWorld.xz;
  float n = noise(p * 0.12 + vec2(uTime * 0.05, uTime * 0.03)) * 0.6
          + noise(p * 0.45 - vec2(uTime * 0.08, 0.0)) * 0.4;
  vec3 col = mix(uDeep, uShallow, clamp(n * 0.9 + vH * 2.5, 0.0, 1.0));
  // Moving glints give a sense of speed over an otherwise flat sea.
  float glint = smoothstep(0.82, 0.95, noise(p * 1.4 + vec2(uTime * 0.25, -uTime * 0.18)));
  col += glint * 0.10;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const SIZE = 700;
const SEGMENTS = 112;
const SNAP = SIZE / SEGMENTS;

/** One plane that follows the camera; waves and colors are computed from world position. */
export class Water {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new Color(0x0a4a73) },
        uShallow: { value: new Color(0x1f86a8) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    const geo = new PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  update(timeSec: number, centerX: number, centerZ: number): void {
    this.material.uniforms['uTime']!.value = timeSec;
    // Snap to the vertex grid so the waves do not swim when the plane moves.
    this.mesh.position.x = Math.round(centerX / SNAP) * SNAP;
    this.mesh.position.z = Math.round(centerZ / SNAP) * SNAP;
  }
}
