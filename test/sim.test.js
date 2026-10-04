import test from 'node:test';
import assert from 'node:assert/strict';
import { DebrisSim, ParticleSim } from '../src/fx/sim.js';

test('debris: ballistic motion, gravity, expiry', () => {
  const d = new DebrisSim(4);
  const i = d.spawn(0, 10, 0, 5, 8, 0, 0, 0, 0, 0, 0, 0, 1, 1.0);
  assert.equal(i, 0);
  d.step(0.1, -20);
  assert.ok(d.p[0] > 0.49 && d.p[0] < 0.51);       // x = 5*0.1
  assert.ok(Math.abs(d.v[1] - 6) < 1e-5);          // 8 - 20*0.1
  for (let k = 0; k < 12; k++) d.step(0.1, -20);
  assert.equal(d.count, 0);                        // expired after maxLife
});

test('debris: quaternion stays normalised under spin; scale fades to 0', () => {
  const d = new DebrisSim(2);
  d.spawn(0, 50, 0, 0, 0, 0, 3, 5, 2, 0, 0, 0, 1, 2.0);
  for (let k = 0; k < 100; k++) d.step(0.016);
  const l = Math.hypot(d.q[0], d.q[1], d.q[2], d.q[3]);
  assert.ok(Math.abs(l - 1) < 1e-4);
  assert.equal(d.scale(0) < 1 || d.alive[0] === 0, true);
  const e = new DebrisSim(1); e.spawn(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1.0);
  assert.equal(e.scale(0), 1);
  e.life[0] = 0.99; assert.ok(e.scale(0) < 0.1);
});

test('debris: pool cap, round robin, water entry reported', () => {
  const d = new DebrisSim(3);
  for (let k = 0; k < 3; k++) assert.ok(d.spawn(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 5) >= 0);
  assert.equal(d.spawn(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 5), -1); // full: no growth
  d.step(0.5, -30, 0.5);
  assert.equal(d.nHits, 3);
  assert.equal(d.count, 0);
  d.spawn(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 5);
  d.reset(); assert.equal(d.count, 0);
});

test('particles: hard cap by ring buffer, fade, expiry', () => {
  const s = new ParticleSim(5);
  for (let k = 0; k < 20; k++) s.emit(0, 5, 0, 1, 1, 0, 1, 0);
  assert.ok(s.count <= 5);
  assert.equal(s.fade(0), 1);
  s.step(0.5);
  assert.ok(s.fade(0) < 0.51 && s.fade(0) > 0.49);
  s.step(0.6);
  assert.equal(s.count, 0);
});

test('particles: die below water level', () => {
  const s = new ParticleSim(2);
  s.emit(0, 1, 0, 0, -50, 0, 5, 1);
  s.step(0.1, -18, 0);
  assert.equal(s.count, 0);
});
