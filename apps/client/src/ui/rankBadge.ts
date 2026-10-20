import { RANKS } from '@tidebreaker/shared';

/**
 * Rank insignia, drawn in code (no image files): a navy shield-shaped patch with metal stripes, stars and flowers.
 *   rank 0-3    silver diagonal stripes (1-4)
 *   rank 4-7    silver bar on top, an emblem and silver chevrons (1-4)
 *   rank 8-11   red bar, 1-4 silver flowers, emblem, a red arch and a red chevron
 *   rank 12-15  gold bar, 1-4 gold stars, emblem, a gold arch and two gold chevrons
 *   rank 16     gold bar, five stars, emblem, a gold arch and two gold chevrons (the one top seat of a team)
 * The patch is 60 x 80 units; shown about 20 px tall beside a name.
 */

type Metal = 'gold' | 'silver' | 'red';

const METAL_STOPS: Readonly<Record<Metal, readonly [string, string, string, string]>> = {
  gold: ['#fff3b0', '#f6c846', '#d9a024', '#9a6a12'],
  silver: ['#ffffff', '#dde3ea', '#aab3bf', '#78818e'],
  red: ['#ff9a90', '#f03a2e', '#c4170f', '#7d0b07'],
};

function f(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** A star with `points` points around (cx, cy). */
function star(cx: number, cy: number, r: number, points: number, inner: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? r : r * inner;
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width=".4"/>`;
}

/** A downward chevron band across the patch: ends at height `y`, point `depth` lower, `thick` thick. */
function vBand(x0: number, x1: number, y: number, depth: number, thick: number, fill: string): string {
  const mid = (x0 + x1) / 2;
  return (
    `<polygon points="${f(x0)},${f(y)} ${f(mid)},${f(y + depth)} ${f(x1)},${f(y)} ${f(x1)},${f(y + thick)} ${f(mid)},${f(y + depth + thick)} ${f(x0)},${f(y + thick)}" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".5" stroke-linejoin="round"/>` +
    `<polyline points="${f(x0)},${f(y + 0.5)} ${f(mid)},${f(y + depth + 0.5)} ${f(x1)},${f(y + 0.5)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6"/>`
  );
}

/** An arch (rocker) band: ends at height `y`, its middle `rise` higher. */
function arch(x0: number, x1: number, y: number, rise: number, thick: number, fill: string): string {
  const mid = (x0 + x1) / 2;
  return (
    `<path d="M${f(x0)} ${f(y)} Q${f(mid)} ${f(y - rise * 2)} ${f(x1)} ${f(y)} L${f(x1)} ${f(y + thick)} Q${f(mid)} ${f(y - rise * 2 + thick)} ${f(x0)} ${f(y + thick)}Z" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".5" stroke-linejoin="round"/>` +
    `<path d="M${f(x0)} ${f(y + 0.5)} Q${f(mid)} ${f(y - rise * 2 + 0.5)} ${f(x1)} ${f(y + 0.5)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6"/>`
  );
}

/** A diagonal stripe rising to the right, from (x0, y0) to (x1, y1). */
function stripe(x0: number, y0: number, x1: number, y1: number, thick: number, fill: string): string {
  const h = thick / 2;
  return (
    `<polygon points="${f(x0)},${f(y0 - h)} ${f(x1)},${f(y1 - h)} ${f(x1)},${f(y1 + h)} ${f(x0)},${f(y0 + h)}" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".5" stroke-linejoin="round"/>` +
    `<line x1="${f(x0)}" y1="${f(y0 - h + 0.5)}" x2="${f(x1)}" y2="${f(y1 - h + 0.5)}" stroke="rgba(255,255,255,.6)" stroke-width=".6"/>`
  );
}

/** A small winged anchor (the emblem) centered on (30, cy). */
function emblem(cy: number, fill: string): string {
  const wing = (s: number): string => {
    const x = (v: number): number => 30 + s * v;
    return `<path d="M${f(x(2))} ${f(cy - 2)} C${f(x(8))} ${f(cy - 7)} ${f(x(15))} ${f(cy - 7)} ${f(x(21))} ${f(cy - 2.5)} C${f(x(17))} ${f(cy - 3.2)} ${f(x(14))} ${f(cy - 2.4)} ${f(x(12))} ${f(cy - 0.6)} C${f(x(15))} ${f(cy - 0.6)} ${f(x(17))} ${f(cy + 0.2)} ${f(x(18.5))} ${f(cy + 1.6)} C${f(x(14))} ${f(cy + 1.2)} ${f(x(11))} ${f(cy + 2.2)} ${f(x(9))} ${f(cy + 4)} C${f(x(12))} ${f(cy + 4)} ${f(x(13.5))} ${f(cy + 4.8)} ${f(x(14.5))} ${f(cy + 5.8)} C${f(x(9))} ${f(cy + 5.6)} ${f(x(5))} ${f(cy + 4.2)} ${f(x(2))} ${f(cy + 1.5)}Z" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width=".4"/>`;
  };
  return (
    wing(1) +
    wing(-1) +
    // the anchor: ring, shank, stock and flukes
    `<g fill="none" stroke="${fill}" stroke-linecap="round" stroke-width="1.5">` +
    `<circle cx="30" cy="${f(cy - 4.4)}" r="1.5"/>` +
    `<line x1="30" y1="${f(cy - 2.9)}" x2="30" y2="${f(cy + 7)}"/>` +
    `<line x1="26.6" y1="${f(cy - 0.6)}" x2="33.4" y2="${f(cy - 0.6)}"/>` +
    `<path d="M24.6 ${f(cy + 3.4)} Q30 ${f(cy + 11)} 35.4 ${f(cy + 3.4)}"/>` +
    `</g>`
  );
}

function defs(metal: Metal): string {
  const [a, b, c, d] = METAL_STOPS[metal];
  return (
    `<defs>` +
    `<linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c3270"/><stop offset="1" stop-color="#0b1740"/></linearGradient>` +
    `<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".35" stop-color="${b}"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>` +
    `<linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#cfd6de"/><stop offset="1" stop-color="#8d96a3"/></linearGradient>` +
    `<pattern id="p" width="2.4" height="4" patternUnits="userSpaceOnUse"><rect width="1" height="4" fill="#fff" opacity=".07"/></pattern>` +
    `</defs>`
  );
}

