import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMode, validPlayerId, clampInt, validateProgress, validateRun, parseLimit, maskId, LIMITS } from '../server/validate.js';

test('player id format', () => {
  assert.ok(validPlayerId('3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab'));
  for (const bad of ['', 'short', 'a b c d e f g h', "x'; DROP TABLE player_progress;--", 'é'.repeat(10), 123, null, 'a'.repeat(65)]) assert.equal(validPlayerId(bad), false, String(bad));
});

test('clampInt coerces, clamps, rejects garbage', () => {
  assert.equal(clampInt(5.9, 0, 10), 5);
  assert.equal(clampInt('7', 0, 10), 7);
  assert.equal(clampInt(-5, 0, 10), 0);
  assert.equal(clampInt(1e12, 0, 10), 10);
  for (const bad of [NaN, Infinity, 'abc', '', null, undefined, {}, [], '1e3x']) assert.equal(clampInt(bad, 0, 10), null);
});

test('validateProgress clamps and rejects', () => {
  const ok = validateProgress({ level: 3, bestScore: 1e15, totalLines: -4, state: { a: 1 } });
  assert.ok(ok.ok);
  assert.equal(ok.value.bestScore, LIMITS.score[1]);
  assert.equal(ok.value.totalLines, 0);
  assert.equal(ok.value.state, '{"a":1}');
  assert.equal(validateProgress({ level: 'x' }).ok, false);
  assert.equal(validateProgress(null).ok, false);
  assert.equal(validateProgress([]).ok, false);
  assert.equal(validateProgress({}).ok, false);
  assert.equal(validateProgress({ state: 'str' }).ok, false);
  assert.equal(validateProgress({ state: { big: 'x'.repeat(5000) } }).ok, false);
});

test('validateRun requires id + score, defaults and clamps the rest', () => {
  const id = 'abcdefgh-1234';
  const r = validateRun({ playerId: id, score: 1234.7, lines: 12, level: 0 });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { playerId: id, score: 1234, lines: 12, level: 1, duration: null, mode: null });
  assert.equal(validateRun({ playerId: 'bad', score: 1 }).ok, false);
  assert.equal(validateRun({ playerId: id }).ok, false);
  assert.equal(validateRun({ playerId: id, score: 'NaN' }).ok, false);
  assert.equal(validateRun({ playerId: id, score: 1, durationMs: 'x' }).ok, false);
  assert.equal(validateRun({ playerId: id, score: 1, durationMs: 9e12 }).value.duration, LIMITS.duration[1]);
});

test('mode validation and per-mode plausibility', () => {
  const id = 'abcdefgh-1234';
  assert.equal(validateRun({ playerId: id, score: 1, mode: 'wall' }).value.mode, 'wall');
  assert.equal(validateRun({ playerId: id, score: 1 }).value.mode, null);
  assert.equal(validateRun({ playerId: id, score: 1, mode: 'sphere' }).ok, false);
  assert.equal(parseMode('cylinder'), 'cylinder'); assert.equal(parseMode(undefined), null); assert.equal(parseMode('x'), undefined);
  // 40 lines in 20 s is fine on the 12-wide wall but not on the 36-wide cylinder
  const run = { score: 1500, lines: 40, level: 2, duration: 20000 };
  assert.equal(plausibleRun({ ...run, mode: 'wall' }).ok, true);
  assert.equal(plausibleRun({ ...run, mode: 'cylinder' }).ok, false);
});

test('legit big chain run is accepted (multipliers x1, x1.5, x2 on three 4-row clears)', () => {
  const score = 800 + 1200 + 1600 + 300;      // + some drop points
  assert.equal(plausibleRun({ score, lines: 12, level: 2, duration: 90000, mode: 'cylinder' }).ok, true);
  assert.equal(plausibleRun({ score: 4 * 800 * 5 * 3, lines: 12, level: 2, duration: 90000, mode: 'wall' }).ok, true);
  assert.equal(plausibleRun({ score: 12 * 200 * 2 * 5 + 5000000, lines: 12, level: 2, duration: 90000 }).ok, false);
});

test('parseLimit and maskId', () => {
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit('500'), 50);
  assert.equal(parseLimit('0'), 1);
  assert.equal(parseLimit('abc'), 10);
  assert.equal(maskId('abcdefghijkl').includes('efgh'), false);
});

import { plausibleRun } from '../server/validate.js';
import { createLimiter } from '../server/limiter.js';

test('plausibleRun accepts legit runs and rejects impossible ones', () => {
  assert.ok(plausibleRun({ score: 2500, lines: 5, level: 1, duration: 90000 }).ok);
  assert.ok(plausibleRun({ score: 1800, lines: 0, level: 1, duration: 20000 }).ok);       // hard-drop heavy, no clears
  assert.ok(plausibleRun({ score: 800 * 3 + 600, lines: 12, level: 2, duration: 120000 }).ok);
  assert.ok(plausibleRun({ score: 0, lines: 0, level: 1, duration: null }).ok);
  assert.equal(plausibleRun({ score: 90_000_000, lines: 1, level: 1, duration: 60000 }).ok, false);
  assert.equal(plausibleRun({ score: 5000, lines: 1, level: 1, duration: 500 }).ok, false);
  assert.equal(plausibleRun({ score: 100, lines: 1, level: 9, duration: 60000 }).ok, false);   // level vs lines
  assert.equal(plausibleRun({ score: 100, lines: 500, level: 1, duration: 5000 }).ok, false);  // too many lines for 5 s
  assert.equal(plausibleRun({ score: 9999, lines: 0, level: 1, duration: null }).ok, false);
});

test('rate limiter: window, per-key, reset, pruning', () => {
  const l = createLimiter({ max: 3, windowMs: 1000, maxKeys: 4 });
  assert.ok(l.hit('a', 0).ok && l.hit('a', 1).ok && l.hit('a', 2).ok);
  const r = l.hit('a', 3);
  assert.equal(r.ok, false);
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 1000);
  assert.ok(l.hit('b', 3).ok);                 // other key unaffected
  assert.ok(l.hit('a', 1001).ok);              // new window
  for (const k of ['c', 'd', 'e', 'f', 'g']) l.hit(k, 1002);
  assert.ok(l.size <= 4);                       // bounded memory
});
