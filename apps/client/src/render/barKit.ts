import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

import { rankIconUrl } from '../ui/rankBadge.ts';

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
const badgeImages: HTMLImageElement[] = [];

/** The picture of the insignia of `rank` (made once; may still be loading). */
function badgeImage(rank: number): HTMLImageElement {
  let img = badgeImages[rank];
  if (!img) {
    img = new Image();
    img.src = rankIconUrl(rank);
    badgeImages[rank] = img;
  }
  return img;
}

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
  /** Hull bar: green for the player's side, red for everyone else (whatever the team colors are). */
  readonly hullMat: { friend: MeshBasicMaterial; foe: MeshBasicMaterial } = {
    friend: bar(0x3be06f),
    foe: bar(0xff2c46),
  };
  /** Light cyan, clearly different from the blue team. */
  readonly shieldMat = bar(0x8ff6ff);
  private readonly tagGeo = new PlaneGeometry(TAG_WIDTH, TAG_HEIGHT);

  /** What each name plate shows (to draw it again when the rank changes). */
  private readonly tags = new WeakMap<Mesh, { canvas: HTMLCanvasElement; name: string; team: Team; rank: number }>();

  /**
   * A camera-facing name plate in the team's color (one small texture per ship, made once). `rank`: the insignia
   * drawn left of the name (-1: none).
   */
  makeNameTag(name: string, team: Team, rank = -1): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = Math.round((256 * TAG_HEIGHT) / TAG_WIDTH);
    const state = { canvas, name, team, rank };
    this.paintTag(state);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      this.tagGeo,
      new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false }),
    );
    mesh.renderOrder = 13;
    this.tags.set(mesh, state);
    return mesh;
  }

  /** Shows another rank on a name plate (nothing happens when it is the same). */
  setTagRank(tag: Mesh, rank: number): void {
    const state = this.tags.get(tag);
    if (!state || state.rank === rank) return;
    state.rank = rank;
    this.paintTag(state, tag);
  }

  private paintTag(state: { canvas: HTMLCanvasElement; name: string; team: Team; rank: number }, tag?: Mesh): void {
    const { canvas, name, team, rank } = state;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = "700 30px 'Oxanium', system-ui, sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const text = name.toLocaleUpperCase();
    // The insignia is 3:4; it takes a little room left of the name.
    const badgeH = canvas.height - 8;
    const badgeW = rank >= 0 ? Math.round(badgeH * 0.75) + 6 : 0;
    const w = Math.min(canvas.width - 8, g.measureText(text).width + 30 + badgeW);
    const h = canvas.height - 6;
    const x = (canvas.width - w) / 2;
    const y = 3;
    // A dark plate with a thin edge in the team's color and cut corners (like the HUD panels).
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
    g.fillText(text, x + badgeW + (w - badgeW) / 2, canvas.height / 2 + 1, canvas.width - 40 - badgeW);
    if (rank >= 0) {
      const img = badgeImage(rank);
      const draw = (): void => {
        g.drawImage(img, x + 7, (canvas.height - badgeH) / 2, Math.round(badgeH * 0.75), badgeH);
      };
      if (img.complete && img.naturalWidth > 0) draw();
      else {
        // The picture is still decoding: add it when it is there.
        img.addEventListener('load', () => {
          if (state.rank !== rank) return;
          draw();
          const mat = tag?.material as MeshBasicMaterial | undefined;
          if (mat?.map) mat.map.needsUpdate = true;
        }, { once: true });
      }
    }
  }
}
