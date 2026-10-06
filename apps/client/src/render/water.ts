import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { WAVE_MAX, glslWaveFunction, glslWaveSlope } from './waves.ts';

const SIZE = 600;
const SEGMENTS = 100;
const CELL = SIZE / SEGMENTS;

/** Where the sun is (matches the DirectionalLight in Stage). */
const SUN = new Vector3(-40, 80, 30).normalize();

const VERTEX = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vH;
${glslWaveFunction()}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float h = waveHeight(w.xz, uTime);
  w.y += h;
  vWorld = w.xyz;
  vH = h;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Smooth normals come from the wave function itself (not from the triangles), so the grid never
// shows. Stylized on top: flat-ish color bands, depth patches, sky reflection at grazing angles,
// sun glitter and foam on the crests.
const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSun;
uniform vec2 uCenter;
uniform float uSlope;
uniform float uWaveMax;
varying vec3 vWorld;
varying float vH;

${glslWaveSlope()}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 p = vWorld.xz;

  // Surface normal from the wave slope, plus two scrolling ripple layers for fine detail.
  vec2 slope = waveSlope(p, uTime);
  // Two scrolling ripple layers for fine detail (one noise lookup per axis pair).
  vec2 rip = vec2(vnoise(p * 0.8 + vec2(uTime * 0.35, uTime * 0.2)),
                  vnoise(p * 0.8 + vec2(17.0 - uTime * 0.3, uTime * 0.25))) - 0.5;
  rip += (vnoise(p * 2.1 + vec2(uTime * 0.6, uTime * 0.5)) - 0.5) * 0.5;
  vec3 n = normalize(vec3(-slope.x * uSlope + rip.x * 0.22, 1.0, -slope.y * uSlope + rip.y * 0.22));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSun + V);
  float diff = dot(n, uSun) * 0.5 + 0.5;

  // Slow, large depth patches so the sea is not one flat tone.
  float depthPatch = vnoise(p * 0.018 + vec2(uTime * 0.01, 0.0));
  float crest = vH / uWaveMax;
  float t = clamp(0.40 + crest * 0.26 + (diff - 0.7) * 0.7 + (depthPatch - 0.5) * 0.35, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, t);

  // Sky reflection grows toward the horizon (fresnel).
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, uSky, clamp(fres * 0.55, 0.0, 0.45));

  // Sun glitter: a tight lobe plus a broader, slowly twinkling one.
  float nh = max(dot(n, H), 0.0);
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + depthPatch * 60.0);
  col += pow(nh, 220.0) * 0.28 + pow(nh, 36.0) * 0.1 * twinkle;

  // Foam streaks ride on the crests and drift with the swell.
  float fn = vnoise(vWorld.xz * 1.1 + vec2(uTime * 0.3, uTime * 0.14));
  float foam = smoothstep(0.78, 0.98, crest + (fn - 0.5) * 0.6);
  col = mix(col, uFoam, foam * 0.32);

  // Fade into the haze before the edge of the plane.
  float d = length(vWorld.xz - uCenter);
  col = mix(col, uDeep * 0.92, smoothstep(${(SIZE * 0.36).toFixed(1)}, ${(SIZE * 0.48).toFixed(1)}, d));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** One plane that follows the camera; waves and colors are computed from world position. */
export class Water {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new Color(0x031a33) },
        uShallow: { value: new Color(0x0b4f86) },
        uFoam: { value: new Color(0xe6f6fb) },
        uSky: { value: new Color(0x2c76a8) },
        uSun: { value: SUN },
        uCenter: { value: new Vector2() },
        uSlope: { value: 2.6 },
        uWaveMax: { value: WAVE_MAX },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    const geo = new PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Ocean colors (sRGB hex): deep water and the lighter tone on wave crests and slopes. */
  setColors(deepHex: number, shallowHex: number): void {
    (this.material.uniforms['uDeep']!.value as Color).set(deepHex);
    (this.material.uniforms['uShallow']!.value as Color).set(shallowHex);
  }

  update(timeSec: number, centerX: number, centerZ: number): void {
    this.material.uniforms['uTime']!.value = timeSec;
    // Snap to the vertex grid so the facets do not swim when the plane moves.
    this.mesh.position.x = Math.round(centerX / CELL) * CELL;
    this.mesh.position.z = Math.round(centerZ / CELL) * CELL;
    (this.material.uniforms['uCenter']!.value as Vector2).set(
      this.mesh.position.x,
      this.mesh.position.z,
    );
  }
}
