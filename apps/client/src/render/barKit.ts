import { MeshBasicMaterial, PlaneGeometry } from 'three';

/** Shared geometry/materials for billboarded health bars. */
export class BarKit {
  readonly bgGeo = new PlaneGeometry(5.3, 1.1);
  readonly fillGeo = new PlaneGeometry(5, 0.38);
  readonly bgMat = new MeshBasicMaterial({
    color: 0x07121c,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
    depthWrite: false,
  });
  readonly hullMat = new MeshBasicMaterial({
    color: 0x59d36b,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  readonly shieldMat = new MeshBasicMaterial({
    color: 0x4cc9ff,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}
