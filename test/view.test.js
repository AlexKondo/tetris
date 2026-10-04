import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPitch, clampZoom, stepPitch, stepZoom, sanitizeView, loadView, saveView, PITCH_STEP, clampPan, stepPan, PAN_STEP } from '../src/view.js';
import { CAMERA, COLS } from '../src/config.js';

test('pitch/zoom clamp to the configured ranges', () => {
  assert.equal(clampPitch(-10), CAMERA.pitchMin);
  assert.equal(clampPitch(99), CAMERA.pitchMax);
  assert.equal(clampPitch(NaN), CAMERA.pitchDeg);
  assert.equal(clampZoom(0.1), CAMERA.zoomMin);
  assert.equal(clampZoom(9), CAMERA.zoomMax);
  assert.equal(clampZoom(undefined), 1);
});

test('steps move in the right direction and saturate', () => {
  assert.equal(stepPitch(20, 1), 20 + PITCH_STEP);
  assert.equal(stepPitch(20, -1), 20 - PITCH_STEP);
  let p = 20; for (let i = 0; i < 50; i++) p = stepPitch(p, 1);
  assert.equal(p, CAMERA.pitchMax);
  let z = 1; for (let i = 0; i < 50; i++) z = stepZoom(z, 1);
  assert.equal(z, CAMERA.zoomMin);
  for (let i = 0; i < 50; i++) z = stepZoom(z, -1);
  assert.equal(z, CAMERA.zoomMax);
});

test('persistence: round trip, garbage and missing storage are safe', () => {
  const mem = new Map();
  const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  saveView({ pitch: 33, zoom: 1.3 }, st);
  assert.deepEqual(loadView(st), { pitch: 33, zoom: 1.3, pan: 0 });
  saveView({ pitch: 33, zoom: 1.3, pan: 0.2 }, st);
  assert.deepEqual(loadView(st), { pitch: 33, zoom: 1.3, pan: 0.2 });
  mem.set('mahjong-tower-view', '{"pitch":"x","zoom":1e9}');
  assert.deepEqual(loadView(st), { pitch: CAMERA.pitchDeg, zoom: CAMERA.zoomMax, pan: 0 });
  mem.set('mahjong-tower-view', 'not json');
  assert.deepEqual(loadView(st), sanitizeView(null));
  assert.deepEqual(loadView(null), sanitizeView(null));
  assert.doesNotThrow(() => saveView({ pitch: 1, zoom: 1 }, null));
});

test('63 columns by default, default pitch lowered', () => {
  assert.equal(COLS, 63);
  assert.equal(CAMERA.pitchDeg, 18);
});

test('pan: clamped to +-35% of the viewport, stepped, sanitised', () => {
  assert.equal(clampPan(9), 0.35); assert.equal(clampPan(-9), -0.35); assert.equal(clampPan(NaN), 0); assert.equal(clampPan(undefined), 0);
  assert.equal(stepPan(0, 1), PAN_STEP); assert.equal(stepPan(0, -1), -PAN_STEP);
  let p = 0; for (let i = 0; i < 40; i++) p = stepPan(p, 1);
  assert.equal(p, 0.35);
  assert.equal(sanitizeView({ pitch: 20, zoom: 1, pan: 5 }).pan, 0.35);
  assert.equal(sanitizeView({ pitch: 20, zoom: 1, pan: 'x' }).pan, 0);
});
