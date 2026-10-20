import { RANKS } from '@tidebreaker/shared';

/**
 * Rank insignia in the style of DarkOrbit's ranks: small pixel-art pictures (21 x 21 pixels), drawn in code from
 * shapes and shaded by rules (no image files). A one-pixel dark outline keeps them readable on the sea. They are
 * shown with `image-rendering: pixelated` at 21 px (or a whole multiple of it).
 *   rank 0-2    1 to 3 narrow silver chevrons
 *   rank 3-7    1 to 5 wide silver chevrons
 *   rank 8-11   a gold shield with a silver tab: plain, with a band, with three columns, with three columns and a point
 *   rank 12-15  a bronze shield with 1, 2 or 3 stars, then one big star
 *   rank 16     its own design: the bronze shield with a gold rim, a laurel and a big star (it also glows in the UI: `rank-top`)
 */

/** Size of a picture in pixels. */
export const RANK_PIXELS = 21;
const N = RANK_PIXELS;
const MID = (N - 1) / 2;

/** What each letter in a picture means. `.` is empty. */
const PALETTE: Readonly<Record<string, string>> = {
  k: '#17110c',
  // silver
  w: '#ffffff',
  l: '#dfe4ea',
  m: '#aeb7c2',
  d: '#767f8d',
  // gold
  Y: '#fbf1a8',
  y: '#e1cc58',
  o: '#a98f28',
  O: '#6a5612',
  // bronze
  B: '#f2c19c',
  b: '#d08a5e',
  n: '#97583a',
  N: '#5f3322',
  // star
  S: '#fff0b0',
  s: '#f5cb4c',
  z: '#c78e1e',
};

type Grid = string[][];

function blank(): Grid {
  return Array.from({ length: N }, () => Array.from({ length: N }, () => '.'));
}

function put(g: Grid, x: number, y: number, c: string): void {
  if (x >= 0 && x < N && y >= 0 && y < N) g[y]![x] = c;
}

function has(g: Grid, x: number, y: number): boolean {
  return x >= 0 && x < N && y >= 0 && y < N && g[y]![x] !== '.';
}

/** A one-pixel dark outline around everything drawn so far. */
function outline(g: Grid): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (g[y]![x] !== '.') continue;
      if (has(g, x - 1, y) || has(g, x + 1, y) || has(g, x, y - 1) || has(g, x, y + 1)) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) put(g, x, y, 'k');
}

/** Distance (in pixels, 0 = on the edge) of each pixel of `mask` from the outside of the shape. */
function depthOf(mask: boolean[][]): number[][] {
  const d = mask.map((row) => row.map((v) => (v ? Infinity : -1)));
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (d[y]![x]! < 0) continue;
        let best = d[y]![x]!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          const n = nx < 0 || ny < 0 || nx >= N || ny >= N ? -1 : d[ny]![nx]!;
          best = Math.min(best, n < 0 ? 0 : n + 1);
        }
        if (best < d[y]![x]!) {
          d[y]![x] = best;
          changed = true;
        }
      }
    }
  }
  return d;
}

/** The mirror-symmetric pattern the metals are dithered with (so a picture stays symmetrical). */
const dither = (x: number, y: number): boolean => (Math.abs(x - MID) + y) % 2 === 0;

// ---------- chevrons

/** One chevron ("V" pointing down), `half` pixels to each side of the middle, `slope` rows of drop per pixel. */
function chevron(g: Grid, top: number, half: number, slope: number): void {
  for (let x = MID - half; x <= MID + half; x++) {
    const dx = Math.abs(x - MID);
    const y = top + Math.floor((half - dx) * slope + 0.001);
    // light on the top row, shade on the bottom one, both dithered
    put(g, x, y, dither(x, y) ? 'w' : 'l');
    put(g, x, y + 1, dither(x, y + 1) ? 'm' : 'd');
  }
}

function chevrons(n: number, wide: boolean): Grid {
  const g = blank();
  const half = wide ? 8 : 4;
  const slope = wide ? 0.5 : 1;
  const step = 3;
  const depth = Math.floor(half * slope + 0.001) + 1;
  const total = (n - 1) * step + depth + 2;
  const top = Math.round((N - total) / 2);
  // The lowest chevron first, so each one overlaps the one below.
  for (let i = n - 1; i >= 0; i--) chevron(g, top + i * step, half, slope);
  outline(g);
  return g;
}

