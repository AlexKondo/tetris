// Pure validation helpers. The server never trusts client numbers: everything is coerced and clamped.
import { MODES, SEED_ROWS } from '../src/config.js';
import { CHAIN_MAX } from '../src/game/game.js';

export const LIMITS = {
  level: [1, 999],
  score: [0, 100_000_000],
  lines: [0, 100_000],
  duration: [0, 86_400_000],
  stateBytes: 2048,
};

export const MODE_NAMES = Object.keys(MODES);
/** Mode name or null when absent; undefined when invalid. */
export function parseMode(m) { if (m === undefined || m === null || m === '') return null; return MODE_NAMES.includes(m) ? m : undefined; }

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validPlayerId(id) { return typeof id === 'string' && PLAYER_ID_RE.test(id); }

/** Coerce to an integer clamped to [lo, hi]. Returns null for non-numeric garbage. */
export function clampInt(v, lo, hi) {
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}

const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** Body of PUT /api/progress/:id. Returns { ok, value } or { ok:false, error }. */
export function validateProgress(body) {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  const out = {};
  const fields = [['level', 'level'], ['bestScore', 'score'], ['totalLines', 'lines']];
  for (const [key, lim] of fields) {
    if (body[key] === undefined) { out[key] = null; continue; }
    const n = clampInt(body[key], ...LIMITS[lim]);
    if (n === null) return { ok: false, error: `${key} must be a number` };
    out[key] = n;
  }
  if (body.state !== undefined) {
    if (!isPlainObject(body.state)) return { ok: false, error: 'state must be an object' };
    const json = JSON.stringify(body.state);
    if (json.length > LIMITS.stateBytes) return { ok: false, error: 'state too large' };
    out.state = json;
  } else out.state = null;
  if (out.level === null && out.bestScore === null && out.totalLines === null && out.state === null) {
    return { ok: false, error: 'nothing to update' };
  }
  return { ok: true, value: out };
}

/** Body of POST /api/runs. */
export function validateRun(body) {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  if (!validPlayerId(body.playerId)) return { ok: false, error: 'invalid playerId' };
  const score = clampInt(body.score, ...LIMITS.score);
  const lines = clampInt(body.lines === undefined ? 0 : body.lines, ...LIMITS.lines);
  const level = clampInt(body.level === undefined ? 1 : body.level, ...LIMITS.level);
  if (score === null || lines === null || level === null) return { ok: false, error: 'score, lines and level must be numbers' };
  let duration = null;
  if (body.durationMs !== undefined && body.durationMs !== null) {
    duration = clampInt(body.durationMs, ...LIMITS.duration);
    if (duration === null) return { ok: false, error: 'durationMs must be a number' };
  }
  const mode = parseMode(body.mode);
  if (mode === undefined) return { ok: false, error: 'invalid mode' };
  return { ok: true, value: { playerId: body.playerId, score, lines, level, duration, mode } };
}

export function parseLimit(v, def = 10, max = 50) {
  const n = clampInt(v === undefined || v === null ? def : v, 1, max);
  return n === null ? def : n;
}

/** Hide most of the anonymous id on public leaderboards. */
export function maskId(id) { return String(id).slice(0, 4) + '…'; }

/**
 * Plausibility rule for POST /api/runs (the client is never trusted, but the id is anonymous, so this
 * only stops obviously impossible numbers; it is NOT anti-cheat).
 *  - level can't exceed 1 + floor(lines / 10)           (the game levels up every 10 rings)
 *  - clear points   <= lines * 200 * level * CHAIN_MAX     (4 rows = 800*level is the best rate: 200 per row; chain reactions multiply later steps by up to CHAIN_MAX = 5)
 *  - drop points    <= pieces * 70, pieces <= 10 per second of play + 10   (soft 1/row, hard 2/row, <=35 rows)
 *  - lines          <= pieces * 4 / cols + SEED_ROWS + 2     (cells are conserved: the starting stack holds ~SEED_ROWS rows of cells and each piece adds 4;
 *                                                            cols = the smallest layout of the run's mode, from the shared game config)
 *  - a run shorter than 1 s can't score more than 500
 * A missing duration is treated as 0 s (so only tiny scores are accepted without one).
 */
export const PIECES_PER_SEC = 10;
export function plausibleRun({ score, lines, level, duration, mode }) {
  const cols = MODES[mode || 'cylinder'].minCols;
  const secs = (duration || 0) / 1000;
  if (level > 1 + Math.floor(lines / 10)) return { ok: false, error: 'level inconsistent with lines' };
  const pieces = secs * PIECES_PER_SEC + 10;
  if (lines > (pieces * 4) / cols + SEED_ROWS + 2) return { ok: false, error: 'too many lines for the duration' };
  if (duration !== null && duration < 1000 && score > 500) return { ok: false, error: 'score too high for the duration' };
  const maxScore = lines * 200 * level * CHAIN_MAX + pieces * 70;
  if (score > maxScore) return { ok: false, error: 'score implausible for lines/level/duration' };
  return { ok: true };
}

/** Safe decodeURIComponent: returns null on malformed percent-encoding. */
export function safeDecode(s) { try { return decodeURIComponent(s); } catch (_) { return null; } }