const PATCH = 'M3 3H57V59Q57 61 55 62L31 77Q30 77.6 29 77L5 62Q3 61 3 59Z';

/** The SVG text of the insignia of `rank` (0 = lowest). */
export function rankSvg(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  const metal: Metal = r >= 12 ? 'gold' : r >= 8 ? 'red' : 'silver';
  const m = 'url(#m)';
  const body: string[] = [`<path d="${PATCH}" fill="url(#n)"/>`, `<path d="${PATCH}" fill="url(#p)"/>`];
  if (r < 4) {
    // Diagonal stripes, centered low on the patch.
    const n = r + 1;
    const base = 48 - (n - 1) * 4;
    for (let i = 0; i < n; i++) body.push(stripe(8, base + i * 8, 52, base + i * 8 - 13, 4.2, m));
  } else {
    const silverRow = r < 8;
    body.push(`<rect x="3" y="3" width="54" height="3.6" fill="${m}" stroke="rgba(0,0,0,.4)" stroke-width=".4"/>`);
    const emblemFill = silverRow || metal === 'red' ? 'url(#e)' : m;
    if (silverRow) {
      const n = r - 3;
      body.push(emblem(22, emblemFill));
      for (let i = 0; i < n; i++) body.push(vBand(5, 55, 36 + i * 6.2, 9, 4, m));
    } else if (metal === 'red') {
      const n = r - 7;
      for (let i = 0; i < n; i++) body.push(star(30 + (i - (n - 1) / 2) * 11, 14, 3.6, 8, 0.55, 'url(#e)'));
      body.push(emblem(28, emblemFill));
      body.push(arch(5, 55, 49, 6, 4.6, m));
      body.push(vBand(5, 55, 56, 7, 3.6, m));
      body.push(star(30, 54, 2.2, 8, 0.55, 'url(#e)'));
    } else {
      const n = r - 11;
      if (r === RANKS.count - 1) {
        for (let i = 0; i < 5; i++) body.push(star(30 + (i - 2) * 9.5, i === 2 ? 15 : 12, i === 2 ? 4.2 : 3.8, 5, 0.42, m));
      } else {
        for (let i = 0; i < n; i++) body.push(star(30 + (i - (n - 1) / 2) * 11, 13.5, 3.8, 5, 0.42, m));
      }
      body.push(emblem(28, emblemFill));
      body.push(arch(7, 53, 46, 5.5, 4.2, m));
      body.push(vBand(7, 53, 51.5, 6.5, 3.4, m));
      body.push(vBand(7, 53, 57, 6.5, 3.2, m));
      body.push(star(30, 52.5, 2.1, 5, 0.42, m));
    }
  }
  body.push(`<path d="${PATCH}" fill="none" stroke="#050a1f" stroke-width="1.4" stroke-linejoin="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">${defs(metal)}${body.join('')}</svg>`;
}

const urls: string[] = [];

/** A `data:` URL of the insignia of `rank` (made once). */
export function rankIconUrl(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  urls[r] ??= `data:image/svg+xml,${encodeURIComponent(rankSvg(r))}`;
  return urls[r]!;
}

/** An <img> of the insignia of `rank`, for the left of a name. `title`: the tooltip. */
export function rankBadge(rank: number, title: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'rank-badge';
  img.src = rankIconUrl(rank);
  img.alt = title;
  img.title = title;
  img.draggable = false;
  return img;
}
