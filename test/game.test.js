import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, mulberry32, pieceId, gravityMs, rotatedCells, PIECE_NAMES } from '../src/game/index.js';

const mk = (o = {}) => new Game({ rng: mulberry32(1), cols: 8, rows: 10, buffer: 4, ...o });
function force(g, name, col, row, rot = 0) {
  g.piece = { name, id: pieceId(name), col, row, rot };
  g.lowest = row; g.armed = false; g.lockAcc = 0; g.lockResets = 0;
}
function fillRow(g, row, except = []) {
  for (let c = 0; c < g.cols; c++) if (!except.includes(c)) g.grid[row * g.cols + c] = 1;
}
const colsOf = (g) => g.pieceCells().map((c) => c.col).sort((a, b) => a - b);

test('bag randomizer: each 7 draws contains all pieces; seed is deterministic', () => {
  const a = mk(), b = mk();
  const seqA = [], seqB = [];
  for (let i = 0; i < 14; i++) { seqA.push(a._draw()); seqB.push(b._draw()); }
  assert.deepEqual(seqA, seqB);
  // a._draw already consumed during construction (nextName + spawn), so just test a fresh bag
  const g = mk(); g.bag = [];
  const bag = []; for (let i = 0; i < 7; i++) bag.push(g._draw());
  assert.deepEqual([...bag].sort(), [...PIECE_NAMES].sort());
});

test('spawn at top centre-ish (spawn col, buffer rows)', () => {
  const g = mk();
  assert.ok(g.piece);
  assert.equal(g.piece.row, g.rows);
  assert.ok(g.pieceCells().every((c) => c.row >= g.rows));
});

test('moveLeft/moveRight wrap around the cylinder', () => {
  const g = mk(); force(g, 'T', 0, 12);
  assert.ok(g.moveLeft());
  assert.equal(g.piece.col, 7);
  assert.deepEqual(colsOf(g), [0, 6, 7, 7].sort((a, b) => a - b));
  g.moveRight(); g.moveRight();
  assert.equal(g.piece.col, 1);
  force(g, 'O', 7, 12);
  g.moveRight();
  assert.equal(g.piece.col, 0);
  assert.deepEqual(colsOf(g), [0, 0, 1, 1]);
});

test('move blocked by the stack', () => {
  const g = mk(); force(g, 'O', 3, 0);
  g.grid[0 * g.cols + 5] = 1;
  assert.equal(g.moveRight(), false);
  assert.equal(g.piece.col, 3);
  assert.equal(g.moveLeft(), true);
});

test('piece cannot move below the floor; soft drop at floor locks', () => {
  const g = mk(); force(g, 'O', 3, 0);
  assert.equal(g._try(0, -1, 0), false);
  let locked = 0; g.on('lock', () => locked++);
  g.update(500);
  assert.equal(locked, 1);
  assert.equal(g.cell(0, 3), pieceId('O'));
  assert.ok(g.piece); // new piece spawned
});

test('rotation CW changes orientation and wraps columns', () => {
  const g = mk(); force(g, 'I', 0, 5);
  assert.deepEqual(rotatedCells('I', 1), [[0, 1], [0, 0], [0, -1], [0, -2]]);
  assert.ok(g.rotate());
  assert.equal(g.piece.rot, 1);
  assert.ok(g.pieceCells().every((c) => c.col === 0));
  g.rotate(); g.rotate(); g.rotate();
  assert.equal(g.piece.rot, 0);
});

test('rotation is rejected only when every kick collides; state unchanged', () => {
  const g = mk(); force(g, 'I', 3, 5);
  g.grid.fill(1);
  for (const dc of [-1, 0, 1, 2]) g.grid[5 * g.cols + 3 + dc] = 0; // sealed horizontal pocket
  assert.equal(g.rotate(), false);
  assert.equal(g.piece.rot, 0);
  assert.equal(g.piece.row, 5);
});

test('rotation kicks up off the floor and sideways off a blocker', () => {
  const g = mk(); force(g, 'I', 3, 1); // vertical I would reach row -1
  assert.ok(g.rotate());
  assert.equal(g.piece.rot, 1);
  assert.ok(g.pieceCells().every((c) => c.row >= 0));
  const h = mk(); force(h, 'I', 3, 5);
  h.grid[6 * h.cols + 3] = 1; h.grid[7 * h.cols + 3] = 1; // blocks above pivot
  assert.ok(h.rotate());
  assert.equal(h.piece.rot, 1);
  assert.ok(h.piece.col !== 3 || h.piece.row !== 5);
});

