import test from 'node:test';
import assert from 'node:assert/strict';
import { Tower } from '../src/tower.js';
import { burstDelay, groupSize, waveDuration, WAVE_BASE, ROW_OFFSET } from '../src/fx/wave.js';

test('wall: delays grow monotonically left to right, 0 at the left edge, full wave at the right edge', () => {
  const cols = 30; let prev = -1;
  for (let c = 0; c < cols; c++) {
    const d = burstDelay({ wall: true, col: c, cols });
    assert.ok(d >= prev, 'monotone at ' + c); prev = d;
  }
  assert.equal(burstDelay({ wall: true, col: 0, cols }), 0);
  assert.ok(Math.abs(burstDelay({ wall: true, col: cols - 1, cols }) - WAVE_BASE) < 1e-9);
});

test('cylinder: PHYSICAL direction - starts at the lock column and moves to the RIGHT on the visible front face (counter-clockwise from above)', () => {
  const cols = 63, start = 5, STEP = (Math.PI * 2) / cols;
  const tower = new Tower();                       // the real cell-position function the renderer uses
  // camera frozen on the lock column: the tower is rotated by -start * STEP about Y (camera on +z, looking at -z)
  const theta = -start * STEP;
  const screenX = (col) => { const p = tower.cellPosition(0, col); return p.x * Math.cos(theta) + p.z * Math.sin(theta); };
  const frontZ = (col) => { const p = tower.cellPosition(0, col); return -p.x * Math.sin(theta) + p.z * Math.cos(theta); };
  assert.ok(frontZ(start) > 0 && Math.abs(screenX(start)) < 1e-6, 'lock column is front-centre');
  const front = []; for (let c = 0; c < cols; c++) if (frontZ(c) > 0) front.push(c);   // the visible front half
  assert.ok(front.length >= 30);
  front.sort((a, b) => screenX(a) - screenX(b));    // left -> right on screen
  const d = (c) => burstDelay({ wall: false, col: c, cols, startCol: start });
  // right half of the front face: the burst front travels to the RIGHT (delay grows with screen x) ...
  const right = front.filter((c) => screenX(c) >= -1e-9);
  for (let i = 1; i < right.length; i++) assert.ok(d(right[i]) >= d(right[i - 1]) - 1e-12, `right half, col ${right[i]}`);
  // ... and keeps going round the back, arriving at the LEFT edge first and finishing next to the centre
  const left = front.filter((c) => screenX(c) < -1e-9);
  for (let i = 1; i < left.length; i++) assert.ok(d(left[i]) >= d(left[i - 1]) - 1e-12, `left half, col ${left[i]}`);
  const dCentre = d(start);
  const rightCol = right[right.length - 1];
  assert.equal(dCentre, 0);
  assert.ok(d(rightCol) < d((start - 1 + cols) % cols));
  // counter-clockwise seen from above: angle (from +z towards +x) grows with the delay
  const ang = (c) => ((c - start + cols) % cols) * STEP;
  for (const c of [start + 7, start + 20]) assert.ok(burstDelay({ wall: false, col: c % cols, cols, startCol: start }) > 0 && ang(c % cols) < Math.PI);
  // the column just clockwise of the start (one step the other way) is the LAST to burst
  const last = burstDelay({ wall: false, col: start - 1, cols, startCol: start });
  assert.ok(Math.abs(last - WAVE_BASE) < 1e-9);
  for (let col = 0; col < cols; col++) assert.ok(burstDelay({ wall: false, col, cols, startCol: start }) <= last + 1e-12);
});

test('groups of neighbouring tiles share a delay; rows are offset; deterministic', () => {
  const cols = 63, g = groupSize(cols);
  assert.ok(g >= 2 && g <= 3);
  assert.equal(burstDelay({ wall: true, col: 0, cols }), burstDelay({ wall: true, col: g - 1, cols }));
  assert.ok(burstDelay({ wall: true, col: g, cols }) > burstDelay({ wall: true, col: 0, cols }));
  assert.ok(Math.abs(burstDelay({ wall: true, col: 7, cols, rowRank: 2 }) - burstDelay({ wall: true, col: 7, cols }) - 2 * ROW_OFFSET) < 1e-12);
  assert.equal(burstDelay({ wall: false, col: 9, cols, startCol: 20, rowRank: 1 }), burstDelay({ wall: false, col: 9, cols, startCol: 20, rowRank: 1 }));
  assert.ok(waveDuration(4) > waveDuration(1));
});