// ---------- shields

/** Half widths of the shield rows 4..18 (the rows are centered on the middle column). */
const SHIELD_HALF = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 5, 4, 3];
const SHIELD_TOP = 4;

function shieldMask(): boolean[][] {
  const m = Array.from({ length: N }, () => Array.from({ length: N }, () => false));
  SHIELD_HALF.forEach((hw, i) => {
    for (let x = MID - hw; x <= MID + hw; x++) m[SHIELD_TOP + i]![x] = true;
  });
  return m;
}

function goldShield(kind: 0 | 1 | 2 | 3): Grid {
  const g = blank();
  const mask = shieldMask();
  const depth = depthOf(mask);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!mask[y]![x]) continue;
      const t = x - 3 + (y - SHIELD_TOP) * 0.75;
      const d = depth[y]![x]!;
      if (d === 0) put(g, x, y, t < 9 ? 'y' : 'o');
      else if (d === 1) put(g, x, y, dither(x, y) ? 'w' : 'Y');
      else put(g, x, y, t < 7 ? 'Y' : t < 14 ? 'y' : 'o');
    }
  }
  if (kind === 1) {
    for (let x = 5; x <= 15; x++) {
      put(g, x, 10, 'O');
      put(g, x, 11, 'Y');
      put(g, x, 12, 'y');
      put(g, x, 13, 'O');
    }
  } else if (kind >= 2) {
    // three columns, each lit on the left and shaded on the right, with dark gaps
    for (let i = 0; i < 3; i++) {
      const x0 = 5 + i * 4;
      for (let y = 10; y <= 17; y++) {
        put(g, x0, y, 'Y');
        put(g, x0 + 1, y, 'y');
        put(g, x0 + 2, y, 'o');
        if (i < 2) put(g, x0 + 3, y, 'O');
      }
      put(g, x0, 9, 'O');
      put(g, x0 + 1, 9, 'O');
      put(g, x0 + 2, 9, 'O');
    }
  }
  if (kind === 3) {
    // a silver point over the columns
    for (const [y, a, b] of [[6, 7, 13], [7, 8, 12], [8, 9, 11], [9, 10, 10]] as const) {
      for (let x = a; x <= b; x++) put(g, x, y, y === 6 ? (dither(x, y) ? 'w' : 'l') : y === 9 ? 'm' : dither(x, y) ? 'l' : 'm');
    }
  }
  // the silver tab on top
  for (const [y, a, b] of [[1, 5, 15], [2, 5, 15], [3, 6, 14], [4, 8, 12], [5, 9, 11]] as const) {
    for (let x = a; x <= b; x++) {
      const lit = y <= 1;
      put(g, x, y, lit ? (dither(x, y) ? 'w' : 'l') : y >= 4 ? (dither(x, y) ? 'm' : 'd') : dither(x, y) ? 'l' : 'm');
    }
  }
  outline(g);
  return g;
}

const BRONZE_HALF = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3];
const BRONZE_TOP = 3;

function bronzeMask(): boolean[][] {
  const m = Array.from({ length: N }, () => Array.from({ length: N }, () => false));
  BRONZE_HALF.forEach((hw, i) => {
    for (let x = MID - hw; x <= MID + hw; x++) m[BRONZE_TOP + i]![x] = true;
  });
  return m;
}

/** The pixels of a five-pointed star of radius `r` around (cx, cy), found by testing the middle of each pixel. */
function starPixels(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  const inside = (px: number, py: number): boolean => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const out: [number, number][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inside(x, y)) out.push([x, y]);
  return out;
}

/** A star with its own dark outline, lit from the top. */
function star(g: Grid, cx: number, cy: number, r: number): void {
  const px = starPixels(cx, cy, r);
  const set = new Set(px.map(([x, y]) => y * N + x));
  for (const [x, y] of px) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      if (!set.has((y + dy) * N + x + dx)) put(g, x + dx, y + dy, 'k');
    }
  }
  const lo = Math.min(...px.map(([, y]) => y));
  const hi = Math.max(...px.map(([, y]) => y));
  for (const [x, y] of px) {
    const t = (y - lo) / Math.max(1, hi - lo);
    put(g, x, y, t < 0.45 ? 'S' : t < 0.8 ? 's' : 'z');
  }
}