test('lock delay: grounded piece locks after 400ms, not before', () => {
  const g = mk(); force(g, 'O', 3, 0);
  let locks = 0; g.on('lock', () => locks++);
  g.update(399); assert.equal(locks, 0);
  g.update(2); assert.equal(locks, 1);
});

test('lock delay resets on move/rotate, limited by MAX_LOCK_RESETS', () => {
  const g = mk(); force(g, 'O', 3, 0);
  let locks = 0; g.on('lock', () => locks++);
  g.update(300); g.moveLeft(); g.update(300); g.moveRight(); g.update(300);
  assert.equal(locks, 0);
  assert.ok(g.lockResets >= 2);
  for (let i = 0; i < 30 && !locks; i++) { g.update(10); g.moveLeft(); g.update(10); g.moveRight(); }
  g.update(300); g.moveLeft(); g.update(300); // resets exhausted: timer keeps running
  assert.equal(locks, 1);
});

test('soft drop on a grounded piece does not lock instantly', () => {
  const g = mk(); force(g, 'O', 3, 0);
  assert.equal(g.softDrop(), false);
  assert.equal(g.piece.row, 0);
});

test('relativeSpawn: spawn sits SPAWN_GAP rows above the stack top, game over still works', () => {
  const g = new Game({ rng: mulberry32(2), cols: 8, rows: 20, buffer: 6, relativeSpawn: true });
  assert.equal(g.piece.row, 3);
  fillRow(g, 6, [1]); // stack top = 7
  g.restart(mulberry32(2));
  g.grid.fill(0); fillRow(g, 6, [1]); g.piece = null; g._spawn();
  assert.equal(g.piece.row, 10);
  g.grid.fill(0); fillRow(g, 18, [1]); g.piece = null; g._spawn();
  assert.equal(g.piece.row, 20); // capped at rows
  g.grid.fill(0); fillRow(g, 21, [1]); fillRow(g, 20, [1]); g.piece = null; g._spawn();
  assert.equal(g.over, true);
  const h = new Game({ rng: mulberry32(3), cols: 8, rows: 20, buffer: 6, relativeSpawn: true });
  let n = 0; while (!h.over && n++ < 300) h.hardDrop();
  assert.equal(h.over, true);
});

test('O piece rotation is a no-op but allowed', () => {
  const g = mk(); force(g, 'O', 2, 5);
  const before = JSON.stringify(g.pieceCells());
  assert.ok(g.rotate());
  assert.equal(JSON.stringify(g.pieceCells()), before);
});

test('collision with the stack stops descent and locks on top', () => {
  const g = mk(); force(g, 'O', 2, 5);
  g.grid[3 * g.cols + 2] = 1;
  assert.ok(g.softDrop()); // row 4
  assert.equal(g.softDrop(), false); // blocked at row 4
  g.update(500); // lock delay elapses
  assert.equal(g.cell(4, 2), pieceId('O'));
  assert.equal(g.cell(5, 3), pieceId('O'));
});

test('lock writes cells, emits event, spawns next', () => {
  const g = mk(); force(g, 'T', 4, 0);
  const evts = [];
  g.on('lock', (e) => evts.push(e));
  const expectNext = g.nextName;
  g.hardDrop();
  assert.equal(evts.length, 1);
  assert.equal(evts[0].cells.length, 4);
  assert.equal(g.cell(0, 3), pieceId('T'));
  assert.equal(g.piece.name, expectNext);
});

test('hard drop goes to landing row, scores 2/cell, locks', () => {
  const g = mk(); force(g, 'O', 3, 8);
  assert.equal(g.landingRow(), 0);
  const d = g.hardDrop();
  assert.equal(d, 8);
  assert.equal(g.score, 16);
  assert.equal(g.cell(0, 3), pieceId('O'));
  assert.equal(g.cell(1, 4), pieceId('O'));
});

