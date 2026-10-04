import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, mulberry32, pieceId } from '../src/game/index.js';

function force(g, name, col, row, rot = 0) {
  g.piece = { name, id: pieceId(name), col, row, rot };
  g.lowest = row; g.armed = false; g.lockAcc = 0; g.lockResets = 0;
}
const mkC = (o = {}) => new Game({ rng: mulberry32(1), cols: 6, rows: 16, buffer: 6, wrap: true, cascade: true, ...o });
const cnt = (g) => g.grid.reduce((a, v) => a + (v ? 1 : 0), 0);
const colStr = (g, c, n = 8) => { let s = ''; for (let r = 0; r < n; r++) s += g.grid[r * g.cols + c] ? 'X' : '.'; return s; };
function fillExcept(g, row, except) { for (let c = 0; c < g.cols; c++) g.grid[row * g.cols + c] = except.includes(c) ? 0 : 7; }

test('cascade: a floating tile collapses into the hole beneath it', () => {
  const g = mkC();
  fillExcept(g, 0, [2]);
  g.grid[2 * g.cols + 4] = 5;                  // floating tile at (row 2, col 4), row 1 empty under it
  force(g, 'I', 2, 5, 1);                      // vertical I in col 2: rows 0..3
  g.hardDrop();
  assert.equal(g.rings >= 1, true);
  assert.equal(colStr(g, 4, 4), 'X...');
  assert.equal(g.grid[0 * g.cols + 4], 5);
});

test('cascade: whole stack settles per column; cell count conserved except cleared rows', () => {
  const g = mkC();
  fillExcept(g, 0, [1]);
  for (const [r, c] of [[2, 0], [4, 0], [3, 2], [6, 2], [2, 5], [5, 3]]) g.grid[r * g.cols + c] = 3;
  const before = cnt(g);
  force(g, 'I', 1, 6, 1);
  g.hardDrop();
  assert.equal(g.rings >= 1, true);
  assert.equal(cnt(g), before + 4 - g.rings * g.cols);
  for (let c = 0; c < g.cols; c++) { const s = colStr(g, c, 12); assert.ok(/^X*\.*$/.test(s), `col ${c}: ${s}`); }
});

test('cascade: chain reaction clears rows completed by the collapse, with a multiplier', () => {
  const g = mkC();
  fillExcept(g, 0, [1]);
  fillExcept(g, 1, [0, 1]);
  g.grid[3 * g.cols + 0] = 4;                  // falls into (row 0, col 0) after row 0 is removed -> completes a row
  force(g, 'I', 1, 8, 1);
  const ev = [];
  g.on('clear', (e) => ev.push(e));
  g.hardDrop();
  assert.equal(ev.length, 1);
  assert.ok(ev[0].chain >= 2, 'expected a chain, got ' + ev[0].chain);
  assert.equal(ev[0].steps[0].mult, 1);
  assert.equal(ev[0].steps[1].mult, 1.5);
  const gain = ev[0].steps.reduce((a, s) => a + s.gain, 0);
  assert.equal(ev[0].gain, gain);
  assert.equal(ev[0].steps[1].gain, Math.round(100 * 1.5));
  assert.equal(g.rings, ev[0].count);
});

test('cascade=false is the classic rigid behaviour (overhang stays, single step)', () => {
  const g = mkC({ cascade: false });
  fillExcept(g, 0, [2]);
  g.grid[2 * g.cols + 4] = 5;
  force(g, 'I', 2, 5, 1);
  const ev = [];
  g.on('clear', (e) => ev.push(e));
  g.hardDrop();
  assert.equal(ev[0].chain, 1);
  assert.equal(g.grid[1 * g.cols + 4], 5);     // moved down by exactly one row, still floating
  assert.equal(g.grid[0 * g.cols + 4], 0);
});

