/**
 * Ranks (insignia shown left of a player's name; GAME_DESIGN.md §7.7). Everyone starts at rank 0. A rank is held
 * by the players of a team who (1) have reached its minimum score and (2) stand high enough in the team's
 * score order: only the best `quota[k]` of the team may hold rank `k` or higher, and the top rank only
 * `topSeats` players. So points open the way up, but how far a player really gets depends on the rest of the team.
 */
export const RANKS = {
  /**
   * Number of ranks (0 = lowest). The picture of each is `apps/client/public/ranks/<k>.png` and its name is
   * `rank.name.<k>` in the client's language files: add all three when you add a rank.
   */
  count: 16,
  /** Score needed for rank k (index 0 is the starting rank). */
  minScore: [0, 10, 20, 35, 55, 80, 110, 145, 185, 235, 295, 365, 450, 570, 760, 1100],
  /**
   * Share of the team (rounded up, at least one player) that may hold rank k or higher. Index 0 is everybody.
   * The last entry is not used: the top rank has `topSeats` seats instead.
   */
  quota: [1, 0.95, 0.9, 0.85, 0.78, 0.7, 0.62, 0.54, 0.46, 0.4, 0.33, 0.26, 0.2, 0.15, 0.1, 0],
  /** Players of one team that can hold the top rank. */
  topSeats: 1,
} as const;