test('soft drop scores 1 per row', () => {
  const g = mk(); force(g, 'O', 3, 8);
  g.softDrop(); g.softDrop();
  assert.equal(g.score, 2);
});

test('single ring clear: row removed, rows above drop, score 100', () => {
  const g = mk();
  fillRow(g, 0, [3, 4]);
  g.grid[1 * g.cols + 0] = 2; // marker above
  const clears = [];
  g.on('clear', (e) => clears.push(e));
  force(g, 'O', 3, 5);
  g.hardDrop();
  assert.deepEqual(clears[0].rows, [0]);
  assert.equal(g.rings, 1);
  // O occupied rows 0,1 cols 3,4 ; row 0 cleared -> row 1's O cells drop to row 0, marker drops to row 0
  assert.equal(g.cell(0, 0), 2);
  assert.equal(g.cell(0, 3), pieceId('O'));
  assert.equal(g.cell(0, 4), pieceId('O'));
  assert.equal(g.cell(1, 3), 0);
  assert.equal(g.score, 100 + 2 * 5);
});

test('multi ring clear (4 = 800, non-adjacent rows handled)', () => {
  const g = mk();
  for (const r of [0, 1, 2, 3]) fillRow(g, r, [3]);
  g.grid[4 * g.cols + 0] = 3;
  force(g, 'I', 3, 5, 1); // vertical I: rows pivot+1 .. pivot-2
  // vertical I cells rows 6,5,4,3 at col 3 -> need to drop first
  g.piece.row = 5;
  const clears = [];
  g.on('clear', (e) => clears.push(e));
  // drop: lands with lowest cell at row 0 => pivot row 2 => cells rows 3..0 ... rows 3,2,1,0
  const d = g.hardDrop();
  assert.equal(clears[0].count, 4);
  assert.deepEqual(clears[0].rows, [0, 1, 2, 3]);
  assert.equal(g.score, 800 + 2 * d);
  assert.equal(g.cell(0, 0), 3); // marker dropped 4 rows
  assert.equal(g.cell(4, 0), 0);
});

test('non-adjacent rings clear and gap row survives', () => {
  const g = mk();
  fillRow(g, 0, [3]); fillRow(g, 2, [3]);
  g.grid[1 * g.cols + 6] = 4; // row 1 has one tile
  g.grid[1 * g.cols + 3] = 0;
  // vertical I at col 3: lands cells rows 0..-? use J-less approach: place tiles directly
  force(g, 'I', 3, 2, 1); // cells rows 3,2,1,0 at col 3
  g.hardDrop();
  assert.equal(g.rings, 3 - 1); // rows 0 and 2 full; row 1 has col6+col3 only
  assert.equal(g.cell(0, 6), 4);
  assert.equal(g.cell(0, 3), pieceId('I'));
  assert.equal(g.cell(1, 3), pieceId('I'));
});

test('scoring table scales by level', () => {
  const g = mk(); g.level = 3;
  fillRow(g, 0, [3, 4]);
  force(g, 'O', 3, 1);
  g.piece.row = 0; // lands rows 0,1
  g.hardDrop();
  assert.equal(g.score, 100 * 3);
  const h = mk(); h.level = 2;
  for (const r of [0, 1, 2]) fillRow(h, r, [3]);
  force(h, 'I', 3, 2, 1);
  h.hardDrop();
  assert.equal(h.score, 500 * 2 + 0); // landing distance 0 (already resting) -> 0 drop points
});

test('level up every 10 rings, faster gravity, level event', () => {
  const g = mk();
  const levels = [];
  g.on('level', (e) => levels.push(e.level));
  g.rings = 9;
  fillRow(g, 0, [3, 4]);
  force(g, 'O', 3, 0);
  g.hardDrop();
  assert.equal(g.rings, 10);
  assert.equal(g.level, 2);
  assert.deepEqual(levels, [2]);
  assert.ok(gravityMs(2) < gravityMs(1));
  assert.ok(gravityMs(50) > 0);
});

test('gravity update drops piece by level interval', () => {
  const g = mk(); force(g, 'O', 3, 8);
  g.gravityAcc = 0;
  g.update(gravityMs(1) - 1);
  assert.equal(g.piece.row, 8);
  g.update(2);
  assert.equal(g.piece.row, 7);
  g.update(gravityMs(1) * 2);
  assert.equal(g.piece.row, 5);
});

