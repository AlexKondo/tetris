import http from 'node:http';
import fs from 'node:fs';
import pg from 'pg';
import { validPlayerId, validateProgress, validateRun, parseLimit, maskId, plausibleRun, safeDecode, parseMode } from './validate.js';
import { createLimiter } from './limiter.js';

const MAX_BODY = 4096;

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const txt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = txt.match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* no .env */ }
  return 'postgresql://tetris:tetris@localhost:5442/tetris';
}

const ALLOWED = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',');

const ROW = (r) => ({
  playerId: r.player_id, level: r.level, bestScore: r.best_score, totalLines: r.total_lines,
  state: r.state, updatedAt: r.updated_at,
});

/** Build the HTTP server around a pg Pool (injectable for tests). */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createApp(pool, limiter = createLimiter({ max: 60, windowMs: 60_000 })) {
  // client ip; X-Forwarded-For is only honoured when the socket itself is loopback (our dev proxy)
  const clientIp = (req) => {
    const sock = req.socket.remoteAddress || 'unknown';
    const xff = LOOPBACK.has(sock) && req.headers['x-forwarded-for'];
    return xff ? String(xff).split(',')[0].trim() : sock;
  };

  function send(res, code, obj, origin) {
    const body = JSON.stringify(obj);
    const h = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin && ALLOWED.includes(origin)) {
      h['Access-Control-Allow-Origin'] = origin;
      h['Access-Control-Allow-Methods'] = 'GET,PUT,POST,OPTIONS';
      h['Access-Control-Allow-Headers'] = 'Content-Type';
      h['Access-Control-Max-Age'] = '600';
    }
    res.writeHead(code, h);
    res.end(body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0, dead = false; const chunks = [];
      req.on('data', (c) => {
        if (dead) return; // keep draining, ignore the rest
        size += c.length;
        if (size > MAX_BODY) { dead = true; chunks.length = 0; reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (dead) return;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
        catch (_) { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  /** Read-only: defaults when the player has no row yet (rows are created by PUT / POST /runs only). */
  async function getProgress(playerId, mode) {
    const r = await pool.query('SELECT * FROM player_progress WHERE player_id = $1', [playerId]);
    const base = r.rows.length ? ROW(r.rows[0]) : { playerId, level: 1, bestScore: 0, totalLines: 0, state: {}, updatedAt: null };
    if (mode) { // per-mode best score (runs without a mode count as cylinder)
      const b = await pool.query('SELECT COALESCE(MAX(score), 0)::int AS best FROM game_runs WHERE player_id = $1 AND COALESCE(mode, \'cylinder\') = $2', [playerId, mode]);
      base.bestScore = b.rows[0].best;
    }
    return base;
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    try {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      if (req.method === 'OPTIONS') { send(res, origin && !ALLOWED.includes(origin) ? 403 : 204, {}, origin); return; }
      if (origin && !ALLOWED.includes(origin)) { send(res, 403, { error: 'origin not allowed' }); return; }

      const rl = limiter.hit(clientIp(req));
      if (!rl.ok) {
        res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
        return send(res, 429, { error: 'too many requests' }, origin);
      }

      let m;
      if (req.method === 'GET' && path === '/api/health') {
        await pool.query('SELECT 1');
        return send(res, 200, { ok: true }, origin);
      }
      if ((m = path.match(/^\/api\/progress\/([^/]+)$/))) {
        const playerId = safeDecode(m[1]);
        if (playerId === null || !validPlayerId(playerId)) return send(res, 400, { error: 'invalid playerId' }, origin);
        if (req.method === 'GET') {
          const mode = parseMode(url.searchParams.get('mode'));
          if (mode === undefined) return send(res, 400, { error: 'invalid mode' }, origin);
          return send(res, 200, await getProgress(playerId, mode), origin);
        }
        if (req.method === 'PUT') {
          const v = validateProgress(await readJson(req));
          if (!v.ok) return send(res, 400, { error: v.error }, origin);
          const x = v.value;
          const r = await pool.query(
            `INSERT INTO player_progress (player_id, level, best_score, total_lines, state)
             VALUES ($1, COALESCE($2, 1), COALESCE($3, 0), COALESCE($4, 0), COALESCE($5::jsonb, '{}'::jsonb))
             ON CONFLICT (player_id) DO UPDATE SET
               level = GREATEST(player_progress.level, COALESCE($2, player_progress.level)),
               best_score = GREATEST(player_progress.best_score, COALESCE($3, player_progress.best_score)),
               total_lines = GREATEST(player_progress.total_lines, COALESCE($4, player_progress.total_lines)),
               state = COALESCE($5::jsonb, player_progress.state),
               updated_at = now()
             RETURNING *`,
            [playerId, x.level, x.bestScore, x.totalLines, x.state],
          );
          return send(res, 200, ROW(r.rows[0]), origin);
        }
        return send(res, 405, { error: 'method not allowed' }, origin);
      }
      if (path === '/api/runs' && req.method === 'POST') {
        const v = validateRun(await readJson(req));
        if (!v.ok) return send(res, 400, { error: v.error }, origin);
        const x = v.value;
        const pl = plausibleRun(x);
        if (!pl.ok) return send(res, 422, { error: pl.error }, origin);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('INSERT INTO player_progress (player_id) VALUES ($1) ON CONFLICT (player_id) DO NOTHING', [x.playerId]);
          await client.query('INSERT INTO game_runs (player_id, score, lines, level, duration_ms, mode) VALUES ($1,$2,$3,$4,$5,$6)', [x.playerId, x.score, x.lines, x.level, x.duration, x.mode]);
          const r = await client.query(
            `UPDATE player_progress SET
               best_score = GREATEST(best_score, $2),
               total_lines = total_lines + $3,
               level = GREATEST(level, $4),
               updated_at = now()
             WHERE player_id = $1 RETURNING *`,
            [x.playerId, x.score, x.lines, x.level],
          );
          await client.query('COMMIT');
          return send(res, 201, ROW(r.rows[0]), origin);
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally { client.release(); }
      }
      if (path === '/api/leaderboard' && req.method === 'GET') {
        const limit = parseLimit(url.searchParams.get('limit'));
        const mode = parseMode(url.searchParams.get('mode'));
        if (mode === undefined) return send(res, 400, { error: 'invalid mode' }, origin);
        const r = mode
          ? await pool.query('SELECT player_id, MAX(score)::int AS best_score, MAX(level)::int AS level FROM game_runs WHERE COALESCE(mode, \'cylinder\') = $1 GROUP BY player_id HAVING MAX(score) > 0 ORDER BY best_score DESC, MIN(created_at) ASC LIMIT $2', [mode, limit])
          : await pool.query('SELECT player_id, best_score, level FROM player_progress WHERE best_score > 0 ORDER BY best_score DESC, updated_at ASC LIMIT $1', [limit]);
        return send(res, 200, r.rows.map((x, i) => ({ rank: i + 1, player: maskId(x.player_id), bestScore: x.best_score, level: x.level })), origin);
      }
      send(res, 404, { error: 'not found' }, origin);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[api]', e.message);
      send(res, status, { error: status === 500 ? 'internal error' : e.message }, origin);
    }
  });
}

export function createPool() {
  return new pg.Pool({ connectionString: loadEnv(), max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const pool = createPool();
  pool.on('error', (e) => console.error('[pg]', e.message));
  const port = Number(process.env.PORT || 3001);
  createApp(pool).listen(port, '127.0.0.1', () => console.log(`API listening on http://127.0.0.1:${port}`));
}
