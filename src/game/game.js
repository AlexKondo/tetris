import { COLS as DEF_COLS, ROWS as DEF_ROWS, BUFFER_ROWS as DEF_BUF } from '../config.js';
import { PIECE_NAMES, rotatedCells, pieceId, BAND_BASE, BAND_COUNT } from './pieces.js';

export const SCORE_TABLE = [0, 100, 300, 500, 800];
export const RINGS_PER_LEVEL = 10;
export const LOCK_DELAY_MS = 400;
export const MAX_LOCK_RESETS = 15;
export const SPAWN_GAP = 3; // default rows between stack top and spawned piece (relativeSpawn); the app passes a bigger one
export const CHAIN_STEP = 0.5, CHAIN_MAX = 5; // chain multiplier: step i (0-based) scores x min(1 + 0.5*i, 5)
// Rotation kicks as [dc, dr] tried in order (dr up). The first non-colliding one wins.
export const KICKS = [[0, 0], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, 2], [2, 0], [-2, 0], [1, 2], [-1, 2]];

/** Gravity interval (ms per row) for a level. */
export function gravityMs(level) { return Math.max(120, 900 * Math.pow(0.88, level - 1)); }

/**
 * Pure game logic for cylinder tetris. No rendering. grid[row * cols + col] = piece id (0 empty),
 * row 0 = bottom; columns wrap. Rows >= `rows` are the spawn buffer.
 * Events: lock {cells,id,name}, clear {rows,count}, level {level}, gameOver {score,level,rings},
 * spawn {piece}, restart.
 */
