/** Camera settings (GAME_DESIGN.md §12.3). Distance = baseDistance + perTier * tier. */
export const CAMERA = {
  pitchDeg: 58,
  fovDeg: 45,
  baseDistance: 70,
  perTier: 10,
  /** Exponential follow rate (1/s); higher = snappier. */
  followRate: 6,
  /** Mouse-wheel zoom: multiplies the camera distance. */
  zoomMin: 0.55,
  zoomMax: 1.8,
  zoomSpeed: 0.0012,
  zoomSmooth: 10,
  near: 1,
  far: 1200,
} as const;
