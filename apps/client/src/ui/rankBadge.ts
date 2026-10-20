import { RANKS } from '@tidebreaker/shared';

/**
 * Rank insignia, drawn in code (no image files) in a plain, easy-to-read style: no backing, just the symbol with a
 * dark outline so it shows on the sea.
 *   rank 0-7    silver chevrons: 1 to 8 stacked "V"s
 *   rank 8-11   a gold shield with 1 to 4 bars
 *   rank 12-15  a copper plaque with 1 to 4 stars
 *   rank 16     its own design: a big gold star in a laurel wreath (it also glows in the UI: `rank-top`)
 * The picture is square (48 x 48 units) and is shown about 20 px tall beside a name.
 */

const OUTLINE = '#0c1420';

function f(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function defs(): string {
  return (
    `<defs>` +
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#dfe5ec"/><stop offset="1" stop-color="#9aa5b3"/></linearGradient>` +
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a6"/><stop offset=".45" stop-color="#f6c63f"/><stop offset="1" stop-color="#b9801a"/></linearGradient>` +
    `<linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b48a"/><stop offset=".5" stop-color="#cf7c4c"/><stop offset="1" stop-color="#8a4a2a"/></linearGradient>` +
    `<radialGradient id="ruby" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffb3bd"/><stop offset=".4" stop-color="#ee1c36"/><stop offset="1" stop-color="#650212"/></radialGradient>` +
    `</defs>`
  );
}

/** A five-pointed star around (cx, cy). */
function star(cx: number, cy: number, r: number, fill: string, cls = 'st'): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.42;
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return `<polygon class="${cls}" points="${pts.join(' ')}" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.1" stroke-linejoin="round"/>`;
}

/** A downward chevron ("V") whose upper corners are at height `y`. */
function chevron(y: number): string {
  return (
    `<polygon class="ch" points="3,${f(y)} 24,${f(y + 8.5)} 45,${f(y)} 45,${f(y + 4)} 24,${f(y + 12.5)} 3,${f(y + 4)}" fill="url(#s)" stroke="${OUTLINE}" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<polyline points="5,${f(y + 1.1)} 24,${f(y + 9.4)} 43,${f(y + 1.1)}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".8"/>`
  );
}

function chevrons(n: number): string {
  const step = 4.8;
  const total = (n - 1) * step + 12.5;
  const top = (48 - total) / 2;
  const out: string[] = [];
  // The lowest chevron first, so each one tucks over the one below it.
  for (let i = n - 1; i >= 0; i--) out.push(chevron(top + i * step));
  return out.join('');
}

/** A shield with `n` bars cut into it. */
function shield(n: number): string {
  const out: string[] = [
    `<path d="M8 5H40V25Q40 37 24 44Q8 37 8 25Z" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>`,
    `<path d="M10.5 7.5H37.5V25Q37.5 35 24 41.5Q10.5 35 10.5 25Z" fill="none" stroke="#fff6c8" stroke-opacity=".7" stroke-width=".9"/>`,
  ];
  const w = 4;
  const gap = 3.4;
  const total = n * w + (n - 1) * gap;
  const x0 = 24 - total / 2;
  for (let i = 0; i < n; i++) {
    out.push(`<rect class="bar" x="${f(x0 + i * (w + gap))}" y="12" width="${w}" height="20" fill="#3b2a08" stroke="${OUTLINE}" stroke-width=".6"/>`);
  }
  return out.join('');
}

/** A copper plaque with `n` stars. */
function plaque(n: number): string {
  const spots: readonly (readonly (readonly [number, number, number])[])[] = [
    [],
    [[24, 24.5, 11.5]],
    [
      [15.5, 24.5, 8],
      [32.5, 24.5, 8],
    ],
    [
      [24, 15, 7.5],
      [15, 31.5, 7.5],
      [33, 31.5, 7.5],
    ],
    [
      [15.5, 15.5, 7],
      [32.5, 15.5, 7],
      [15.5, 32.5, 7],
      [32.5, 32.5, 7],
    ],
  ];
  const out: string[] = [
    `<rect x="5" y="5" width="38" height="38" rx="5" fill="url(#c)" stroke="${OUTLINE}" stroke-width="1.3"/>`,
    `<rect x="7.6" y="7.6" width="32.8" height="32.8" rx="3" fill="none" stroke="#ffe3c8" stroke-opacity=".6" stroke-width=".9"/>`,
  ];
  for (const [x, y, r] of spots[n]!) out.push(star(x, y, r, '#ffeaa6'));
  return out.join('');
}

/** One side of a laurel wreath around (24, 25): leaves up the left; the right is its mirror. */
function laurel(): string {
  const leaves: string[] = [];
  for (let i = 0; i < 7; i++) {
    const a = ((118 + i * 20) * Math.PI) / 180;
    const x = 24 + Math.cos(a) * 18.5;
    const y = 25 + Math.sin(a) * 18.5;
    const rot = (a * 180) / Math.PI + 90 + 28;
    leaves.push(`<ellipse cx="0" cy="-3.4" rx="1.9" ry="3.6" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" fill="url(#g)" stroke="${OUTLINE}" stroke-width=".7"/>`);
    leaves.push(`<ellipse cx="0" cy="-3" rx="1.6" ry="3.1" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot - 62)})" fill="url(#g)" stroke="${OUTLINE}" stroke-width=".7"/>`);
  }
  return leaves.join('');
}

/** The top rank: a big gold star in a laurel wreath, with a ruby below it. */
function topRank(): string {
  return (
    `<g class="laurel">${laurel()}<g transform="matrix(-1 0 0 1 48 0)">${laurel()}</g></g>` +
    star(24, 21, 15, 'url(#g)', 'st top') +
    `<polygon points="24,35 29,40 24,46 19,40" fill="url(#ruby)" stroke="${OUTLINE}" stroke-width="1" stroke-linejoin="round"/>` +
    `<polygon points="24,35 29,40 24,40" fill="#fff" opacity=".3"/>`
  );
}

/** The SVG text of the insignia of `rank` (0 = lowest). */
export function rankSvg(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  const body = r < 8 ? chevrons(r + 1) : r < 12 ? shield(r - 7) : r < 16 ? plaque(r - 11) : topRank();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${defs()}${body}</svg>`;
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
  img.className = rank >= RANKS.count - 1 ? 'rank-badge rank-top' : 'rank-badge';
  img.src = rankIconUrl(rank);
  img.alt = title;
  img.title = title;
  img.draggable = false;
  return img;
}
