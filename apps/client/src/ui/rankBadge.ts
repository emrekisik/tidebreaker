import { RANKS } from '@tidebreaker/shared';

function clampRank(rank: number): number {
  return Math.max(0, Math.min(RANKS.count - 1, Math.floor(rank)));
}

/** The picture of the insignia of `rank` (0 = lowest): `public/ranks/<rank>.png`, drawn by hand. */
export function rankIconUrl(rank: number): string {
  return `${import.meta.env.BASE_URL}ranks/${clampRank(rank)}.png`;
}

/** Starts loading every insignia, so none of them pops in the first time a rank shows. */
export function preloadRankIcons(): void {
  for (let r = 0; r < RANKS.count; r++) new Image().src = rankIconUrl(r);
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
