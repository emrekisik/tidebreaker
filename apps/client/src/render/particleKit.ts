import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  PlaneGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  OctahedronGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { FX } from '@tidebreaker/shared';

/** How a pool orients its particles. */
export const MODE_UNIFORM = 0; // uniformly scaled, no rotation
export const MODE_TUMBLE = 1; // spins around two axes (debris)
export const MODE_STREAK = 2; // stretched along the velocity (sparks)

/** An instanced mesh plus the per-instance color/alpha buffers the particle shader reads. */
export interface ParticleBuffers {
  mesh: InstancedMesh;
  color: InstancedBufferAttribute;
  alpha: InstancedBufferAttribute;
  mode: number;
}

export interface ParticleKit {
  /** Lit, alpha-blended smoke and water. */
  puff: ParticleBuffers;
  /** Unlit, additive flames and flashes. */
  fire: ParticleBuffers;
  /** Unlit, additive streaks (sparks, embers). */
  spark: ParticleBuffers;
  /** Soft round additive glows (billboards): halos, fireballs. */
  glow: ParticleBuffers;
  /** Unlit, alpha-blended streaks: tracer trails keep their color on bright water. */
  tracer: ParticleBuffers;
  debris: ParticleBuffers;
  /** Flat foam on the water surface. */
  foam: ParticleBuffers;
}

const SUN = new Vector3(-40, 80, 30).normalize();

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vColor = aColor;
  vAlpha = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Flat shading from derivatives keeps every particle faceted (low-poly) without extra normals.
const FRAGMENT = /* glsl */ `
uniform vec3 uSun;
uniform float uLit;
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float d = abs(dot(n, uSun));
  vec3 col = vColor * mix(1.0, 0.5 + 0.7 * d, uLit);
  float a = vAlpha;
  if (uSoft > 0.5) a *= smoothstep(0.5, 0.4, length(vUv - 0.5));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// Camera-facing quad with a soft radial falloff; the particle scale is the quad size.
const GLOW_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  vec4 mv = viewMatrix * center;
  mv.xy += position.xy * size;
  vColor = aColor;
  vAlpha = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
void main() {
  float d = clamp(1.0 - length(vUv - 0.5) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(vColor, vAlpha * d * d);
  #include <colorspace_fragment>
}
`;

interface MaterialOptions {
  billboard?: boolean;
  lit: boolean;
  additive: boolean;
  opaque: boolean;
  soft: boolean;
}

function material(o: MaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSun: { value: SUN },
      uLit: { value: o.lit ? 1 : 0 },
      uSoft: { value: o.soft ? 1 : 0 },
    },
    vertexShader: o.billboard ? GLOW_VERTEX : VERTEX,
    fragmentShader: o.billboard ? GLOW_FRAGMENT : FRAGMENT,
    transparent: !o.opaque,
    depthWrite: o.opaque,
    side: DoubleSide,
    blending: o.additive ? AdditiveBlending : NormalBlending,
  });
}

function buffers(
  geo: BufferGeometry,
  capacity: number,
  mode: number,
  o: MaterialOptions,
): ParticleBuffers {
  const color = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const alpha = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  geo.setAttribute('aColor', color);
  geo.setAttribute('aAlpha', alpha);
  const mesh = new InstancedMesh(geo, material(o), capacity);
  const arr = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < capacity; i++) arr[i * 16 + 15] = 1;
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, color, alpha, mode };
}

/** Meshes for all particle pools: 7 draw calls in total. */
export function createParticleKit(): ParticleKit {
  const cap = FX.capacity;
  const foam = buffers(new CircleGeometry(0.5, 9).rotateX(-Math.PI / 2), cap.foam, MODE_UNIFORM, {
    lit: false,
    additive: false,
    opaque: false,
    soft: true,
  });
  foam.mesh.renderOrder = 1; // after the water, before the ships' blob shadows
  const puff = buffers(new IcosahedronGeometry(0.5, 1), cap.puff, MODE_UNIFORM, {
    lit: true,
    additive: false,
    opaque: false,
    soft: false,
  });
  const fire = buffers(new IcosahedronGeometry(0.5, 0), cap.fire, MODE_UNIFORM, {
    lit: false,
    additive: true,
    opaque: false,
    soft: false,
  });
  const glow = buffers(new PlaneGeometry(1, 1), cap.glow, MODE_UNIFORM, {
    billboard: true,
    lit: false,
    additive: true,
    opaque: false,
    soft: false,
  });
  const spark = buffers(new OctahedronGeometry(0.5, 0), cap.spark, MODE_STREAK, {
    lit: false,
    additive: true,
    opaque: false,
    soft: false,
  });
  const tracer = buffers(new OctahedronGeometry(0.5, 0), cap.tracer, MODE_STREAK, {
    lit: false,
    additive: false,
    opaque: false,
    soft: false,
  });
  const debris = buffers(new BoxGeometry(1, 0.6, 0.8), cap.debris, MODE_TUMBLE, {
    lit: true,
    additive: false,
    opaque: true,
    soft: false,
  });
  return { puff, fire, glow, spark, tracer, debris, foam };
}
