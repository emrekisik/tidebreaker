import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { RIG, RIGS, RIG_NO_OWNER, TEAM_BLUE, TEAM_PIRATE, WORLD_SIZE } from '@tidebreaker/shared';
import type { Combatant, RigState, WorldMap } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';

const SMALL = 220;
const BIG = 600;
/** The small radar shows this many world units in every direction around the player. */
export const RADAR_RANGE = 280;
/** Grid line spacing (world units). */
const GRID = 100;

/** Radar colors: ships are crosses, pirates yellow skulls, carriers painted solid blue or red. */
const BLUE = '#4fe3ff';
const RED = '#ff5fa8';
const SKULL = '#ffd84d';
const CARRIER_BLUE = '#3f95ff';
const CARRIER_RED = '#ff4560';

/** What the minimap needs to know about a ship. */
export interface MapShip {
  x: number;
  y: number;
  heading: number;
  alive: boolean;
}

/** Where the radar looks: the world point in the middle of the canvas and how far it sees. */
interface View {
  cx: number;
  cy: number;
  /** Half the width of the visible square, in world units. */
  range: number;
}

/**
 * The radar map. The small one (corner) shows only the area around the player; `M` opens a large
 * one with the whole world in the same style, marking the patch of sea the player's screen shows.
 * Islands are dim teal shapes on a grid, ships are crosses (blue and red teams), pirates yellow
 * skulls, carriers small icons painted in their team's color (stuck to the edge when they are out
 * of the radar's range), oil rigs circles with their capture gauge.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: WorldMap;
  private size = SMALL;
  private big = false;
  /** The carrier icon, flat-painted once per team (blue, red) when its picture has loaded. */
  private readonly carrierIcons: (HTMLCanvasElement | null)[] = [null, null];
  /** Scratch for `coverage`: the four screen corners as points on the sea (x, y pairs). */
  private readonly view = new Float32Array(8);
  private readonly ray = new Vector3();
  private viewOk = false;

  constructor(container: HTMLElement, map: WorldMap) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    // Radar rings and a slow sweep over the small map (pure CSS, see theme.css).
    const radar = document.createElement('div');
    radar.className = 'radar';
    container.appendChild(radar);
    this.ctx = this.canvas.getContext('2d')!;
    const img = new Image();
    img.onload = (): void => {
      this.carrierIcons[0] = paint(img, CARRIER_BLUE);
      this.carrierIcons[1] = paint(img, CARRIER_RED);
    };
    img.src = `${import.meta.env.BASE_URL}icons/ships/side/white/aircraft_carrier.png`;
    this.resize();
  }

  toggle(): void {
    this.big = !this.big;
    this.size = this.big ? BIG : SMALL;
    this.resize();
  }

  /** Re-creates the canvas for the current size and pixel ratio. */
  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(this.size * dpr);
    this.canvas.width = px;
    this.canvas.height = px;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
  }

  /** Redraws the map (every frame: it moves with the player). */
  update(
    player: MapShip,
    others: readonly Combatant[],
    rigs: readonly RigState[] | null = null,
    camera: PerspectiveCamera | null = null,
  ): void {
    if (this.big && camera) this.viewOk = this.screenOnSea(camera);
    const view: View = this.big
      ? { cx: WORLD_SIZE / 2, cy: WORLD_SIZE / 2, range: WORLD_SIZE / 2 }
      : { cx: player.x, cy: player.y, range: RADAR_RANGE };
    this.draw(view, player, others, rigs);
  }

  private draw(
    view: View,
    player: MapShip,
    others: readonly Combatant[],
    rigs: readonly RigState[] | null,
  ): void {
    const px = this.canvas.width;
    const g = this.ctx;
    // Line widths and marker sizes are for the small map; the large one scales them down a bit.
    const u = (px / SMALL) * (this.big ? 0.6 : 1);
    const k = px / (2 * view.range);
    const mid = px / 2;
    const sx = (wx: number): number => (wx - view.cx) * k + mid;
    const sy = (wy: number): number => (wy - view.cy) * k + mid;
    const m = this.map;

    g.clearRect(0, 0, px, px);
    const bg = g.createRadialGradient(mid, mid, 0, mid, mid, mid * 1.3);
    bg.addColorStop(0, '#0e3440');
    bg.addColorStop(1, '#071a22');
    g.fillStyle = bg;
    g.fillRect(0, 0, px, px);

    // Grid, fixed to the world so it slides under the player.
    g.strokeStyle = 'rgba(120, 235, 245, 0.08)';
    g.lineWidth = Math.max(1, u);
    g.beginPath();
    for (
      let gx = Math.ceil((view.cx - view.range) / GRID) * GRID;
      gx <= view.cx + view.range;
      gx += GRID
    ) {
      g.moveTo(sx(gx), 0);
      g.lineTo(sx(gx), px);
    }
    for (
      let gy = Math.ceil((view.cy - view.range) / GRID) * GRID;
      gy <= view.cy + view.range;
      gy += GRID
    ) {
      g.moveTo(0, sy(gy));
      g.lineTo(px, sy(gy));
    }
    g.stroke();

    // Outside the world: dark.
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.beginPath();
    g.rect(0, 0, px, px);
    g.rect(sx(0), sy(0), WORLD_SIZE * k, WORLD_SIZE * k);
    g.fill('evenodd');

    // Islands and reefs.
    g.fillStyle = 'rgba(70, 170, 180, 0.5)';
    g.strokeStyle = 'rgba(150, 240, 245, 0.55)';
    g.lineWidth = 1.2 * u;
    for (let i = 0; i < m.islandCount; i++) {
      const reach = view.range * 1.42 + m.islandR[i]!;
      if (Math.abs(m.islandX[i]! - view.cx) > reach || Math.abs(m.islandY[i]! - view.cy) > reach) {
        continue;
      }
      g.beginPath();
      for (let v = m.vertStart[i]!; v < m.vertStart[i + 1]!; v++) {
        const x = sx(m.verts[v * 2]!);
        const y = sy(m.verts[v * 2 + 1]!);
        if (v === m.vertStart[i]) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillStyle = 'rgba(110, 200, 210, 0.45)';
    for (let i = RIG.count; i < m.reefCount; i++) {
      const x = sx(m.reefX[i]!);
      const y = sy(m.reefY[i]!);
      if (x < -10 || y < -10 || x > px + 10 || y > px + 10) continue;
      g.beginPath();
      g.arc(x, y, Math.max(1.2 * u, m.reefR[i]! * k), 0, Math.PI * 2);
      g.fill();
    }

    // Oil rigs: the capture circle in the owner's color with the gauge around it, a derrick mark.
    for (let i = 0; i < RIGS.length; i++) {
      const rig = RIGS[i]!;
      const x = sx(rig.x);
      const y = sy(rig.y);
      const rr = RIG.captureRadius * k;
      if (x < -rr || y < -rr || x > px + rr || y > px + rr) continue;
      const st = rigs?.[i];
      const owner = st?.owner ?? RIG_NO_OWNER;
      g.fillStyle =
        owner === RIG_NO_OWNER
          ? 'rgba(255,255,255,0.1)'
          : owner === TEAM_BLUE
            ? 'rgba(79,227,255,0.3)'
            : 'rgba(255,95,168,0.3)';
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2 * u;
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.stroke();
      if (st && Math.abs(st.meter) > 0.005) {
        g.strokeStyle = st.meter > 0 ? BLUE : RED;
        g.beginPath();
        g.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + Math.abs(st.meter) * Math.PI * 2);
        g.stroke();
      }
      // The rig's letter (the same A, B, C as the emotes and the rig bars), on a dark disc.
      g.fillStyle = '#0a1c24';
      g.strokeStyle = '#fff';
      g.lineWidth = u;
      g.beginPath();
      g.arc(x, y, 6.2 * u, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = owner === RIG_NO_OWNER ? '#fff' : owner === TEAM_BLUE ? BLUE : RED;
      g.font = `700 ${Math.round(8.4 * u)}px 'Oxanium', system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String.fromCharCode(65 + i), x, y + 0.5 * u);
    }

    // Ships: crosses and skulls. Carriers: a painted icon.
    const arm = 3.6 * u;
    const edge = 14 * u;
    for (const o of others) {
      const st = o.state;
      // Drones are too small and too many for the radar.
      if (!st.alive || o.def.flying) continue;
      const x = sx(st.x);
      const y = sy(st.y);
      if (o.def.vMax === 0) {
        this.carrier(g, o, x, y, mid, edge, px, u);
        continue;
      }
      if (x < 0 || y < 0 || x > px || y > px) continue;
      if (o.team === TEAM_PIRATE) {
        skull(g, x, y, 5 * u);
        continue;
      }
      g.strokeStyle = o.team === TEAM_BLUE ? BLUE : RED;
      g.lineWidth = 2 * u;
      g.beginPath();
      g.moveTo(x - arm, y - arm);
      g.lineTo(x + arm, y + arm);
      g.moveTo(x + arm, y - arm);
      g.lineTo(x - arm, y + arm);
      g.stroke();
    }

    // The player: a white arrow pointing where the ship heads, inside a small ring.
    g.save();
    g.translate(sx(player.x), sy(player.y));
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.2 * u;
    g.beginPath();
    g.arc(0, 0, 9 * u, 0, Math.PI * 2);
    g.stroke();
    g.rotate(player.heading);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(6 * u, 0);
    g.lineTo(-4 * u, 4 * u);
    g.lineTo(-2 * u, 0);
    g.lineTo(-4 * u, -4 * u);
    g.closePath();
    g.fill();
    g.restore();

    if (this.big && this.viewOk) this.coverage(g, view, k, mid, u);
  }

  /** A carrier: its icon where it is, or (small radar) at the edge toward it when out of range. */
  private carrier(
    g: CanvasRenderingContext2D,
    o: Combatant,
    x: number,
    y: number,
    mid: number,
    edge: number,
    px: number,
    u: number,
  ): void {
    const icon = this.carrierIcons[o.team === TEAM_BLUE ? 0 : 1];
    if (!icon) return;
    const inside = x > edge && y > edge && x < px - edge && y < px - edge;
    let ix = x;
    let iy = y;
    if (!inside) {
      // Slide along the line to the carrier until the icon touches the edge.
      const d = Math.max(Math.abs(x - mid), Math.abs(y - mid)) || 1;
      const f = (mid - edge) / d;
      ix = mid + (x - mid) * f;
      iy = mid + (y - mid) * f;
    }
    const w = (inside ? 32 : 22) * u;
    g.save();
    g.globalAlpha = inside ? 1 : 0.8;
    g.translate(ix, iy);
    if (inside) g.rotate(o.state.heading);
    g.drawImage(icon, -w / 2, -w / 4, w, w / 2);
    g.restore();
  }

  /**
   * Finds where the four corners of the screen land on the sea (y = 0) by shooting a ray from the
   * camera through each corner, so the area follows the camera exactly: zoom, tilt, window shape.
   * Returns false if a corner looks above the horizon.
   */
  private screenOnSea(camera: PerspectiveCamera): boolean {
    camera.updateMatrixWorld();
    const o = camera.position;
    for (let i = 0; i < 4; i++) {
      this.ray
        .set(i === 0 || i === 3 ? -1 : 1, i < 2 ? 1 : -1, 0.5)
        .unproject(camera)
        .sub(o);
      if (this.ray.y > -1e-4) return false;
      const f = -o.y / this.ray.y;
      this.view[i * 2] = o.x + this.ray.x * f;
      // The sim's y axis is three.js z.
      this.view[i * 2 + 1] = o.z + this.ray.z * f;
    }
    return true;
  }

  /**
   * On the large map: the patch of sea the player's screen shows right now (a trapezoid, because
   * the camera looks down at a slant), drawn from `screenOnSea`.
   */
  private coverage(g: CanvasRenderingContext2D, view: View, k: number, mid: number, u: number): void {
    const v = this.view;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const x = (v[i * 2]! - view.cx) * k + mid;
      const y = (v[i * 2 + 1]! - view.cy) * k + mid;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = 'rgba(255, 255, 255, 0.06)';
    g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 1.5 * u;
    g.stroke();

    // Legend.
    const px = this.canvas.width;
    g.font = `${Math.round(px * 0.028)}px Oxanium, system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const lx = px * 0.035;
    let ly = px * 0.045;
    const step = px * 0.045;
    g.fillStyle = '#0a1c24';
    g.strokeStyle = '#fff';
    g.lineWidth = u;
    g.beginPath();
    g.arc(lx, ly, 6.2 * u, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    g.save();
    g.font = `700 ${Math.round(8.4 * u)}px 'Oxanium', system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText('A', lx, ly + 0.5 * u);
    g.restore();
    g.fillText(t('map.rig'), lx + 12 * u, ly);
    ly += step;
    skull(g, lx, ly, 5 * u);
    g.fillStyle = '#fff';
    g.fillText(t('map.pirate'), lx + 12 * u, ly);
  }
}

/** Paints every visible pixel of a (white) picture in one color. */
function paint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** A small yellow skull (the pirate mark): round head, jaw, dark eyes and nose. */
function skull(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = SKULL;
  g.beginPath();
  g.arc(x, y - r * 0.15, r * 0.85, 0, Math.PI * 2);
  g.fill();
  g.fillRect(x - r * 0.45, y + r * 0.3, r * 0.9, r * 0.7);
  g.fillStyle = '#10222a';
  g.beginPath();
  g.arc(x - r * 0.33, y - r * 0.2, r * 0.22, 0, Math.PI * 2);
  g.arc(x + r * 0.33, y - r * 0.2, r * 0.22, 0, Math.PI * 2);
  g.fill();
  g.fillRect(x - r * 0.07, y + r * 0.1, r * 0.14, r * 0.22);
}
