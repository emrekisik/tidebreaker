import { MeshBasicMaterial, PlaneGeometry } from 'three';

type Team = 'blue' | 'red';

function bar(color: number, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
}

/** Shared geometry/materials for billboarded health bars. */
export class BarKit {
  readonly bgGeo = new PlaneGeometry(5.3, 0.95);
  readonly hullGeo = new PlaneGeometry(5, 0.4);
  /** The shield bar is thinner than the hull bar. */
  readonly shieldGeo = new PlaneGeometry(5, 0.2);
  readonly bgMat = bar(0x050d16, 0.78);
  /** The white "recently lost" part behind the real bar. */
  readonly ghostMat = bar(0xffffff, 0.92);
  /** Hull bar in the team color. */
  readonly hullMat: Record<Team, MeshBasicMaterial> = {
    blue: bar(0x2aa5ff),
    red: bar(0xff2c46),
  };
  /** Light cyan, clearly different from the blue team. */
  readonly shieldMat = bar(0x8ff6ff);
}
