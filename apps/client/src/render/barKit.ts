import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

type Team = 'blue' | 'red' | 'pirate';

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
const TAG_COLOR: Record<Team, string> = { blue: '#9fd2ff', red: '#ffa3ad', pirate: '#ffc778' };

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
    pirate: bar(0xffa83a),
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
      g.font = "700 30px 'IBM Plex Sans Condensed', 'Arial Narrow', system-ui, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const text = name.toLocaleUpperCase();
      const w = Math.min(canvas.width - 8, g.measureText(text).width + 30);
      const h = canvas.height - 6;
      const x = (canvas.width - w) / 2;
      const y = 3;
      // A dark plate with a thin edge in the team color and cut corners (like the HUD panels).
      const cut = 7;
      g.beginPath();
      g.moveTo(x + cut, y);
      g.lineTo(x + w - cut, y);
      g.lineTo(x + w, y + cut);
      g.lineTo(x + w, y + h - cut);
      g.lineTo(x + w - cut, y + h);
      g.lineTo(x + cut, y + h);
      g.lineTo(x, y + h - cut);
      g.lineTo(x, y + cut);
      g.closePath();
      g.fillStyle = 'rgba(6, 20, 38, 0.86)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = TAG_COLOR[team];
      g.globalAlpha = 0.7;
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = '#eaf4ff';
      g.fillText(text, canvas.width / 2, canvas.height / 2 + 1, canvas.width - 40);
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
