import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { Texture } from 'three';
import { WAKE_EXTENT } from './wakeMap.ts';
import { WAVE_MAX, glslWaveFunction, glslWaveSlope } from './waves.ts';

const SIZE = 600;
const SEGMENTS = 200;
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
// shows. Stylized on top: color bands, depth patches, sky reflection at grazing angles, sun glitter,
// fine analytic chop, lacy whitecaps on the crests, and the ship wake foam map.
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
uniform sampler2D uWake;
uniform vec2 uWakeOrigin;
uniform float uWakeExtent;
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

// Fine chop too small for the vertex grid: a few extra analytic ripples (slope only).
vec2 chopSlope(vec2 p, float t) {
  vec2 s = vec2(0.0);
  s += 0.085 * vec2(0.94, 0.34) * cos(1.19 * dot(p, vec2(0.94, 0.34)) + 1.9 * t);
  s += 0.07 * vec2(-0.5, 0.87) * cos(1.85 * dot(p, vec2(-0.5, 0.87)) + 2.3 * t + 1.3);
  s += 0.06 * vec2(0.17, -0.98) * cos(2.7 * dot(p, vec2(0.17, -0.98)) + 2.7 * t + 2.1);
  s += 0.045 * vec2(-0.87, -0.5) * cos(3.9 * dot(p, vec2(-0.87, -0.5)) + 3.2 * t + 0.4);
  return s;
}

void main() {
  vec2 p = vWorld.xz;

  // Surface normal: swell slope, fine chop, and a little scrolling noise to break the pattern.
  vec2 slope = waveSlope(p, uTime) * uSlope + chopSlope(p, uTime);
  vec2 rip = vec2(vnoise(p * 0.9 + vec2(uTime * 0.35, uTime * 0.2)),
                  vnoise(p * 0.9 + vec2(17.0 - uTime * 0.3, uTime * 0.25))) - 0.5;
  vec3 n = normalize(vec3(-slope.x + rip.x * 0.12, 1.0, -slope.y + rip.y * 0.12));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSun + V);
  float diff = dot(n, uSun) * 0.5 + 0.5;

  // Slow, large depth patches so the sea is not one flat tone.
  float depthPatch = vnoise(p * 0.018 + vec2(uTime * 0.01, 0.0));
  float crest = vH / uWaveMax;
  float t = clamp(0.34 + crest * 0.42 + (diff - 0.7) * 1.6 + (depthPatch - 0.5) * 0.3, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, t);

  // Light shining through thin crests: a brighter, greener tint on the sun-facing side.
  float through = smoothstep(0.25, 0.95, crest) * (0.4 + 0.6 * max(dot(n, uSun), 0.0));
  col += (uShallow - uDeep * 0.5) * 0.22 * through;

  // Sky reflection grows toward the horizon (fresnel).
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, uSky, clamp(fres * 0.55, 0.0, 0.45));

  // Sun glitter: a tight lobe plus a broader, slowly twinkling one.
  float nh = max(dot(n, H), 0.0);
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + depthPatch * 60.0);
  col += pow(nh, 520.0) * 0.4 + pow(nh, 70.0) * 0.07 * twinkle;

  // Whitecaps: lacy foam on the crests, torn apart by two noise scales that drift with the swell.
  float lace = vnoise(p * 1.9 + vec2(uTime * 0.3, uTime * 0.14)) * 0.35
             + vnoise(p * 5.3 - vec2(uTime * 0.25, uTime * 0.1)) * 0.65;
  float caps = smoothstep(0.58, 0.9, crest + (lace - 0.5) * 0.7);
  col = mix(col, uFoam, caps * caps * 0.45);

  // Ship wakes from the foam map: R = turbulent trail, G = bow wave and Kelvin arms.
  vec2 wuv = (p - uWakeOrigin) / uWakeExtent;
  vec2 edge = smoothstep(0.0, 0.06, wuv) * (1.0 - smoothstep(0.94, 1.0, wuv));
  vec2 wk = texture2D(uWake, wuv).rg * (edge.x * edge.y);
  float wl = vnoise(p * 2.3 + vec2(uTime * 0.12, -uTime * 0.09)) * 0.55
           + vnoise(p * 5.9 - vec2(uTime * 0.2, uTime * 0.13)) * 0.45;
  float trail = smoothstep(0.1, 0.5, wk.r * (0.5 + 1.0 * wl));
  float bow = smoothstep(0.08, 0.4, wk.g * (0.6 + 0.8 * wl));
  col = mix(col, uShallow * 1.2 + 0.06, clamp(wk.r * 0.6, 0.0, 0.6));
  col = mix(col, uFoam, clamp(trail * 0.95 + bow * 0.9, 0.0, 0.97));

  // Fade into the haze before the edge of the plane.
  float d = length(vWorld.xz - uCenter);
  col = mix(col, uDeep, smoothstep(${(SIZE * 0.36).toFixed(1)}, ${(SIZE * 0.48).toFixed(1)}, d));

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
        uDeep: { value: new Color(0x0b6989) },
        uShallow: { value: new Color(0x13a0dd) },
        uFoam: { value: new Color(0xe6f6fb) },
        uSky: { value: new Color(0x2c76a8) },
        uSun: { value: SUN },
        uCenter: { value: new Vector2() },
        uSlope: { value: 5.5 },
        uWaveMax: { value: WAVE_MAX },
        uWake: { value: null },
        uWakeOrigin: { value: new Vector2() },
        uWakeExtent: { value: WAKE_EXTENT },
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

  /** Points the shader at the current foam map (call every frame; the texture is ping-ponged). */
  setWake(texture: Texture, originX: number, originZ: number): void {
    this.material.uniforms['uWake']!.value = texture;
    (this.material.uniforms['uWakeOrigin']!.value as Vector2).set(originX, originZ);
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
