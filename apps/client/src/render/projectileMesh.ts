import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
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

/** Gives the geometry one flat vertex color and shifts it along the shot axis (+x). */
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

/** A cylinder or cone lying along +x. */
function alongX(geo: BufferGeometry): BufferGeometry {
  return geo.rotateZ(-Math.PI / 2);
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

/** Machine-gun tracer: a hot white core inside a longer yellow-orange streak. */
function tracerGeometry(): BufferGeometry {
  return mergeGeometries([
    colored(new BoxGeometry(1.5, 0.1, 0.1), 0xffd36a, -0.15),
    colored(new BoxGeometry(0.7, 0.14, 0.14), 0xffffff, 0.2),
  ]);
}

/** Cannon shell: a thick hot tracer streak with a small dark shell at its tip. */
function shellGeometry(): BufferGeometry {
  return mergeGeometries([
    colored(new BoxGeometry(2.1, 0.28, 0.28), 0xffa63d, -0.35),
    colored(new BoxGeometry(1.2, 0.19, 0.19), 0xfff0a8, 0.05),
    colored(new SphereGeometry(0.21, 6, 4), 0x2d3139, 0.8),
  ]);
}

/** Rocket: white body, red nose, four tail fins and a dark nozzle. */
function rocketGeometry(): BufferGeometry {
  return mergeGeometries([
    colored(alongX(new CylinderGeometry(0.13, 0.13, 1, 8)), 0xe6eaee),
    colored(alongX(new ConeGeometry(0.13, 0.4, 8)), 0xd2452a, 0.7),
    colored(new BoxGeometry(0.36, 0.56, 0.02), 0xc7ccd1, -0.42),
    colored(new BoxGeometry(0.36, 0.02, 0.56), 0xc7ccd1, -0.42),
    colored(alongX(new CylinderGeometry(0.1, 0.12, 0.14, 8)), 0x2a2a2e, -0.55),
  ]);
}

/** One instanced draw call per projectile visual. Long shapes lie along +x. */
export function createProjectileMeshes(capacity: number): InstancedMesh[] {
  const bullet = instanced(
    tracerGeometry(),
    new MeshBasicMaterial({ vertexColors: true }),
    capacity,
  );
  const shell = instanced(shellGeometry(), new MeshBasicMaterial({ vertexColors: true }), capacity);
  const rocket = instanced(
    rocketGeometry(),
    new MeshLambertMaterial({ vertexColors: true }),
    capacity,
  );
  return [bullet, shell, rocket];
}
