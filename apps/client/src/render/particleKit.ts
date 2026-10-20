import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  DataTexture,
  PlaneGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  OctahedronGeometry,
  ShaderMaterial,
} from 'three';
import { FX } from '@tidebreaker/shared';
import { CLOUD_TILES, createCloudAtlas } from './cloudAtlas.ts';
import { SUN_DIR } from './stage.ts';

/** How a pool orients its particles. */
export const MODE_UNIFORM = 0; // uniformly scaled, no rotation
export const MODE_TUMBLE = 1; // spins around two axes (debris)
export const MODE_STREAK = 2; // stretched along the velocity (sparks)
export const MODE_SPRITE = 3; // camera-facing cloud sprite that turns on the spot (smoke, flames)

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
  /** Soft, billowy smoke sprites (alpha blended). */
  smoke: ParticleBuffers;
  /** Soft, billowy flame sprites (additive). */
  blaze: ParticleBuffers;
  /** Soft, ragged patches lying flat on the water (oil slicks, shock waves). */
  slick: ParticleBuffers;
}

const SUN = SUN_DIR;

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

// Camera-facing cloud sprites: the quad turns by an angle stored in the instance matrix (x axis = size * (cos, sin)),
// and each particle shows one of the atlas's clouds (picked by its instance index) so a column of them is not a stamp.
const SPRITE_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
varying vec2 vTurn;
varying float vTile;
uniform float uMode;
void main() {
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 axis = instanceMatrix[0].xyz;
  float size = length(axis);
  vec2 turn = axis.xy / max(size, 0.0001);
  vec2 p = vec2(turn.x * position.x - turn.y * position.y, turn.y * position.x + turn.x * position.y);
  vec4 mv = viewMatrix * center;
  if (uMode > 1.5) {
    // Lying flat on the water: the quad turns in the horizontal plane.
    mv = viewMatrix * vec4(center.x + p.x * size, center.y, center.z + p.y * size, 1.0);
  } else {
    mv.xy += p * size;
  }
  vColor = aColor;
  vAlpha = aAlpha;
  vUv = uv;
  vTurn = turn;
  vTile = mod(float(gl_InstanceID), ${CLOUD_TILES * CLOUD_TILES}.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
uniform sampler2D uCloud;
uniform float uMode;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
varying vec2 vTurn;
varying float vTile;
void main() {
  float tiles = ${CLOUD_TILES}.0;
  vec2 tile = vec2(mod(vTile, tiles), floor(vTile / tiles));
  vec2 uv = (tile + clamp(vUv, 0.01, 0.99)) / tiles;
  float d = texture2D(uCloud, uv).r;
  vec3 col = vColor;
  if (uMode > 1.5) {
    gl_FragColor = vec4(col, vAlpha * d);
  } else if (uMode > 0.5) {
    // Fake light from the upper left of the screen: the side facing it is brighter, the far side darker (the quad turns, so turn back first).
    vec2 rel = vUv - 0.5;
    vec2 back = vec2(vTurn.x * rel.x + vTurn.y * rel.y, -vTurn.y * rel.x + vTurn.x * rel.y);
    float side = dot(back, vec2(-0.6, 0.8)) * 2.0;
    col *= clamp(0.78 + 0.5 * side * d + 0.18 * d, 0.45, 1.35);
    gl_FragColor = vec4(col, vAlpha * d);
  } else {
    // Flames: the dense middle burns hotter (brighter), the thin rim is dimmer.
    gl_FragColor = vec4(col * (0.55 + 0.9 * d * d), vAlpha * d);
  }
  #include <colorspace_fragment>
}
`;

interface MaterialOptions {
  billboard?: boolean;
  sprite?: 'smoke' | 'blaze' | 'slick';
  lit: boolean;
  additive: boolean;
  opaque: boolean;
  soft: boolean;
}

let cloudAtlas: DataTexture | null = null;

function material(o: MaterialOptions): ShaderMaterial {
  if (o.sprite) {
    cloudAtlas ??= createCloudAtlas();
    return new ShaderMaterial({
      uniforms: { uCloud: { value: cloudAtlas }, uMode: { value: o.sprite === 'slick' ? 2 : o.sprite === 'smoke' ? 1 : 0 } },
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Smoke and flames rise above everything: the water must not cut their base off along a straight line.
      depthTest: o.sprite === 'slick',
      side: DoubleSide,
      blending: o.additive ? AdditiveBlending : NormalBlending,
    });
  }
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

/** Meshes for all particle pools: 10 draw calls in total. */
export function createParticleKit(): ParticleKit {
  const cap = FX.capacity;
  const foam = buffers(new CircleGeometry(0.5, 9).rotateX(-Math.PI / 2), cap.foam, MODE_UNIFORM, {
    lit: false,
    additive: false,
    opaque: false,
    soft: true,
  });
  foam.mesh.renderOrder = 1; // after the water, before the ships
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
  const smoke = buffers(new PlaneGeometry(1, 1), cap.smoke, MODE_SPRITE, {
    sprite: 'smoke',
    lit: false,
    additive: false,
    opaque: false,
    soft: false,
  });
  const blaze = buffers(new PlaneGeometry(1, 1), cap.blaze, MODE_SPRITE, {
    sprite: 'blaze',
    lit: false,
    additive: true,
    opaque: false,
    soft: false,
  });
  const slick = buffers(new PlaneGeometry(1, 1), cap.slick, MODE_SPRITE, {
    sprite: 'slick',
    lit: false,
    additive: false,
    opaque: false,
    soft: false,
  });
  slick.mesh.renderOrder = 1; // like foam: after the water, before the ships
  // Order of the transparent layers: smoke, then flames over it, then the bright sparks and glows over both.
  smoke.mesh.renderOrder = 3;
  blaze.mesh.renderOrder = 4;
  glow.mesh.renderOrder = 5;
  fire.mesh.renderOrder = 5;
  spark.mesh.renderOrder = 5;
  return { puff, fire, glow, spark, tracer, debris, foam, smoke, blaze, slick };
}
