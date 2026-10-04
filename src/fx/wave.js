// Pure helpers: when does each cleared tile burst? (Explosion wave ordering.)
export const ROW_OFFSET = 0.07;      // extra delay per additional cleared row (multi-clears roll through)
export const WAVE_BASE = 0.55;       // seconds for the wave to cross one row

/** Tiles burst in small groups (2-3 neighbours) so the wave reads as a sweep, not noise. */
export function groupSize(cols) { return Math.max(1, Math.round(cols / 22)); }

/** Total wave duration for n cleared rows. */
export function waveDuration(nRows, base = WAVE_BASE) { return base + ROW_OFFSET * Math.max(0, nRows - 1); }

/**
 * Burst delay (seconds after the wave starts) of the tile at `col`.
 *  - cylinder: counter-clockwise seen from above, starting at `startCol`. The tower places column c at
 *    (x, z) = (sin, cos)(c * 2pi/cols) with the camera on +z, so the angle grows from +z towards +x: that is
 *    counter-clockwise seen from above and moves to the RIGHT on the visible front face. The wave therefore
 *    walks UP in column index, wrapping around the ring;
 *  - wall: left to right.
 * rowRank is the 0-based rank of the tile's row among the rows cleared in this step.
 */
export function burstDelay({ wall, col, cols, startCol = 0, rowRank = 0, base = WAVE_BASE }) {
  const g = groupSize(cols), last = Math.max(1, Math.floor((cols - 1) / g));
  const pos = wall ? col : (((col - startCol) % cols) + cols) % cols;     // distance along the wave direction
  const frac = Math.min(1, Math.floor(pos / g) / last);
  return frac * base + rowRank * ROW_OFFSET;
}
