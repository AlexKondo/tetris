import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor, pushFrame, settingsFor, levelFromParam } from '../src/quality.js';

const feed = (m, ms, n) => { let r = null; for (let i = 0; i < n; i++) { const x = pushFrame(m, ms); if (x !== null) r = x; } return r; };

test('smooth 60fps never degrades', () => { const m = createMonitor(); assert.equal(feed(m, 16.7, 1000), null); assert.equal(m.level, 0); });

test('sustained slow frames degrade one level per window, capped', () => {
  const m = createMonitor();
  assert.equal(feed(m, 40, 80), 1);        // 3.2s of 40ms frames
  assert.equal(feed(m, 40, 80), 2);
  assert.equal(feed(m, 40, 80), null);     // already at max
  assert.equal(m.level, 2);
});

test('a short hiccup does not degrade', () => {
  const m = createMonitor();
  feed(m, 16, 100); feed(m, 80, 3); feed(m, 16, 100);
  assert.equal(m.level, 0);
});

test('very low frame rate with too few samples (throttled headless) does not degrade; hidden gaps ignored', () => {
  const m = createMonitor();
  assert.equal(feed(m, 900, 10), null);
  assert.equal(pushFrame(m, 5000), null);
  assert.equal(m.level, 0);
});

test('settings per level', () => {
  assert.deepEqual(settingsFor(0, 3), { dpr: 2, shadows: true });
  assert.deepEqual(settingsFor(1, 3), { dpr: 1.5, shadows: true });
  assert.deepEqual(settingsFor(2, 3), { dpr: 1, shadows: false });
  assert.equal(settingsFor(0, 1).dpr, 1);
  assert.equal(levelFromParam('low'), 2); assert.equal(levelFromParam(null), 0);
});