/** A small star, 5 x 5 pixels with its outline, its middle at (cx, cy). */
function smallStar(g: Grid, cx: number, cy: number, inside: boolean[][]): void {
  const rows = ['..#..', '.###.', '#####', '.###.', '.#.#.'];
  const px: [number, number][] = [];
  rows.forEach((row, j) => {
    for (let i = 0; i < 5; i++) if (row[i] === '#') px.push([cx - 2 + i, cy - 2 + j]);
  });
  const set = new Set(px.map(([x, y]) => y * N + x));
  for (const [x, y] of px) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      if (!set.has((y + dy) * N + x + dx) && inside[y + dy]?.[x + dx]) put(g, x + dx, y + dy, 'k');
    }
  }
  for (const [x, y] of px) put(g, x, y, y <= cy ? 'S' : y === cy + 1 ? 's' : 'z');
}

function bronzeShield(stars: 1 | 2 | 3 | 4, top = false): Grid {
  const g = blank();
  const mask = bronzeMask();
  const depth = depthOf(mask);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!mask[y]![x]) continue;
      const d = depth[y]![x]!;
      const shade = (y - BRONZE_TOP) / 15;
      if (d === 0) put(g, x, y, top ? (y < 11 ? 'Y' : 'y') : y < 9 || x < 7 ? 'n' : 'N');
      else if (d === 1) put(g, x, y, top ? (dither(x, y) ? 'y' : 'Y') : 'B');
      else {
        // brushed bronze: lighter at the top, with dashed streaks, darker toward the point
        const streak = y % 4 === 1 && (x + y * 3) % 5 !== 0;
        put(g, x, y, shade < 0.55 ? (streak ? 'B' : 'b') : shade < 0.75 ? (dither(x, y) ? 'b' : 'n') : 'n');
      }
    }
  }
  if (top) {
    // a laurel along each side
    const leaf: readonly (readonly [number, number])[] = [[4, 10], [5, 11], [4, 12], [5, 13], [5, 15], [6, 16], [7, 17], [4, 14]];
    for (const [x, y] of leaf) {
      for (const sx of [x, MID * 2 - x]) {
        put(g, sx + 1, y + 1, 'N');
        put(g, sx, y, 'S');
      }
    }
  }
  if (stars === 1) star(g, MID, 10.4, 5.4);
  else if (stars === 2) {
    smallStar(g, MID - 4, 10, mask);
    smallStar(g, MID + 4, 10, mask);
  } else if (stars === 3) {
    smallStar(g, MID, 7, mask);
    smallStar(g, MID - 4, 13, mask);
    smallStar(g, MID + 4, 13, mask);
  } else star(g, MID, 9.8, 6.1);
  outline(g);
  return g;
}

/** The picture of `rank` as rows of letters (see `PALETTE`; `.` is empty). */
export function rankPixels(rank: number): string[] {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  const g =
    r < 3
      ? chevrons(r + 1, false)
      : r < 8
        ? chevrons(r - 2, true)
        : r < 12
          ? goldShield((r - 8) as 0 | 1 | 2 | 3)
          : r < 16
            ? bronzeShield((r - 11) as 1 | 2 | 3 | 4)
            : bronzeShield(4, true);
  return g.map((row) => row.join(''));
}

const urls: string[] = [];

/** A `data:` URL (PNG) of the insignia of `rank`, drawn once. */
export function rankIconUrl(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  if (urls[r]) return urls[r]!;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    rankPixels(r).forEach((row, y) => {
      for (let x = 0; x < N; x++) {
        const colour = PALETTE[row[x]!];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      }
    });
  }
  urls[r] = canvas.toDataURL('image/png');
  return urls[r]!;
}

/** An <img> of the insignia of `rank`, for the left of a name. `title`: the tooltip. */
export function rankBadge(rank: number, title: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = rank >= RANKS.count - 1 ? 'rank-badge rank-top' : 'rank-badge';
  img.src = rankIconUrl(rank);
  img.alt = title;
  img.title = title;
  img.draggable = false;
  return img;
}

/** The colors of the letters, for tools that draw the pictures (the contact sheet). */
export const RANK_PALETTE = PALETTE;
