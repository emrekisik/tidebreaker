import { RANKS } from '@tidebreaker/shared';

/**
 * Rank insignia in the style of DarkOrbit's ranks, drawn in code (no image files). Each picture is square
 * (48 x 48 units) and is shown about 20 px tall beside a name; a thin dark outline keeps it readable on the sea.
 *   rank 0-2    1 to 3 narrow silver chevrons
 *   rank 3-7    1 to 5 wide silver chevrons
 *   rank 8-11   a gold shield with a silver tab: plain, with a band, with three columns, with three columns and a point
 *   rank 12-15  a bronze shield with 1, 2 or 3 stars, then one big star
 *   rank 16     its own design: a gold-framed shield with a big gold star in a laurel wreath (it also glows in the UI: `rank-top`)
 */

const OUTLINE = '#15100a';

function f(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function defs(): string {
  return (
    `<defs>` +
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#dde2e8"/><stop offset="1" stop-color="#8e98a5"/></linearGradient>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7ec9a"/><stop offset=".5" stop-color="#d9c653"/><stop offset="1" stop-color="#a18b2c"/></linearGradient>` +
    `<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6b0"/><stop offset="1" stop-color="#e2cd55"/></linearGradient>` +
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eebb94"/><stop offset=".55" stop-color="#cd8458"/><stop offset="1" stop-color="#8f5336"/></linearGradient>` +
    `<linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#f6cf4a"/><stop offset="1" stop-color="#c58d1c"/></linearGradient>` +
    `<clipPath id="gs"><path d="${GOLD_SHIELD}"/></clipPath>` +
    `<clipPath id="bs"><path d="${BRONZE_SHIELD}"/></clipPath>` +
    `</defs>`
  );
}

const GOLD_SHIELD = 'M8 8H40V28Q40 38 24 45Q8 38 8 28Z';
const BRONZE_SHIELD = 'M6 5H42V31Q42 40 24 45Q6 40 6 31Z';

/** A downward chevron ("V") whose upper corners are at height `y`. */
function chevron(cx: number, y: number, half: number, depth: number, thick: number): string {
  const x0 = cx - half;
  const x1 = cx + half;
  return (
    `<polygon class="ch" points="${f(x0)},${f(y)} ${f(cx)},${f(y + depth)} ${f(x1)},${f(y)} ${f(x1)},${f(y + thick)} ${f(cx)},${f(y + depth + thick)} ${f(x0)},${f(y + thick)}" fill="url(#s)" stroke="${OUTLINE}" stroke-width="1" stroke-linejoin="round"/>` +
    // the bright top edge, and a shaded lower edge
    `<polyline points="${f(x0 + 1.2)},${f(y + 0.9)} ${f(cx)},${f(y + depth + 0.9)} ${f(x1 - 1.2)},${f(y + 0.9)}" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>` +
    `<polyline points="${f(x0 + 1.2)},${f(y + thick - 0.7)} ${f(cx)},${f(y + depth + thick - 0.7)} ${f(x1 - 1.2)},${f(y + thick - 0.7)}" fill="none" stroke="#6f7a88" stroke-opacity=".7" stroke-width=".7" stroke-linecap="round"/>`
  );
}

/** `n` chevrons stacked tightly: the narrow kind (ranks 0-2) or the wide kind (ranks 3-7). */
function chevrons(n: number, wide: boolean): string {
  const half = wide ? 20 : 11.5;
  const depth = wide ? 9.5 : 7.5;
  const thick = wide ? 4.2 : 4.2;
  const step = wide ? 5.2 : 5.2;
  const total = (n - 1) * step + depth + thick;
  const top = (48 - total) / 2;
  const out: string[] = [];
  // The lowest chevron first, so each one tucks over the one below it.
  for (let i = n - 1; i >= 0; i--) out.push(chevron(24, top + i * step, half, depth, thick));
  return out.join('');
}

/** The silver tab on top of the gold shields. */
function tab(): string {
  return (
    `<polygon points="14.5,2.5 33.5,2.5 33.5,6.5 24,9.5 14.5,6.5" fill="url(#s)" stroke="${OUTLINE}" stroke-width="1" stroke-linejoin="round"/>` +
    `<line x1="16" y1="3.8" x2="32" y2="3.8" stroke="#fff" stroke-width=".8"/>`
  );
}

/** A gold shield (stitched edge, silver tab); `kind` is how it is marked. */
function goldShield(kind: 0 | 1 | 2 | 3): string {
  const out: string[] = [
    `<path d="${GOLD_SHIELD}" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>`,
    // a sheen over the upper left
    `<g clip-path="url(#gs)"><polygon points="8,8 28,8 8,30" fill="#fff" opacity=".28"/></g>`,
    `<path d="M10.2 10.2H37.8V28Q37.8 36 24 42.2Q10.2 36 10.2 28Z" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width=".9" stroke-dasharray="1.6 1.4"/>`,
  ];
  if (kind === 1) {
    // a band across the middle
    out.push(
      `<rect class="band" x="9" y="22" width="30" height="6.5" fill="url(#gl)" stroke="#8a7424" stroke-width=".9"/>`,
    );
  } else if (kind >= 2) {
    // three columns
    for (let i = 0; i < 3; i++) {
      const x = 13 + i * 8.4;
      out.push(`<rect class="col" x="${f(x)}" y="13" width="6" height="21" rx="1.2" fill="url(#gl)" stroke="#8a7424" stroke-width=".9"/>`);
    }
  }
  if (kind === 3) out.push(`<polygon class="tri" points="17,10 31,10 24,18" fill="url(#s)" stroke="${OUTLINE}" stroke-width=".9" stroke-linejoin="round"/>`);
  out.push(tab());
  return out.join('');
}

/** A five-pointed star around (cx, cy). */
function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.44;
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return `<polygon class="st" points="${pts.join(' ')}" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>`;
}

