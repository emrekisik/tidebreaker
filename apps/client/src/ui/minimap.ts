import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { ISLAND_TYPES, MAP, WORLD_SIZE } from '@tidebreaker/shared';
import type { WorldMap } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

const SMALL = 220;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const BIG = 600;

/** Marker color of each island type (also used by the legend). */
const MARK: Record<string, { color: string; label: MessageKey }> = {
  port: { color: '#4cc9f0', label: 'map.port' },
  fort: { color: '#ff5a5f', label: 'map.fort' },
  treasure: { color: '#ffd166', label: 'map.treasure' },
  flat: { color: '', label: 'map.flat' },
};

/** What the minimap needs to know about a ship. */
export interface MapShip {
  x: number;
  y: number;
  heading: number;
  alive: boolean;
}

/**
 * 2D minimap (`M` switches between a small corner map and a large one). The sea, islands, reefs
 * and the storm band are drawn once into an off-screen canvas; every frame only the ships and
 * the camera's view area are drawn on top. Shows the whole 2400 x 2400 world, so it also answers
 * "how far is that island?" with a scale bar.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: WorldMap;
  private base: HTMLCanvasElement | null = null;
  private size = SMALL;
  private big = false;
  private readonly ray = new Vector3();
  private readonly cam = new Vector3();
  private readonly view = new Float32Array(8);

  constructor(container: HTMLElement, map: WorldMap) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  toggle(): void {
    this.big = !this.big;
    this.size = this.big ? BIG : SMALL;
    this.resize();
  }

  /** Re-creates the canvases for the current size and pixel ratio. */
  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(this.size * dpr);
    this.canvas.width = px;
    this.canvas.height = px;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.base = this.drawBase(px);
  }

  /** The unchanging part: sea, storm band, islands, reefs, markers, grid, legend. */
  private drawBase(px: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d')!;
    const s = px / WORLD_SIZE;
    const m = this.map;

    g.fillStyle = '#0d5f84';
    g.fillRect(0, 0, px, px);
    // The soft wall at the edge of the world.
    const edge = MAP.boundary.width * s;
    g.fillStyle = 'rgba(8, 22, 34, 0.55)';
    g.fillRect(0, 0, px, edge);
    g.fillRect(0, px - edge, px, edge);
    g.fillRect(0, edge, edge, px - 2 * edge);
    g.fillRect(px - edge, edge, edge, px - 2 * edge);

    // Distance rings from the center help to judge how far things are.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (const r of [MAP.regions.inner, MAP.regions.outer]) {
      g.beginPath();
      g.arc(px / 2, px / 2, r * s, 0, Math.PI * 2);
      g.stroke();
    }

    // Islands: pale shallows, then the land.
    for (let i = 0; i < m.islandCount; i++) {
      const a = m.vertStart[i]!;
      const b = m.vertStart[i + 1]!;
      const trace = (grow: number): void => {
        g.beginPath();
        for (let k = a; k < b; k++) {
          const dx = m.verts[k * 2]! - m.islandX[i]!;
          const dy = m.verts[k * 2 + 1]! - m.islandY[i]!;
          const len = Math.hypot(dx, dy) || 1;
          const x = (m.verts[k * 2]! + (dx / len) * grow) * s;
          const y = (m.verts[k * 2 + 1]! + (dy / len) * grow) * s;
          if (k === a) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
      };
      g.fillStyle = 'rgba(120, 225, 230, 0.4)';
      trace(18);
      g.fill();
      g.fillStyle = '#e8d08a';
      trace(10);
      g.fill();
      g.fillStyle = '#5fa84a';
      trace(3);
      g.fill();
    }
    g.fillStyle = '#7b8189';
    for (let i = 0; i < m.reefCount; i++) {
      g.beginPath();
      g.arc(m.reefX[i]! * s, m.reefY[i]! * s, Math.max(1.5, m.reefR[i]! * s), 0, Math.PI * 2);
      g.fill();
    }

    // Island type markers.
    const mark = Math.max(3.5, px * 0.017);
    for (let i = 0; i < m.islandCount; i++) {
      const type = ISLAND_TYPES[m.islandType[i]!]!;
      const color = MARK[type]!.color;
      if (!color) continue;
      const x = m.islandX[i]! * s;
      const y = m.islandY[i]! * s;
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      if (type === 'port') g.arc(x, y, mark, 0, Math.PI * 2);
      else if (type === 'fort') g.rect(x - mark, y - mark, mark * 2, mark * 2);
      else {
        g.moveTo(x, y - mark * 1.3);
        g.lineTo(x + mark * 1.1, y);
        g.lineTo(x, y + mark * 1.3);
        g.lineTo(x - mark * 1.1, y);
        g.closePath();
      }
      g.fill();
      g.stroke();
    }

    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, px - 2, px - 2);

    // Scale bar: 500 world units.
    const bar = 500 * s;
    const bx = px * 0.05;
    const by = px - px * 0.045;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(bx, by - 4);
    g.lineTo(bx, by);
    g.lineTo(bx + bar, by);
    g.lineTo(bx + bar, by - 4);
    g.stroke();
    g.fillStyle = '#fff';
    g.font = `${Math.round(px * 0.04)}px system-ui, sans-serif`;
    g.textBaseline = 'bottom';
    g.fillText(`500 ${t('map.unit')}`, bx + bar + px * 0.02, by + 1);

    if (this.big) {
      // Legend.
      g.font = `${Math.round(px * 0.03)}px system-ui, sans-serif`;
      g.textBaseline = 'middle';
      let ly = px * 0.05;
      for (const type of ISLAND_TYPES) {
        const info = MARK[type]!;
        if (!info.color) continue;
        g.fillStyle = info.color;
        g.fillRect(px * 0.04, ly - 5, 10, 10);
        g.fillStyle = '#fff';
        g.fillText(t(info.label), px * 0.04 + 16, ly);
        ly += px * 0.045;
      }
    }
    return c;
  }

  /** Redraws the dynamic layer: ships and the camera's view area. */
  update(player: MapShip, others: readonly MapShip[], camera: PerspectiveCamera): void {
    const px = this.canvas.width;
    const g = this.ctx;
    const s = px / WORLD_SIZE;
    g.clearRect(0, 0, px, px);
    if (this.base) g.drawImage(this.base, 0, 0);

    // What the camera sees: the four screen corners projected onto the water.
    let ok = true;
    for (let i = 0; i < 4; i++) {
      this.ray.set(CORNERS[i * 2]!, CORNERS[i * 2 + 1]!, 0.5).unproject(camera);
      this.ray.sub(this.cam.copy(camera.position));
      if (this.ray.y > -1e-3) {
        // Looking above the horizon: clamp the far edge to a long distance.
        this.ray.y = -1e-3;
      }
      const k = Math.min(
        -camera.position.y / this.ray.y,
        2500 / (Math.hypot(this.ray.x, this.ray.z) || 1),
      );
      this.view[i * 2] = this.cam.x + this.ray.x * k;
      this.view[i * 2 + 1] = this.cam.z + this.ray.z * k;
      if (!Number.isFinite(this.view[i * 2]!)) ok = false;
    }
    if (ok) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(this.view[0]! * s, this.view[1]! * s);
      for (let i = 1; i < 4; i++) g.lineTo(this.view[i * 2]! * s, this.view[i * 2 + 1]! * s);
      g.closePath();
      g.stroke();
    }

    const r = Math.max(2.5, px * 0.011);
    g.fillStyle = '#ff4d5a';
    for (const o of others) {
      if (!o.alive) continue;
      g.beginPath();
      g.arc(o.x * s, o.y * s, r, 0, Math.PI * 2);
      g.fill();
    }
    // The player: a blue arrow pointing where the ship heads.
    g.save();
    g.translate(player.x * s, player.y * s);
    g.rotate(player.heading);
    g.fillStyle = '#3aa0ff';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(r * 2.2, 0);
    g.lineTo(-r * 1.4, r * 1.3);
    g.lineTo(-r * 0.6, 0);
    g.lineTo(-r * 1.4, -r * 1.3);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
