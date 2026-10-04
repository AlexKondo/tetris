// Fixed-window in-memory rate limiter (pure: time is injected, so it is unit-testable).
export function createLimiter({ max = 60, windowMs = 60_000, maxKeys = 10_000 } = {}) {
  const hits = new Map(); // key -> { start, count }
  return {
    /** Register one request for `key` at time `now` (ms). */
    hit(key, now = Date.now()) {
      let e = hits.get(key);
      if (!e || now - e.start >= windowMs) {
        if (hits.size >= maxKeys) { // prune expired entries, then hard-reset if still full
          for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
          if (hits.size >= maxKeys) hits.clear();
        }
        e = { start: now, count: 0 };
        hits.set(key, e);
      }
      e.count++;
      const ok = e.count <= max;
      return { ok, remaining: Math.max(0, max - e.count), retryAfterMs: ok ? 0 : e.start + windowMs - now };
    },
    get size() { return hits.size; },
  };
}
