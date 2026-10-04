import { InstancedMesh, MeshLambertMaterial, SphereGeometry } from 'three';

/** One instanced draw call for every cannonball. Matrices start as identity. */
export function createProjectileMesh(capacity: number): InstancedMesh {
  const geo = new SphereGeometry(0.4, 8, 6);
  const mat = new MeshLambertMaterial({
    color: 0x1b1b22,
    emissive: 0x3a2a10,
    emissiveIntensity: 0.6,
  });
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
