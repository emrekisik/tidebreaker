import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { WAVE_MAX, glslWaveFunction } from './waves.ts';

const SIZE = 460;
const SEGMENTS = 80;
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

// Flat (per-triangle) shading from screen-space derivatives gives the faceted low-poly look.
const FRAGMENT = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSun;
uniform vec2 uCenter;
uniform float uFacet;
uniform float uWaveMax;
uniform float uCell;
varying vec3 vWorld;
varying float vH;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  n = normalize(vec3(n.x * uFacet, n.y, n.z * uFacet));

  float diff = dot(n, uSun) * 0.5 + 0.5;
  float cellRand = hash(floor(vWorld.xz / uCell)) - 0.5;
  float t = clamp(0.42 + vH / uWaveMax * 0.28 + (diff - 0.7) * 0.7 + cellRand * 0.07, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, t);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(n, H), 0.0), 260.0);
  col += spec * 0.22;

  // Crests pick up a little foam color.
  col = mix(col, uFoam, smoothstep(0.55, 1.0, vH / uWaveMax) * 0.28);

  // Fade into the sky/background color before the edge of the plane.
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
        uDeep: { value: new Color(0x0a4a73) },
        uShallow: { value: new Color(0x2a9fc4) },
        uFoam: { value: new Color(0xd8f1fa) },
        uSun: { value: SUN },
        uCenter: { value: new Vector2() },
        uFacet: { value: 4 },
        uWaveMax: { value: WAVE_MAX },
        uCell: { value: CELL },
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
    // Snap to the vertex grid so the facets do not swim when the plane moves.
    this.mesh.position.x = Math.round(centerX / CELL) * CELL;
    this.mesh.position.z = Math.round(centerZ / CELL) * CELL;
    (this.material.uniforms['uCenter']!.value as Vector2).set(
      this.mesh.position.x,
      this.mesh.position.z,
    );
  }
}
