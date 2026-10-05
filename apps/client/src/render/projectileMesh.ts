import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ProjectileVisual } from '@tidebreaker/shared';

/** Order of the meshes returned by `createProjectileMeshes`; ProjectileView relies on it. */
export const VISUAL_ORDER: readonly ProjectileVisual[] = ['bullet', 'shell', 'rocket'];

function colored(geo: BufferGeometry, color: number, x = 0): BufferGeometry {
  geo.translate(x, 0, 0);
  const c = new Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return geo;
}

function instanced(geo: BufferGeometry, mat: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, capacity);
  const arr = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < capacity; i++) {
    arr[i * 16] = 1;
    arr[i * 16 + 5] = 1;
    arr[i * 16 + 10] = 1;
    arr[i * 16 + 15] = 1;
  }
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * One instanced draw call per projectile visual. Long shapes point along local +x, which the view
 * aligns with the velocity.
 */
export function createProjectileMeshes(capacity: number): InstancedMesh[] {
  // Machine-gun tracer: a short bright streak.
  const bullet = instanced(
    new BoxGeometry(1.1, 0.14, 0.14),
    new MeshBasicMaterial({ color: 0xffe27a }),
    capacity,
  );
  // Cannon shell: dark iron ball with a warm glow.
  const shell = instanced(
    new SphereGeometry(0.4, 8, 6),
    new MeshLambertMaterial({ color: 0x1b1b22, emissive: 0x3a2a10, emissiveIntensity: 0.6 }),
    capacity,
  );
  // Rocket: grey body, red nose, orange exhaust.
  const rocketGeo = mergeGeometries([
    colored(new BoxGeometry(1.2, 0.3, 0.3), 0xd8dde2),
    colored(new BoxGeometry(0.35, 0.22, 0.22), 0xd2452a, 0.75),
    colored(new BoxGeometry(0.4, 0.2, 0.2), 0xffa030, -0.78),
  ]);
  const rocket = instanced(rocketGeo, new MeshBasicMaterial({ vertexColors: true }), capacity);
  return [bullet, shell, rocket];
}