/** A bronze shield (with the grain of the metal) and its stars. */
function bronzeShield(stars: 1 | 2 | 3 | 4): string {
  const out: string[] = [`<path d="${BRONZE_SHIELD}" fill="url(#b)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>`];
  out.push('<g clip-path="url(#bs)" stroke="#fff" stroke-opacity=".16" stroke-width=".7">');
  for (let y = 9; y < 44; y += 3.6) out.push(`<line x1="5" y1="${f(y)}" x2="43" y2="${f(y + 0.8)}"/>`);
  out.push('</g>');
  out.push(`<path d="M8.4 7.4H39.6V31Q39.6 38 24 42.6Q8.4 38 8.4 31Z" fill="none" stroke="#ffe0c0" stroke-opacity=".5" stroke-width=".8"/>`);
  if (stars === 1) out.push(star(24, 24, 10, '#ffe9a0'));
  else if (stars === 2) out.push(star(15.5, 23.5, 8, '#ffe9a0'), star(32.5, 23.5, 8, '#ffe9a0'));
  else if (stars === 3) out.push(star(24, 14.5, 7.5, '#ffe9a0'), star(15, 30, 7.5, '#ffe9a0'), star(33, 30, 7.5, '#ffe9a0'));
  else out.push(star(24, 23.5, 16, 'url(#y)'));
  return out.join('');
}

/** One side of a laurel wreath around the star (leaves along the lower left; the right side is its mirror). */
function laurel(): string {
  const leaves: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((112 + i * 22) * Math.PI) / 180;
    const x = 24 + Math.cos(a) * 19.5;
    const y = 25 + Math.sin(a) * 19;
    const rot = (a * 180) / Math.PI + 90 + 30;
    leaves.push(`<ellipse cx="0" cy="-3" rx="1.7" ry="3.2" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" fill="url(#y)" stroke="${OUTLINE}" stroke-width=".7"/>`);
  }
  return leaves.join('');
}

/** The top rank: the bronze shield of the generals, framed in gold, with a big gold star and a laurel wreath. */
function topRank(): string {
  return (
    `<path d="${BRONZE_SHIELD}" fill="url(#b)" stroke="url(#y)" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="${BRONZE_SHIELD}" fill="none" stroke="${OUTLINE}" stroke-width=".7" stroke-linejoin="round"/>` +
    `<g class="laurel">${laurel()}<g transform="matrix(-1 0 0 1 48 0)">${laurel()}</g></g>` +
    star(24, 23, 15.5, 'url(#y)')
  );
}

/** The SVG text of the insignia of `rank` (0 = lowest). */
export function rankSvg(rank: number): string {
  const r = Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
  const body =
    r < 3
      ? chevrons(r + 1, false)
      : r < 8
        ? chevrons(r - 2, true)
        : r < 12
          ? goldShield((r - 8) as 0 | 1 | 2 | 3)
          : r < 16
            ? bronzeShield((r - 11) as 1 | 2 | 3 | 4)
            : topRank();
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
