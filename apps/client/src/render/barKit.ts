import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

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

const TAG_WIDTH = 9;
const TAG_HEIGHT = 1.7;
const TAG_COLOR: Record<Team, string> = { blue: '#9fd2ff', red: '#ffa3ad' };

/** Frees the texture and material of a name tag made by `BarKit.makeNameTag`. */
export function disposeNameTag(tag: Mesh): void {
  const mat = tag.material as MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
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
  private readonly tagGeo = new PlaneGeometry(TAG_WIDTH, TAG_HEIGHT);

  /** A camera-facing name plate in the team's color (one small texture per ship, made once). */
  makeNameTag(name: string, team: Team): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = Math.round((256 * TAG_HEIGHT) / TAG_WIDTH);
    const g = canvas.getContext('2d');
    if (g) {
      g.font = '700 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 7;
      g.strokeStyle = 'rgba(3, 10, 18, 0.9)';
      g.strokeText(name, canvas.width / 2, canvas.height / 2, canvas.width - 10);
      g.fillStyle = TAG_COLOR[team];
      g.fillText(name, canvas.width / 2, canvas.height / 2, canvas.width - 10);
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      this.tagGeo,
      new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false }),
    );
    mesh.renderOrder = 13;
    return mesh;
  }
}
