/**
 * Ranks (insignia shown left of a player's name; GAME_DESIGN.md §7.7). Everyone starts at rank 0. A rank is held
 * by the players of a team who (1) have reached its minimum score and (2) stand high enough in the team's
 * score order: only the best `quota[k]` of the team may hold rank `k` or higher, and the top rank only
 * `topSeats` players. So points open the way up, but how far a player really gets depends on the rest of the team.
 */
export const RANKS = {
  /** Number of ranks (0 = lowest). The icon of each is drawn in the client (ui/rankBadge.ts). */
  count: 17,
  /** Score needed for rank k (index 0 is the starting rank). */
  minScore: [0, 10, 20, 30, 45, 65, 90, 120, 160, 210, 270, 340, 430, 540, 680, 850, 1100],
  /**
   * Share of the team (rounded up, at least one player) that may hold rank k or higher. Index 0 is everybody.
   * The last entry is not used: the top rank has `topSeats` seats instead.
   */
  quota: [1, 0.95, 0.9, 0.85, 0.78, 0.7, 0.62, 0.54, 0.46, 0.4, 0.34, 0.28, 0.23, 0.18, 0.14, 0.1, 0],
  /** Players of one team that can hold the top rank. */
  topSeats: 1,
} as const;
