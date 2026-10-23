import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshLambertMaterial,
} from 'three';
import type { BufferGeometry, Material, Scene } from 'three';
import { PICKUP_CAPACITY } from '@tidebreaker/shared';
import type { AssetProvider } from './assets.ts';

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

/**
 * The banknote model's material turned gold: the picture keeps its detail but is shown in gold tones (the
 * brightness of each texel picks the shade), and the pile glows a little.
 */
function goldMaterial(source: Material): Material {
  const mat = (source as MeshLambertMaterial).clone();
  mat.emissiveMap = null;
  mat.emissive.set(0xffa81c);
  mat.emissiveIntensity = 0.5;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = vec3(1.0, 0.76, 0.2) * (0.5 + lum * 1.3);`,
    );
  };
  mat.customProgramCacheKey = () => 'gold-banknote';
  return mat;
}

/** A mesh from a loaded model (instanced), or null when the model is not there. `gold`: shown in gold. */
function fromModel(scene: Scene, assets: AssetProvider, key: string, scale: number, gold = false): InstancedMesh | null {
  const prop = assets.prop(key);
  if (!prop) return null;
  const mesh = new InstancedMesh(prop.geometry, gold ? goldMaterial(prop.material) : prop.material, PICKUP_CAPACITY);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The view reads the size of one instance from here (the models are fitted to a unit footprint).
  mesh.userData['scale'] = scale;
  scene.add(mesh);
  return mesh;
}

/**
 * The five instanced meshes of the pickups: crates, barrels, chests, banknote piles, gold banknotes (in that
 * order). They use the wooden crate, red barrel, golden chest and money models when those are loaded (the gold
 * banknotes are the money model in gold), and plain colored shapes otherwise.
 */
export function makePickupMeshes(scene: Scene, assets: AssetProvider): InstancedMesh[] {
  return [
    fromModel(scene, assets, 'wooden_create_loot', 1.9) ??
      make(scene, new BoxGeometry(1.6, 1.3, 1.6), 0xb07a45, 0.25),
    fromModel(scene, assets, 'red_oil_barrel', 1.5) ??
      make(scene, new CylinderGeometry(0.85, 0.85, 1.7, 8), 0xd8321f, 0.55),
    fromModel(scene, assets, 'pirate_golden_treasure_chest', 2.3) ??
      make(scene, new BoxGeometry(2.6, 1.6, 1.8), 0xe9b92f, 0.45),
    fromModel(scene, assets, 'money_model', 2.2) ??
      make(scene, new BoxGeometry(1.7, 0.3, 1.1), 0x59d27a, 0.55),
    fromModel(scene, assets, 'money_model', 3.3, true) ??
      make(scene, new BoxGeometry(2.1, 0.4, 1.4), 0xf2b82a, 0.7),
  ];
}
