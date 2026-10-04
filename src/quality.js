// Adaptive quality: pure state machine fed with frame times (ms).
export const LEVELS = 3; // 0 = full, 1 = reduced resolution, 2 = low (dpr 1, no shadows)

export function createMonitor({ windowMs = 3000, slowMs = 24, minFrames = 20, maxLevel = LEVELS - 1, level = 0 } = {}) {
  return { windowMs, slowMs, minFrames, maxLevel, level, elapsed: 0, frames: 0 };
}

/**
 * Feed one frame time. Returns the new level if it changed (degrade only), else null.
 * Degrades when the average frame time over a full window is > slowMs with enough frames sampled
 * (so a throttled 1 fps headless renderer does not trigger it).
 */
export function pushFrame(m, dtMs) {
  if (!(dtMs > 0) || dtMs > 1000) return null; // ignore pauses / hidden-tab gaps
  m.elapsed += dtMs; m.frames++;
  if (m.elapsed < m.windowMs) return null;
  const avg = m.elapsed / m.frames, enough = m.frames >= m.minFrames;
  m.elapsed = 0; m.frames = 0;
  if (enough && avg > m.slowMs && m.level < m.maxLevel) { m.level++; return m.level; }
  return null;
}

/** Settings for a quality level. */
export function settingsFor(level, devicePixelRatio = 1) {
  const dpr = Math.max(1, devicePixelRatio);
  return {
    dpr: level === 0 ? Math.min(dpr, 2) : level === 1 ? Math.min(dpr, 1.5) : 1,
    shadows: level < 2,
  };
}

export function levelFromParam(q) { return q === 'low' ? 2 : q === 'mid' ? 1 : 0; }