export class Game {
  constructor({ rng = Math.random, cols = DEF_COLS, rows = DEF_ROWS, buffer = DEF_BUF, spawnCol = 0, initialStack = false, relativeSpawn = false, wrap = true, cascade = true, spawnGap = SPAWN_GAP, seedRows = null, maxStack = null, spawnHint = null } = {}) {
    this.wrap = wrap;
    // spawnHint(): float column that should be at the centre of a NEW piece (the column currently facing the
    // camera on the cylinder). null / not wrapping / restarting -> the fixed spawnCol is used.
    this.spawnHint = spawnHint; this._hintOk = true;
    this.cascade = cascade;                      // true: after a clear every column collapses individually (+ chain reactions)
    this.spawnGap = spawnGap;
    this.seedRows = seedRows;                    // height of the starting stack (default: rows - 7)
    this.maxStack = maxStack === null ? rows + 1 : maxStack; // game over when the settled stack reaches this many rows
    this.initialStack = initialStack;
    this.relativeSpawn = relativeSpawn;
    this.cols = cols; this.rows = rows; this.buffer = buffer; this.totalRows = rows + buffer;
    this.spawnCol = spawnCol;
    this.rng = rng;
    this.listeners = {};
    this.grid = new Uint8Array(this.totalRows * cols);
    this.restart(rng);
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); return this; }
  emit(evt, data) { const l = this.listeners[evt]; if (l) for (const f of l) f(data); }

  /** Reset everything. Optionally swap the RNG. */
  restart(rng) {
    if (rng) this.rng = rng;
    this.grid.fill(0);
    if (this.initialStack) this._seedStack();
    this.bag = [];
    this.score = 0; this.level = 1; this.rings = 0;
    this.over = false;
    this.piece = null;
    this.gravityAcc = 0; this.lockAcc = 0; this.lockResets = 0; this.armed = false;
    this.nextName = this._draw();
    this.emit('restart', this);
    this._hintOk = false;                 // a restart always spawns at the fixed home column (deterministic)
    this._spawn();
    this._hintOk = true;
  }

  /**
   * Starting tower: rows below `rows-7` are walls with 1-3 enclosed holes per row; the top band has a
   * nested hole run (width 1..3, reachable from above) so rings are completable; a ragged top row.
   * Every row keeps at least one hole, so nothing clears on the first lock. Uses this.rng (deterministic).
   */
  _seedStack() {
    const { cols, rows, grid } = this;
    const top = this.seedRows === null ? rows - 7 : this.seedRows;
    const rnd = (n) => Math.floor(this.rng() * n);
    const hole = new Uint8Array(cols);
    for (let r = 0; r < top - 7; r++) {
      hole.fill(0);
      const n = 1 + rnd(Math.min(3, cols - 1));
      for (let i = 0; i < n; i++) hole[rnd(cols)] = 1;
      for (let c = 0; c < cols; c++) if (!hole[c]) grid[r * cols + c] = BAND_BASE + (r % BAND_COUNT);
    }
    const p = this.wrap ? rnd(cols) : rnd(Math.max(1, cols - 3)); // flat wall: the hole run must fit inside
    const widths = [1, 1, 2, 2, 3, 3];
    for (let i = 0; i < 7; i++) {
      const r = top - 7 + i;
      const w = Math.min(widths[Math.min(i, 5)], cols - 1);
      for (let c = 0; c < cols; c++) {
        const inRun = ((c - p + cols) % cols) < w;
        if (inRun) continue;
        if (i === 6 && this.rng() < 0.5) continue; // ragged top row
        grid[r * cols + c] = BAND_BASE + (r % BAND_COUNT);
      }
    }
  }

  _draw() {
    if (this.bag.length === 0) {
      const b = PIECE_NAMES.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      this.bag = b;
    }
    return this.bag.pop();
  }

  _spawn() {
    const name = this.nextName;
    this.nextName = this._draw();
    const row = this.relativeSpawn ? Math.min(this.stackTop() + this.spawnGap, this.rows) : this.rows;
    let col = this.spawnCol;
    if (this.spawnHint && this._hintOk && this.wrap) {
      const h = this.spawnHint();
      if (Number.isFinite(h)) {
        const cells = rotatedCells(name, 0);
        let m = 0; for (const c of cells) m += c[0];
        col = this.wrapCol(Math.round(h - m / cells.length)); // piece centre on the hinted column (seam-safe: cells wrap)
      }
    }
    this.piece = { name, id: pieceId(name), col, row, rot: 0 };
    this.gravityAcc = 0; this.lockAcc = 0; this.lockResets = 0; this.armed = false; this.lowest = row;
    if (this._collides(name, this.piece.col, this.piece.row, 0)) {
      this.over = true;
      this.emit('gameOver', { score: this.score, level: this.level, rings: this.rings });
    } else {
      this.emit('spawn', { piece: this.piece });
    }
  }

  /** Number of rows occupied from the bottom (highest filled row + 1). */
  stackTop() {
    for (let i = this.grid.length - 1; i >= 0; i--) if (this.grid[i]) return Math.floor(i / this.cols) + 1;
    return 0;
  }

  /** True when the active piece rests on something. */
  grounded() {
    const p = this.piece;
    return !!p && this._collides(p.name, p.col, p.row - 1, p.rot);
  }

  wrapCol(c) { return this.wrap ? ((c % this.cols) + this.cols) % this.cols : c; }
  cell(row, col) {
    if (!this.wrap && (col < 0 || col >= this.cols)) return 1; // flat wall: the sides are solid
    return this.grid[row * this.cols + this.wrapCol(col)];
  }

  _collides(name, col, row, rot) {
    for (const [dc, dr] of rotatedCells(name, rot)) {
      const r = row + dr;
      if (r < 0 || r >= this.totalRows) return true;
      const c = col + dc;
      if (!this.wrap && (c < 0 || c >= this.cols)) return true;
      if (this.grid[r * this.cols + this.wrapCol(c)]) return true;
    }
    return false;
  }

  /** Absolute cells [{row, col}] (col wrapped) of the active piece. */
  pieceCells(p = this.piece) {
    if (!p) return [];
    return rotatedCells(p.name, p.rot).map(([dc, dr]) => ({ row: p.row + dr, col: this.wrapCol(p.col + dc) }));
  }

  _try(dc, dr, drot) {
    const p = this.piece;
    if (!p || this.over) return false;
    const rot = (p.rot + drot + 4) % 4;
    if (this._collides(p.name, p.col + dc, p.row + dr, rot)) return false;
    this._apply(p, dc, dr, rot);
    return true;
  }

  _apply(p, dc, dr, rot) {
    p.col = this.wrapCol(p.col + dc); p.row += dr; p.rot = rot;
    if (p.row < this.lowest) { this.lowest = p.row; this.lockResets = 0; this.lockAcc = 0; this.armed = false; }
    // lock delay: a successful sideways move / rotation re-arms the timer (limited number of times)
    if (dr === 0 && this.armed && this.lockAcc > 0 && this.lockResets < MAX_LOCK_RESETS) { this.lockAcc = 0; this.lockResets++; }
  }

  /** Clockwise rotation with wall/floor kicks. */
  rotate() {
    const p = this.piece;
    if (!p || this.over) return false;
    const rot = (p.rot + 1) % 4;
    for (const [dc, dr] of KICKS) {
      if (!this._collides(p.name, p.col + dc, p.row + dr, rot)) {
        const wasGrounded = this.armed && this.lockAcc > 0;
        this._apply(p, dc, dr, rot);
        if (dr > 0 && wasGrounded && this.lockResets < MAX_LOCK_RESETS) { this.lockAcc = 0; this.lockResets++; }
        return true;
      }
    }
    return false;
  }

  moveLeft() { return this._try(-1, 0, 0); }
  moveRight() { return this._try(1, 0, 0); }

  /** Move down one row (+1 score); no-op when grounded (lock delay handles locking). Returns true if it moved. */
  softDrop() {
    if (!this.piece || this.over) return false;
    if (this._try(0, -1, 0)) { this.score += 1; this.gravityAcc = 0; return true; }
    return false; // grounded: the lock delay in update() decides
  }

  /** Row the active piece would land on (for the ghost). */
  landingRow() {
    const p = this.piece;
    if (!p) return 0;
    let r = p.row;
    while (!this._collides(p.name, p.col, r - 1, p.rot)) r--;
    return r;
  }

  /** Drop to the landing row and lock. Returns distance dropped. */
  hardDrop() {
    if (!this.piece || this.over) return 0;
    const dist = this.piece.row - this.landingRow();
    this.piece.row -= dist;
    this.score += 2 * dist;
    this._lock();
    return dist;
  }

  /** Advance gravity / lock delay by dt milliseconds. */
  update(dtMs) {
    if (this.over || !this.piece) return;
    const grounded = this.grounded();
    // The lock timer arms on first touchdown and only disarms when the piece reaches a NEW lowest row,
    // so kick-up / rotate spam can't stall it forever (resets are capped by MAX_LOCK_RESETS).
    if (grounded) this.armed = true;
    if (this.armed) {
      this.lockAcc += dtMs;
      if (grounded && this.lockAcc >= LOCK_DELAY_MS) { this._lock(); return; }
    }
    if (grounded) { this.gravityAcc = 0; return; }
    this.gravityAcc += dtMs;
    const g = gravityMs(this.level);
    while (this.gravityAcc >= g && !this.over && this.piece) {
      this.gravityAcc -= g;
      this.tick();
      if (this.piece && this.grounded()) { this.gravityAcc = 0; break; }
    }
  }

  /** One gravity step (no soft-drop score). Locking happens through the lock delay in update(). */
  tick() {
    if (this.over || !this.piece) return;
    this._try(0, -1, 0);
  }

  _lock() {
    const p = this.piece;
    const cells = this.pieceCells(p);
    for (const c of cells) this.grid[c.row * this.cols + c.col] = p.id;
    this.piece = null;
    this.emit('lock', { cells, id: p.id, name: p.name });
    const steps = this._resolveClears();
    if (steps.length) {
      let total = 0, gain = 0;
      steps.forEach((st, i) => {
        st.mult = Math.min(CHAIN_MAX, 1 + CHAIN_STEP * i);
        st.gain = Math.round(SCORE_TABLE[Math.min(4, st.count)] * this.level * st.mult);
        total += st.count; gain += st.gain;
      });
      this.score += gain;
      this.rings += total;
      this.lastChain = steps.length;
      this.emit('clear', { rows: steps[0].rows, count: total, gain, chain: steps.length, steps });
      const newLevel = 1 + Math.floor(this.rings / RINGS_PER_LEVEL);
      if (newLevel > this.level) { this.level = newLevel; this.emit('level', { level: newLevel }); }
    }
    // game over: the settled stack reached the limit (checked after clears / cascades resolved)
    if (this.stackTop() >= this.maxStack) {
      this.over = true;
      this.emit('gameOver', { score: this.score, level: this.level, rings: this.rings });
      return;
    }
    this._spawn();
  }

  _fullRows() {
    const { cols, totalRows, grid } = this;
    const full = [];
    for (let r = 0; r < totalRows; r++) {
      let ok = true;
      for (let c = 0; c < cols; c++) if (!grid[r * cols + c]) { ok = false; break; }
      if (ok) full.push(r);
    }
    return full;
  }

  /**
   * Remove full rows; then (cascade) every column's remaining cells fall individually to rest on the cell
   * below (sand-style, vertical order kept), so overhangs collapse and fill holes beneath. New full rows
   * created by the collapse are cleared too (chain reaction) until the grid is stable.
   * Returns steps: [{ rows, count, before, after, moves:[col, fromRow, toRow, id, ...] }].
   * With cascade = false it is the classic rigid behaviour (rows above shift down as units, single step).
   */
  _resolveClears() {
    const steps = [];
    for (let guard = 0; guard < 40; guard++) {
      const full = this._fullRows();
      if (!full.length) break;
      const before = this.grid.slice();
      const moves = this.cascade ? this._removeAndCollapse(full) : this._removeAndShift(full);
      steps.push({ rows: full, count: full.length, before, after: this.grid.slice(), moves });
      if (!this.cascade) break;
    }
    return steps;
  }

  _removeAndShift(full) {
    const { cols, totalRows, grid } = this;
    const isFull = new Set(full), moves = [];
    let w = 0;
    for (let r = 0; r < totalRows; r++) {
      if (isFull.has(r)) continue;
      if (w !== r) {
        for (let c = 0; c < cols; c++) if (grid[r * cols + c]) moves.push(c, r, w, grid[r * cols + c]);
        grid.copyWithin(w * cols, r * cols, (r + 1) * cols);
      }
      w++;
    }
    grid.fill(0, w * cols);
    return moves;
  }

  _removeAndCollapse(full) {
    const { cols, totalRows, grid } = this;
    const isFull = new Set(full), moves = [];
    const src = grid.slice();
    grid.fill(0);
    for (let c = 0; c < cols; c++) {
      let w = 0;
      for (let r = 0; r < totalRows; r++) {
        if (isFull.has(r)) continue;
        const id = src[r * cols + c];
        if (!id) continue;
        grid[w * cols + c] = id;
        if (w !== r) moves.push(c, r, w, id);
        w++;
      }
    }
    return moves;
  }
}
