import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import {
  ISLAND_TYPES,
  MAP,
  RIG,
  RIGS,
  RIG_NO_OWNER,
  TEAM_BLUE,
  TEAM_PIRATE,
  WORLD_SIZE,
} from '@tidebreaker/shared';
import type { Combatant, RigState, WorldMap } from '@tidebreaker/shared';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';

const SMALL = 220;
/** The small radar shows this many world units in every direction around the player. */
const RADAR_RANGE = 280;
/** Grid line spacing on the radar (world units). */
const RADAR_GRID = 100;
/** Colors of the radar: ships are crosses, carriers a small carrier icon. */
const RADAR_BLUE = '#4fe3ff';
const RADAR_RED = '#ff5fa8';
const RADAR_PIRATE = '#ffb347';
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const BIG = 600;

/** Marker color of each island type (also used by the legend). */
const MARK: Record<string, { color: string; label: MessageKey }> = {
  port: { color: '', label: 'map.port' },
  fort: { color: '', label: 'map.fort' },
  treasure: { color: '', label: 'map.treasure' },
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
  /** The carriers' icons (a top-down view, bow to the right), per team. */
  private readonly carrierIcons: HTMLImageElement[] = [];

  constructor(container: HTMLElement, map: WorldMap) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    // Radar rings and a slow sweep over the map (pure CSS, see theme.css).
    const radar = document.createElement('div');
    radar.className = 'radar';
    container.appendChild(radar);
    this.ctx = this.canvas.getContext('2d')!;
    for (const team of ['blue', 'red']) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}icons/ships/side/${team}/aircraft_carrier.png`;
      this.carrierIcons.push(img);
    }
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
    // (Only the full map has a pre-drawn layer; the radar is drawn around the player each frame.)
    this.base = this.big ? this.drawBase(px) : null;
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
    for (let i = RIG.count; i < m.reefCount; i++) {
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
      g.fillStyle = '#1b2026';
      g.fillRect(px * 0.04, ly - 5, 10, 10);
      g.strokeStyle = '#fff';
      g.strokeRect(px * 0.04, ly - 5, 10, 10);
      g.fillStyle = '#fff';
      g.fillText(t('map.rig'), px * 0.04 + 16, ly);
      ly += px * 0.045;
      g.fillStyle = '#ffb347';
      g.beginPath();
      g.arc(px * 0.04 + 5, ly, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(t('map.pirate'), px * 0.04 + 16, ly);
    }
    return c;
  }

  /**
   * The radar: the area around the player (not the whole world). Islands are dim teal shapes on a
   * grid, ships are crosses (blue and red teams, amber pirates), the carriers small icons that
   * stick to the edge when they are out of range, and the player a white arrow in the middle.
   */
  private updateRadar(
    player: MapShip,
    others: readonly Combatant[],
    rigs: readonly RigState[] | null,
  ): void {
    const px = this.canvas.width;
    const g = this.ctx;
    const u = px / SMALL;
    const k = px / (2 * RADAR_RANGE);
    const mid = px / 2;
    const m = this.map;
    const sx = (wx: number): number => (wx - player.x) * k + mid;
    const sy = (wy: number): number => (wy - player.y) * k + mid;

    g.clearRect(0, 0, px, px);
    const bg = g.createRadialGradient(mid, mid, 0, mid, mid, mid * 1.3);
    bg.addColorStop(0, '#0e3440');
    bg.addColorStop(1, '#071a22');
    g.fillStyle = bg;
    g.fillRect(0, 0, px, px);

    // Grid, fixed to the world so it slides under the player.
    g.strokeStyle = 'rgba(120, 235, 245, 0.08)';
    g.lineWidth = u;
    g.beginPath();
    for (
      let gx = Math.ceil((player.x - RADAR_RANGE) / RADAR_GRID) * RADAR_GRID;
      ;
      gx += RADAR_GRID
    ) {
      if (gx > player.x + RADAR_RANGE) break;
      g.moveTo(sx(gx), 0);
      g.lineTo(sx(gx), px);
    }
    for (
      let gy = Math.ceil((player.y - RADAR_RANGE) / RADAR_GRID) * RADAR_GRID;
      ;
      gy += RADAR_GRID
    ) {
      if (gy > player.y + RADAR_RANGE) break;
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
      const reach = RADAR_RANGE * 1.42 + m.islandR[i]!;
      if (
        Math.abs(m.islandX[i]! - player.x) > reach ||
        Math.abs(m.islandY[i]! - player.y) > reach
      ) {
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
      g.arc(x, y, Math.max(1.5 * u, m.reefR[i]! * k), 0, Math.PI * 2);
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
        g.strokeStyle = st.meter > 0 ? RADAR_BLUE : RADAR_RED;
        g.beginPath();
        g.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + Math.abs(st.meter) * Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#0a1c24';
      g.strokeStyle = '#fff';
      g.lineWidth = u;
      g.fillRect(x - 3 * u, y - 3 * u, 6 * u, 6 * u);
      g.strokeRect(x - 3 * u, y - 3 * u, 6 * u, 6 * u);
    }

    // Ships: crosses. Carriers: an icon (clamped to the edge when out of range).
    const arm = 3.6 * u;
    const edge = 14 * u;
    for (const o of others) {
      const st = o.state;
      if (!st.alive) continue;
      const x = sx(st.x);
      const y = sy(st.y);
      if (o.def.vMax === 0) {
        const icon = this.carrierIcons[o.team === TEAM_BLUE ? 0 : 1]!;
        if (!icon.complete || icon.naturalWidth === 0) continue;
        const inside = x > edge && y > edge && x < px - edge && y < px - edge;
        // Out of range: slide along the line to the carrier until the icon touches the edge.
        let ix = x;
        let iy = y;
        if (!inside) {
          const d = Math.max(Math.abs(x - mid), Math.abs(y - mid)) || 1;
          const f = (mid - edge) / d;
          ix = mid + (x - mid) * f;
          iy = mid + (y - mid) * f;
        }
        const w = (inside ? 30 : 22) * u;
        g.save();
        g.globalAlpha = inside ? 1 : 0.75;
        g.translate(ix, iy);
        if (inside) g.rotate(st.heading);
        g.drawImage(icon, -w / 2, -w / 4, w, w / 2);
        g.restore();
        continue;
      }
      if (x < 0 || y < 0 || x > px || y > px) continue;
      g.strokeStyle =
        o.team === TEAM_BLUE ? RADAR_BLUE : o.team === TEAM_PIRATE ? RADAR_PIRATE : RADAR_RED;
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
    g.translate(mid, mid);
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
  }

  /** Redraws the dynamic layer: ships and the camera's view area. */
  update(
    player: MapShip,
    others: readonly Combatant[],
    camera: PerspectiveCamera,
    rigs: readonly RigState[] | null = null,
  ): void {
    if (!this.big) {
      this.updateRadar(player, others, rigs);
      return;
    }
    const px = this.canvas.width;
    const g = this.ctx;
    const s = px / WORLD_SIZE;
    g.clearRect(0, 0, px, px);
    if (this.base) g.drawImage(this.base, 0, 0);

    // Oil rigs: the capture circle in the owner's color, the gauge around it, and a derrick mark.
    for (let i = 0; i < RIGS.length; i++) {
      const rig = RIGS[i]!;
      const st = rigs?.[i];
      const cx = rig.x * s;
      const cy = rig.y * s;
      const rr = RIG.captureRadius * s;
      const owner = st?.owner ?? RIG_NO_OWNER;
      g.fillStyle =
        owner === RIG_NO_OWNER
          ? 'rgba(255,255,255,0.12)'
          : owner === TEAM_BLUE
            ? 'rgba(74,168,255,0.35)'
            : 'rgba(255,77,90,0.35)';
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = Math.max(2, px * 0.007);
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
      if (st && Math.abs(st.meter) > 0.005) {
        g.strokeStyle = st.meter > 0 ? '#4aa8ff' : '#ff4d5a';
        g.beginPath();
        g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.abs(st.meter) * Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#1b2026';
      g.strokeStyle = '#fff';
      g.lineWidth = 1;
      const h = Math.max(2.5, px * 0.012);
      g.fillRect(cx - h, cy - h, h * 2, h * 2);
      g.strokeRect(cx - h, cy - h, h * 2, h * 2);
    }

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
    for (const o of others) {
      const st = o.state;
      if (!st.alive) continue;
      g.fillStyle =
        o.team === TEAM_BLUE ? '#4aa8ff' : o.team === TEAM_PIRATE ? '#ffb347' : '#ff4d5a';
      if (o.def.vMax === 0) {
        // A carrier: its hull seen from above, in its team color, with a white outline.
        g.save();
        g.translate(st.x * s, st.y * s);
        g.rotate(st.heading);
        const len = o.def.length * s;
        g.fillRect(-len / 2, -len * 0.18, len, len * 0.36);
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.strokeRect(-len / 2, -len * 0.18, len, len * 0.36);
        g.restore();
        continue;
      }
      g.beginPath();
      g.arc(st.x * s, st.y * s, o.team === TEAM_PIRATE ? r * 0.8 : r, 0, Math.PI * 2);
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
