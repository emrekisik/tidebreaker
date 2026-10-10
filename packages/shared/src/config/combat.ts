/** Damage recovery and disconnect rules (GAME_DESIGN.md §5.4, §11.4). */
export const COMBAT = {
  /** A ship that took no damage for this long starts recharging its shield. */
  shieldDelaySec: 4,
  /** Seconds a ship needs to recharge an empty shield. */
  shieldRechargeSec: 6,
  /** Carriers recharge too, but much more slowly: lasting pressure wins the round. */
  carrierShieldDelaySec: 10,
  carrierShieldRechargeSec: 60,
  /** A player who dropped out less than this many seconds after a hit (given or taken)... */
  combatLogSec: 10,
  /** ...leaves their ship in the water, drifting without control, for this many seconds. */
  combatLogDriftSec: 10,
} as const;