test('game over when spawn collides, input ignored, restart resets', () => {
  const g = mk();
  const over = [];
  g.on('gameOver', (e) => over.push(e));
  // block spawn area
  fillRow(g, g.rows, [5]);
  g.score = 42;
  force(g, 'O', 3, 0);
  g.hardDrop(); // locks then next spawn collides
  assert.equal(g.over, true);
  assert.equal(over.length, 1);
  const s = g.score;
  assert.equal(g.moveLeft(), false);
  g.update(5000);
  assert.equal(g.score, s);
  g.restart(mulberry32(5));
  assert.equal(g.over, false);
  assert.equal(g.score, 0); assert.equal(g.level, 1); assert.equal(g.rings, 0);
  assert.ok(g.grid.every((v) => v === 0));
  assert.ok(g.piece);
});

test('natural game over by stacking to the top', () => {
  const g = mk();
  let n = 0;
  while (!g.over && n++ < 400) g.hardDrop();
  assert.equal(g.over, true);
});

test('restart with the same seed reproduces the sequence', () => {
  const g = mk();
  g.restart(mulberry32(99));
  const a = [g.piece.name, g.nextName];
  g.restart(mulberry32(99));
  assert.deepEqual([g.piece.name, g.nextName], a);
});

test('seeded starting stack: deterministic, no full row, restart re-seeds identically', () => {
  const mkS = (seed) => new Game({ rng: mulberry32(seed), rows: 31, buffer: 13, initialStack: true });
  const a = mkS(123), b = mkS(123), c = mkS(124);
  assert.deepEqual(a.grid, b.grid);
  assert.notDeepEqual(a.grid, c.grid);
  for (let r = 0; r < a.totalRows; r++) {
    let n = 0; for (let col = 0; col < a.cols; col++) if (a.grid[r * a.cols + col]) n++;
    assert.ok(n < a.cols, 'row ' + r + ' is full');
    if (r < 22) assert.ok(n >= a.cols - 3, 'row ' + r + ' too sparse');
  }
  assert.ok(a.grid.slice(0, 20 * a.cols).some((v) => v));
  assert.equal(a.cell(30, 0), 0); // spawn area clear
  assert.ok(a.piece && !a.over);
  const snap = Uint8Array.from(a.grid), name = a.piece.name;
  a.hardDrop(); a.hardDrop();
  a.restart(mulberry32(123));
  assert.deepEqual(a.grid, snap);
  assert.equal(a.piece.name, name);
});

test('level-1 gravity is 900ms and speeds up with a floor', () => {
  assert.equal(gravityMs(1), 900);
  assert.ok(gravityMs(2) < 900 && gravityMs(99) === 120);
});

test('seeded stack: first ring is completable (well reachable from above)', () => {
  const g = new Game({ rng: mulberry32(123), rows: 31, buffer: 13, initialStack: true });
  // top band hole column is open all the way to the spawn: a vertical drop must reach the band
  const top = g.rows - 7;
  const holeCol = [...Array(g.cols).keys()].find((c) => !g.grid[(top - 7) * g.cols + c] && !g.grid[(top + 5) * g.cols + c]);
  assert.notEqual(holeCol, undefined);
  g.piece = { name: 'I', id: 1, col: holeCol, row: g.rows, rot: 1 };
  const land = g.landingRow();
  assert.ok(land < g.rows - 4);
});

test('rotate + softDrop spam cannot stall the lock forever', () => {
  const g = mk(); force(g, 'I', 3, 0);
  let locked = false; g.on('lock', () => { locked = true; });
  let steps = 0;
  while (!locked && steps++ < 400) { g.rotate(); g.softDrop(); g.update(16); }
  assert.ok(locked, 'never locked');
  assert.ok(steps * 16 < 6000);
});

test('sliding off a ledge disarms the lock timer once a new lowest row is reached', () => {
  const g = mk(); force(g, 'O', 3, 1);
  g.grid[0 * g.cols + 3] = 1; g.grid[0 * g.cols + 4] = 1;
  g.update(300); // armed
  g.moveRight(); g.moveRight(); // off the ledge
  g.update(gravityMs(1) + 1);
  assert.equal(g.piece.row, 0);
  g.update(399);
  assert.ok(g.piece);
});

