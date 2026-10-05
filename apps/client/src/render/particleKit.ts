import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  OctahedronGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { FX } from '@tidebreaker/shared';

/** An instanced mesh plus the per-instance color/alpha buffers the particle shader reads. */
export interface ParticleBuffers {
  mesh: InstancedMesh;
  color: InstancedBufferAttribute;
  alpha: InstancedBufferAttribute;
  /** Debris tumbles; other kinds are uniformly scaled. */
  rotates: boolean;
}

export interface ParticleKit {
  puff: ParticleBuffers;
  spark: ParticleBuffers;
  debris: ParticleBuffers;
  foam: ParticleBuffers;
}

const SUN = new Vector3(-40, 80, 30).normalize();

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Flat shading from derivatives keeps every particle faceted (low-poly) without extra normals.
const FRAGMENT = /* glsl */ `
uniform vec3 uSun;
uniform float uLit;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float d = abs(dot(n, uSun));
  vec3 col = vColor * mix(1.0, 0.55 + 0.6 * d, uLit);
  gl_FragColor = vec4(col, vAlpha);
  #include <colorspace_fragment>
}
`;

function material(lit: boolean, transparent: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uSun: { value: SUN }, uLit: { value: lit ? 1 : 0 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent,
    depthWrite: !transparent,
    side: DoubleSide,
  });
}

function buffers(
  geo: BufferGeometry,
  capacity: number,
  lit: boolean,
  transparent: boolean,
  rotates: boolean,
): ParticleBuffers {
  const color = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const alpha = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  geo.setAttribute('aColor', color);
  geo.setAttribute('aAlpha', alpha);
  const mesh = new InstancedMesh(geo, material(lit, transparent), capacity);
  const arr = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < capacity; i++) arr[i * 16 + 15] = 1;
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, color, alpha, rotates };
}

/** Meshes for all particle pools: 4 draw calls in total. */
export function createParticleKit(): ParticleKit {
  const cap = FX.capacity;
  const foamGeo = new CircleGeometry(0.5, 4).rotateX(-Math.PI / 2);
  const foam = buffers(foamGeo, cap.foam, false, true, false);
  foam.mesh.renderOrder = 1; // after the water, before ships' blob shadows
  return {
    puff: buffers(new IcosahedronGeometry(0.5, 0), cap.puff, true, true, false),
    spark: buffers(new OctahedronGeometry(0.5, 0), cap.spark, false, true, false),
    debris: buffers(new BoxGeometry(1, 0.6, 0.8), cap.debris, true, false, true),
    foam,
  };
}
