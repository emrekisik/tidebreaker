import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshLambertMaterial,
} from 'three';
import type { BufferGeometry, Scene } from 'three';
import { PICKUP_CAPACITY } from '@tidebreaker/shared';

function make(scene: Scene, geo: BufferGeometry, color: number, glow: number): InstancedMesh {
  const mat = new MeshLambertMaterial({
    color: new Color(color),
    emissive: new Color(color),
    emissiveIntensity: glow,
    flatShading: true,
  });
  const mesh = new InstancedMesh(geo, mat, PICKUP_CAPACITY);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** The four instanced meshes of the pickups: crates, barrels, chests, banknote piles (in that order). */
export function makePickupMeshes(scene: Scene): InstancedMesh[] {
  return [
    make(scene, new BoxGeometry(1.6, 1.3, 1.6), 0xb07a45, 0.25),
    make(scene, new CylinderGeometry(0.75, 0.75, 1.5, 8), 0xc4472f, 0.25),
    make(scene, new BoxGeometry(2.6, 1.6, 1.8), 0xe9b92f, 0.45),
    make(scene, new BoxGeometry(1.7, 0.3, 1.1), 0x59d27a, 0.55),
  ];
}
