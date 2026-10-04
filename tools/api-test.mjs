// Integration test against the live Postgres (docker compose up -d). Uses a throwaway player id and cleans up.
import { createApp, createPool } from '../server/index.js';
const pool = createPool();
const srv = createApp(pool);
await new Promise((r) => srv.listen(3199, '127.0.0.1', r));
const base = 'http://127.0.0.1:3199';
const id = 'apitest-' + Math.random().toString(36).slice(2, 12);
const ORIGIN = 'http://localhost:5173';
let fails = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + extra); if (!ok) fails++; };
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let j = null; try { j = await r.json(); } catch (_) { /* empty */ }
  return { s: r.status, j, h: r.headers };
};
try {
  let r = await call('GET', '/api/health'); check('health', r.s === 200);
  r = await call('GET', '/api/progress/' + id); check('GET returns defaults', r.s === 200 && r.j.level === 1 && r.j.bestScore === 0, JSON.stringify(r.j));
  const cnt0 = await pool.query('SELECT count(*)::int n FROM player_progress WHERE player_id = $1', [id]);
  check('GET is read-only (no row created)', cnt0.rows[0].n === 0);
  r = await call('GET', '/api/progress/%E0%A4%A'); check('malformed percent-encoding -> 400', r.s === 400, String(r.s));
  check('CORS header for dev origin', r.h.get('access-control-allow-origin') === ORIGIN);
  r = await call('GET', '/api/progress/' + id, undefined, { Origin: 'http://evil.example' }); check('foreign origin rejected', r.s === 403);
  r = await call('PUT', '/api/progress/' + id, { level: 4, bestScore: 1500, totalLines: 7, state: { theme: 'x' } }); check('PUT upsert', r.s === 200 && r.j.bestScore === 1500 && r.j.level === 4, JSON.stringify(r.j));
  r = await call('PUT', '/api/progress/' + id, { bestScore: 10 }); check('PUT cannot lower best score', r.s === 200 && r.j.bestScore === 1500);
  r = await call('PUT', '/api/progress/' + id, { bestScore: 1e18 }); check('PUT clamps huge value', r.s === 200 && r.j.bestScore === 100000000);
  r = await call('PUT', '/api/progress/' + id, { level: 'abc' }); check('PUT rejects garbage', r.s === 400);
  r = await call('PUT', '/api/progress/' + id, '{not json'); check('PUT rejects bad JSON', r.s === 400);
  r = await call('PUT', '/api/progress/' + id, { state: { x: 'y'.repeat(5000) } }); check('PUT rejects oversize body (413/400)', r.s === 413 || r.s === 400, String(r.s));
  r = await call('GET', "/api/progress/x'%3BDROP%20TABLE%20player_progress%3B--"); check('SQL-ish id rejected', r.s === 400);
  await call('PUT', '/api/progress/' + id, { bestScore: 100000000 }); // keep it from owning the leaderboard below
  await pool.query('UPDATE player_progress SET best_score = 1500 WHERE player_id = $1', [id]);
  r = await call('POST', '/api/runs', { playerId: id, score: 2500, lines: 5, level: 1, durationMs: 90000 });
  check('POST run updates progress atomically', r.s === 201 && r.j.bestScore === 2500 && r.j.totalLines === 12 && r.j.level === 4, JSON.stringify(r.j));
  const runs = await pool.query('SELECT count(*)::int AS n FROM game_runs WHERE player_id = $1', [id]);
  check('run row inserted', runs.rows[0].n === 1);
  r = await call('POST', '/api/runs', { playerId: id, score: 100, lines: 1, level: 1 });
  check('lower run does not reduce best', r.j.bestScore === 2500 && r.j.totalLines === 13);
  r = await call('POST', '/api/runs', { playerId: id, score: 90000000, lines: 1, level: 1, durationMs: 60000 }); check('implausible score rejected (422)', r.s === 422, String(r.s));
  r = await call('POST', '/api/runs', { playerId: id, score: 5000, lines: 1, level: 1, durationMs: 500 }); check('score in <1s rejected (422)', r.s === 422);
  r = await call('POST', '/api/runs', { playerId: id, score: 100, lines: 1, level: 9, durationMs: 60000 }); check('level inconsistent with lines rejected (422)', r.s === 422);
  r = await call('POST', '/api/runs', { playerId: id, score: 1800, lines: 0, level: 1, durationMs: 20000 }); check('hard-drop heavy legit run accepted', r.s === 201, String(r.s));
  r = await call('POST', '/api/runs', { playerId: id, score: 'lots' }); check('POST rejects garbage', r.s === 400);
  r = await call('POST', '/api/runs', { playerId: 'bad id', score: 5 }); check('POST rejects bad id', r.s === 400);
  r = await call('GET', '/api/leaderboard?limit=3');
  check('leaderboard shape, limit, masked ids', r.s === 200 && Array.isArray(r.j) && r.j.length <= 3 && r.j.every((x) => !x.player.includes(id.slice(4))), JSON.stringify(r.j));
  r = await call('POST', '/api/runs', { playerId: id, mode: 'wall', score: 700, lines: 3, level: 1, durationMs: 60000 }); check('wall run accepted', r.s === 201, String(r.s));
  r = await call('POST', '/api/runs', { playerId: id, mode: 'sphere', score: 1, lines: 0, level: 1, durationMs: 60000 }); check('invalid mode rejected (400)', r.s === 400, String(r.s));
  const mrow = await pool.query('SELECT mode FROM game_runs WHERE player_id = $1 AND score = 700', [id]); check('mode stored', mrow.rows[0] && mrow.rows[0].mode === 'wall');
  r = await call('GET', '/api/progress/' + id + '?mode=wall'); check('per-mode best (wall = 700)', r.s === 200 && r.j.bestScore === 700, JSON.stringify(r.j.bestScore));
  r = await call('GET', '/api/progress/' + id + '?mode=cylinder'); check('per-mode best (cylinder = 2500)', r.j.bestScore === 2500, JSON.stringify(r.j.bestScore));
  r = await call('GET', '/api/progress/' + id + '?mode=zzz'); check('progress invalid mode -> 400', r.s === 400);
  r = await call('GET', '/api/leaderboard?mode=wall&limit=5'); check('leaderboard filtered by wall', r.s === 200 && r.j.length >= 1 && r.j.every((x) => x.bestScore > 0), JSON.stringify(r.j));
  r = await call('GET', '/api/leaderboard?mode=nope'); check('leaderboard invalid mode -> 400', r.s === 400);
  r = await call('GET', '/api/nope'); check('404', r.s === 404);
  let got429 = false;
  for (let i = 0; i < 70; i++) { const x = await call('GET', '/api/health'); if (x.s === 429) { got429 = true; check('429 has Retry-After', !!x.h.get('retry-after')); break; } }
  check('rate limit kicks in (429)', got429);
} finally {
  await pool.query('DELETE FROM player_progress WHERE player_id = $1', [id]);
  const left = await pool.query('SELECT (SELECT count(*) FROM player_progress WHERE player_id=$1)::int AS p, (SELECT count(*) FROM game_runs WHERE player_id=$1)::int AS g', [id]);
  check('cleanup (no rows left)', left.rows[0].p === 0 && left.rows[0].g === 0);
  srv.close(); await pool.end();
}
console.log(fails ? `${fails} FAILED` : 'API integration: all ok');
process.exit(fails ? 1 : 0);