// ---------- flat wall mode (wrap: false) ----------
const mkWall = (o = {}) => new Game({ rng: mulberry32(1), cols: 12, rows: 20, buffer: 6, wrap: false, spawnCol: 5, ...o });

test('wall: pieces stop at the left and right edges (no wrap)', () => {
  const g = mkWall(); force(g, 'O', 5, 12);
  for (let i = 0; i < 20; i++) g.moveLeft();
  assert.equal(g.piece.col, 0);
  assert.equal(g.moveLeft(), false);
  for (let i = 0; i < 30; i++) g.moveRight();
  assert.equal(g.piece.col, 10);              // O occupies cols 10..11
  assert.equal(g.moveRight(), false);
  assert.ok(g.pieceCells().every((c) => c.col >= 0 && c.col < 12));
  const h = mkWall(); force(h, 'I', 5, 12);   // I covers pivot-1..pivot+2
  for (let i = 0; i < 30; i++) h.moveLeft();
  assert.equal(h.piece.col, 1);
  for (let i = 0; i < 30; i++) h.moveRight();
  assert.equal(h.piece.col, 9);
});

test('wall: rotation near an edge is kicked back inside or rejected, never crosses', () => {
  const g = mkWall(); force(g, 'I', 1, 12, 1);   // vertical I at col 1; rotating to horizontal needs col 0..3
  assert.ok(g.rotate());
  assert.ok(g.pieceCells().every((c) => c.col >= 0 && c.col < 12));
  const h = mkWall(); force(h, 'I', 0, 12, 1);    // vertical at the very left edge
  assert.ok(h.rotate());                          // horizontal needs col -1: a kick moves it right
  assert.ok(h.pieceCells().every((c) => c.col >= 0));
  const s = mkWall({ cols: 4 }); force(s, 'I', 1, 12, 0); // I horizontal fills the whole 4-wide wall
  s.grid.fill(1); for (let c = 0; c < 4; c++) s.grid[12 * 4 + c] = 0;
  assert.equal(s.rotate(), false);                // sealed: rejected, state unchanged
  assert.equal(s.piece.rot, 0);
});

test('wall: ring clear needs a full row of WALL_COLS; spawn is centred', () => {
  const g = mkWall();
  assert.equal(g.piece.col, 5);
  const cs = g.pieceCells().map((c) => c.col);
  assert.ok(Math.min(...cs) >= 0 && Math.max(...cs) < 12);
  g.grid.fill(0); fillRow(g, 0, [4, 5, 6, 7]);
  force(g, 'I', 5, 3);
  g.hardDrop();
  assert.equal(g.rings, 1);
  assert.equal(g.score, 100 + 2 * 3);
  const h = mkWall(); h.grid.fill(0); fillRow(h, 0, [0]);   // col 0 empty only: wall edge column isn't "wrapped" filled
  force(h, 'I', 5, 3);
  h.hardDrop();
  assert.equal(h.rings, 0);
});

test('wall: seeded stack is deterministic, has holes in every row, hole run reachable from above', () => {
  const mkS = (seed) => new Game({ rng: mulberry32(seed), cols: 12, rows: 31, buffer: 13, wrap: false, spawnCol: 5, initialStack: true, relativeSpawn: true });
  const a = mkS(123), b = mkS(123);
  assert.deepEqual(a.grid, b.grid);
  for (let r = 0; r < a.totalRows; r++) {
    let n = 0; for (let c = 0; c < a.cols; c++) if (a.grid[r * a.cols + c]) n++;
    assert.ok(n < a.cols, 'row ' + r + ' full');
  }
  for (let seed = 1; seed < 40; seed++) {
    const g = mkS(seed);
    const band = g.rows - 14 + 5; // a hole run of width 3 in the upper band rows
    const holes = []; for (let c = 0; c < g.cols; c++) if (!g.grid[band * g.cols + c]) holes.push(c);
    assert.ok(holes.length >= 1 && holes.length <= 3, 'seed ' + seed);
    assert.ok(holes.every((c, i) => i === 0 || c === holes[i - 1] + 1), 'contiguous run, seed ' + seed); // not split by wrapping
  }
  assert.ok(a.piece && !a.over);
});