test('cascade: deterministic, and the recorded moves reproduce the after-grid (no loss / duplication)', () => {
  const run = () => {
    const g = mkC();
    fillExcept(g, 0, [0]);
    for (const [r, c] of [[3, 5], [5, 5], [2, 1], [4, 3]]) g.grid[r * g.cols + c] = 2;
    force(g, 'I', 0, 6, 1);
    const ev = [];
    g.on('clear', (e) => ev.push(e));
    g.hardDrop();
    return { grid: Array.from(g.grid), ev };
  };
  const a = run(), b = run();
  assert.deepEqual(a.grid, b.grid);
  const cols = 6;
  for (const st of a.ev[0].steps) {
    const out = new Uint8Array(st.before.length);
    const moved = new Set();
    for (let i = 0; i < st.moves.length; i += 4) {
      const c = st.moves[i], from = st.moves[i + 1], to = st.moves[i + 2], id = st.moves[i + 3];
      assert.equal(st.before[from * cols + c], id);
      out[to * cols + c] = id; moved.add(from * cols + c);
    }
    for (let idx = 0; idx < st.before.length; idx++) {
      const r = Math.floor(idx / cols);
      if (st.before[idx] && !moved.has(idx) && !st.rows.includes(r)) out[idx] = st.before[idx];
    }
    assert.deepEqual(Array.from(out), Array.from(st.after));
  }
});

test('game over only when the stack reaches maxStack; a clear can rescue; restart resets', () => {
  const mk = () => new Game({ rng: mulberry32(2), cols: 6, rows: 40, buffer: 6, cascade: true, maxStack: 12, relativeSpawn: true, spawnGap: 4 });
  const g = mk(); g.grid.fill(0);
  for (let r = 0; r < 10; r++) fillExcept(g, r, [0, 1, 2]);
  g.piece = null; g._spawn();
  assert.equal(g.stackTop(), 10);
  force(g, 'O', 4, 10);
  g.hardDrop();
  assert.equal(g.over, true);                      // stack reached 12

  const h = mk(); h.grid.fill(0);
  for (let r = 0; r < 9; r++) fillExcept(h, r, [0, 1, 2]);
  h.piece = null; h._spawn();
  force(h, 'O', 4, 9);
  h.hardDrop();
  assert.equal(h.over, false);                     // stack 11 < 12

  const r = mk(); r.grid.fill(0);
  for (let i = 0; i < 11; i++) fillExcept(r, i, [0]);
  r.piece = null; r._spawn();
  force(r, 'I', 0, 20, 1);
  r.hardDrop();
  assert.equal(r.over, false);                     // the lock leaves the stack under the limit after clearing
  assert.ok(r.stackTop() < 12);
  r.restart(mulberry32(3));
  assert.equal(r.over, false);
});

test('configurable spawn gap and seed height', () => {
  const g = new Game({ rng: mulberry32(5), cols: 14, rows: 44, buffer: 4, wrap: false, spawnCol: 6, relativeSpawn: true, spawnGap: 10, seedRows: 11, initialStack: true, maxStack: 30 });
  assert.ok(g.stackTop() >= 10 && g.stackTop() <= 11, 'seed height ' + g.stackTop());
  assert.equal(g.piece.row, g.stackTop() + 10);
});

function playBot(g, choose, maxPieces) {
  let n = 0;
  while (!g.over && n < maxPieces) { choose(g); g.hardDrop(); n++; }
  return n;
}

test('bots: random bot reaches game over; a greedy bot survives hundreds of pieces', () => {
  const mkG = (seed) => new Game({ rng: mulberry32(seed), cols: 10, rows: 30, buffer: 6, wrap: false, spawnCol: 4, cascade: true, relativeSpawn: true, spawnGap: 6, maxStack: 18 });
  const rnd = mulberry32(99);
  const randomBot = (g) => {
    const k = Math.floor(rnd() * 9) - 4;
    for (let i = 0; i < Math.abs(k); i++) { if (k < 0) g.moveLeft(); else g.moveRight(); }
    if (rnd() < 0.5) g.rotate();
  };
  const g1 = mkG(1);
  const used = playBot(g1, randomBot, 500);
  assert.equal(g1.over, true);
  assert.ok(used < 300, 'random bot took ' + used);

  const greedy = (g) => {
    let best = null;
    for (let rot = 0; rot < 4; rot++) for (let col = 0; col < g.cols; col++) {
      const p = { ...g.piece, rot, col };
      if (g._collides(p.name, col, p.row, rot)) continue;
      let r = p.row; while (!g._collides(p.name, col, r - 1, rot)) r--;
      const tmp = g.grid.slice();
      for (const c of g.pieceCells({ ...p, row: r })) tmp[c.row * g.cols + c.col] = 9;
      // drop full rows, then evaluate: aggregate height, holes, bumpiness (classic Tetris heuristic)
      const rowsKept = [];
      let lines = 0;
      for (let rr = 0; rr < g.totalRows; rr++) {
        let f = true; for (let c = 0; c < g.cols; c++) if (!tmp[rr * g.cols + c]) { f = false; break; }
        if (f) lines++; else rowsKept.push(rr);
      }
      const heights = new Array(g.cols).fill(0); let holes = 0;
      for (let c = 0; c < g.cols; c++) {
        let seen = false;
        for (let k = rowsKept.length - 1; k >= 0; k--) {
          if (tmp[rowsKept[k] * g.cols + c]) { if (!seen) heights[c] = k + 1; seen = true; } else if (seen) holes++;
        }
      }
      let bump = 0; for (let c = 1; c < g.cols; c++) bump += Math.abs(heights[c] - heights[c - 1]);
      const agg = heights.reduce((x, y) => x + y, 0);
      const score = agg * 0.51 + holes * 0.36 * 2 + bump * 0.18 - lines * 0.76 + Math.abs(col - 4) * 0.001;
      if (!best || score < best.score) best = { score, rot, col };
    }
    if (!best) return;
    for (let i = 0; i < 4 && g.piece.rot !== best.rot; i++) g.rotate();
    for (let i = 0; i < 12 && g.piece.col > best.col; i++) g.moveLeft();
    for (let i = 0; i < 12 && g.piece.col < best.col; i++) g.moveRight();
  };
  const g2 = mkG(2);
  const survived = playBot(g2, greedy, 300);
  assert.ok(survived >= 300 && !g2.over, `greedy bot ended after ${survived} pieces`);
});

test('spawn hint: the new piece is centred on the hinted column, incl. across the seam; default stays at col 0', () => {
  const mk = (hint) => new Game({ rng: mulberry32(4), cols: 44, rows: 44, buffer: 4, wrap: true, relativeSpawn: true, spawnGap: 10, spawnHint: hint });
  const centre = (g) => { // circular mean of the piece cells around its pivot, as an offset from the hint
    const cs = g.pieceCells().map((c) => c.col);
    const ref = cs[0]; let m = 0;
    for (const c of cs) { let d = c - ref; if (d > 22) d -= 44; if (d < -22) d += 44; m += d; }
    return ((ref + m / cs.length) % 44 + 44) % 44;
  };
  const plain = mk(null);
  assert.equal(plain.piece.col, 0);                                  // no hint: unchanged behaviour
  for (const hint of [10, 21.5, 43.7, 0.2, 43, 0]) {
    const g = mk(() => hint);
    // restart always uses the home column (deterministic) ...
    assert.equal(g.piece.col, 0);
    g.hardDrop();                                                    // ... a normal spawn follows the hint
    assert.equal(g.over, false);
    const c = centre(g);
    const dist = Math.min(Math.abs(c - hint), 44 - Math.abs(c - hint));
    assert.ok(dist <= 0.75, `hint ${hint}: piece centre ${c}`);
    assert.ok(g.pieceCells().every((p) => p.col >= 0 && p.col < 44));
  }
  // across the seam the cells wrap and the spawn is legal (no collision / game over)
  const seam = mk(() => 43.5); seam.hardDrop();
  assert.equal(seam.over, false);
  const cols = seam.pieceCells().map((c) => c.col);
  assert.ok(cols.some((c) => c > 40) && cols.some((c) => c < 3), 'piece straddles the seam: ' + cols.join());
  // wall mode ignores the hint
  const wall = new Game({ rng: mulberry32(4), cols: 20, rows: 44, buffer: 4, wrap: false, spawnCol: 9, relativeSpawn: true, spawnGap: 10, spawnHint: () => 3 });
  wall.hardDrop();
  assert.ok(wall.pieceCells().every((c) => c.col >= 7 && c.col <= 12));
});
