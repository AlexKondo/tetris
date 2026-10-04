import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, NormalBlending, AdditiveBlending,
} from 'three';
import { COLS, WATER_Y, R_OUT, WALL, TILE_W, TILE_COLORS, TILE_H, TILE_DEPTH } from './config.js';
import { OVERLAY_DEBRIS_COUNT, OVERLAY_FALL_COUNT } from './tower.js';
import { DebrisSim, ParticleSim, FallSim } from './fx/sim.js';
import { burstDelay, waveDuration } from './fx/wave.js';
import { mulberry32 } from './game/rng.js';

const STEP = (Math.PI * 2) / COLS;
const MAX_PARTICLES = 800, MAX_GLOW = 128;
const FLASH_BASE = 0.12, STEP_GAP = 0.08;
const SHAKE_SCALE = 0.65;    // global screen-shake amplitude (peak was ~0.4 tile widths on a 4-row wall clear)
const TILE_MID = R_OUT - TILE_DEPTH / 2;
// visual sizes: debris tiles start at ~35-50% of a full tile, shards / splash are small crisp points
export const DEBRIS_SIZE = [0.34, 0.5];
export const POINT_SIZE = { shard: 0.2, spark: 0.14, splash: 0.25 };
const lighten = (hex, k) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return [(r + (255 - r) * k) / 255, (g + (255 - g) * k) / 255, (b + (255 - b) * k) / 255];
};

const POINT_VS = `attribute float aSize; varying vec3 vCol; varying float vA; uniform float uScale;
  void main(){ vCol = color; vA = aSize > 0.0 ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(2.0, aSize * uScale / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv; }`;
const POINT_FS = `varying vec3 vCol; varying float vA;
  void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d);
    if (r > 0.5 || vA < 0.5) discard;
    gl_FragColor = vec4(vCol, smoothstep(0.5, 0.25, r)); }`;
const GLOW_FS = `varying vec3 vCol; varying float vA;
  void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
    if (r > 1.0 || vA < 0.5) discard;
    float a = pow(1.0 - r, 2.0);
    gl_FragColor = vec4(vCol, a); }`;

/**
 * Row-clear explosion (a wave of bursts), cascade collapse (cells break loose and fall), lock pulses,
 * screen shake and game-over dimming. Game logic stays instant; this layer only animates how the tower looks
 * and always converges to the logic state through `rebuild()`.
 */
export class Vfx {
  constructor(tower, rebuild) {
    this.tower = tower;
    this.rebuild = rebuild;
    this.rnd = mulberry32(1234);
    this.debris = new DebrisSim(OVERLAY_DEBRIS_COUNT);
    this.shown = new Uint8Array(OVERLAY_DEBRIS_COUNT);
    this.fall = new FallSim(OVERLAY_FALL_COUNT);
    this.fallShown = new Uint8Array(OVERLAY_FALL_COUNT);
    this.fallType = new Uint8Array(OVERLAY_FALL_COUNT);
    this.parts = new ParticleSim(MAX_PARTICLES);
    this.glow = new ParticleSim(MAX_GLOW);
    this.anim = null;           // clear / cascade animation in progress
    this.pulses = [];           // lock pulses {row,col,t}
    this.lockCol = 0;           // column of the last lock (the wave starts here on the cylinder)
    this.shakeAmp = 0; this.time = 0;
    this.dim = 1; this.dimTarget = 1;
    this.manual = false;        // when true, only step(dt) advances the effects (deterministic tests)
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.onFlash = null;
    this._wx = 0; this._wz = 0; // scratch output of _cellWorld (no per-frame allocation)

    const mk = (n, fs, blending) => {
      const geo = new BufferGeometry();
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
      for (let i = 0; i < n; i++) pos[i * 3 + 1] = -1000;
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.setAttribute('aSize', new BufferAttribute(size, 1));
      const mat = new ShaderMaterial({
        transparent: true, depthWrite: false, blending, vertexColors: true, fog: false,
        uniforms: { uScale: { value: 400 } }, vertexShader: POINT_VS, fragmentShader: fs,
      });
      const pts = new Points(geo, mat);
      pts.frustumCulled = false; pts.renderOrder = 5;
      tower.group.add(pts);
      return { geo, mat, pts, pos, col, size };
    };
    this.sp = mk(MAX_PARTICLES, POINT_FS, NormalBlending);
    this.gl = mk(MAX_GLOW, GLOW_FS, AdditiveBlending);
    this._dirtyPts = true;
  }

  get animating() { return !!this.anim; }
  get debrisCount() { return this.debris.count; }
  get particleCount() { return this.parts.count; }
  get fallingCount() { return this.fall.count; }

  setViewport(h, fovDeg) {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.sp.mat.uniforms.uScale.value = s; this.gl.mat.uniforms.uScale.value = s;
  }

  // ---------- events ----------
  lockPulse(cells) {
    if (cells && cells.length) { let s = 0; for (const c of cells) s += c.col; this.lockCol = Math.round(s / cells.length); }
    if (this.reduced) return;
    for (const c of cells || []) this.pulses.push({ row: c.row, col: c.col, t: 0 });
  }

  shake(a) { if (!this.reduced) this.shakeAmp = Math.max(this.shakeAmp, a * SHAKE_SCALE); }

  /** steps: the `clear` event's steps ([{ rows, count, before, after, moves }]); played one after another. */
  startClear(steps, cols, totalRows) {
    if (this.anim) this.finishClear();
    this.pulses.length = 0;
    this.anim = { steps, i: 0, cols, totalRows, t: 0, phase: 'flash', flash: 0, n: steps[0].count, wave: null, wi: 0, overflow: null, falls: null };
    this._beginStep();
    this.shake(0.1 + 0.08 * Math.min(4, steps[0].count) + 0.03 * (steps.length - 1));
  }

  _beginStep() {
    const a = this.anim, st = a.steps[a.i];
    a.phase = 'flash'; a.t = 0; a.n = st.count; a.flash = FLASH_BASE + 0.03 * Math.min(4, st.count);
    a.wave = null; a.wi = 0; a.overflow = null; a.falls = null;
  }

  finishClear() {
    if (!this.anim) return;
    this.anim = null;
    this._clearFalls();
    this.rebuild();
  }

  _clearFalls() {
    this.fall.reset();
    for (let i = 0; i < this.fallShown.length; i++) if (this.fallShown[i]) { this.tower.hideFall(i); this.fallShown[i] = 0; }
  }

  reset() {
    this.anim = null; this.pulses.length = 0; this.shakeAmp = 0;
    this.debris.reset(); this.parts.reset(); this.glow.reset();
    for (let i = 0; i < this.shown.length; i++) if (this.shown[i]) { this.tower.hideDebris(i); this.shown[i] = 0; }
    this._clearFalls();
    this._dirtyPts = true;
    this.tower.group.position.set(0, 0, 0);
    this.setGameOver(false);
    this.dim = this.dimTarget = 1; this.tower.setDim(1);
  }

  setGameOver(on) { this.dimTarget = on ? 0.42 : 1; }

  /** World (tower-local) x / z of a cell's mid-depth centre into this._wx / this._wz. */
  _cellWorld(col) {
    if (WALL) { this._wx = (col - (COLS - 1) / 2) * TILE_W; this._wz = 0; return; }
    const ang = col * STEP;
    this._wx = Math.sin(ang) * TILE_MID; this._wz = Math.cos(ang) * TILE_MID;
  }

  /** Schedule the wave of bursts for a step + the per-column fall delays. */
  _planWave(st) {
    const a = this.anim, nR = st.rows.length;
    const entries = [];
    const colDelay = new Float32Array(a.cols);
    st.rows.forEach((row, rank) => {
      for (let c = 0; c < a.cols; c++) {
        const id = st.before[row * a.cols + c];
        if (!id) continue;
        const t = burstDelay({ wall: WALL, col: c, cols: a.cols, startCol: this.lockCol, rowRank: rank, base: waveDuration(1) });
        entries.push({ row, col: c, id, t });
        if (t > colDelay[c]) colDelay[c] = t;
      }
    });
    entries.sort((x, y) => x.t - y.t);
    a.wave = entries; a.wi = 0;
    a.perTile = Math.max(1, Math.min(5, Math.round(760 / Math.max(1, entries.length))));
    a.shards = Math.max(2, Math.min(8, Math.round(1100 / Math.max(1, entries.length))));
    a.k = 1 + 0.45 * (Math.min(4, nR) - 1);
    a.waveEnd = entries.length ? entries[entries.length - 1].t : 0;
    this._startFalls(st, colDelay);
  }

  /** One tile bursts: small coloured debris, coloured shards + white sparks, a glow flash. */
  _burstTile(e) {
    const a = this.anim, T = this.tower, D = this.debris, P = this.parts, r = this.rnd, k = a.k;
    T.setTileFx(e.row, e.col, 0);
    const y = (e.row + 0.5) * TILE_H;
    this._cellWorld(e.col);
    const px = this._wx, pz = this._wz, color = TILE_COLORS[e.id] || 0xffffff;
    const ang = e.col * STEP, sx = Math.sin(ang), cz = Math.cos(ang);
    for (let d = 0; d < a.perTile; d++) {
      const out = (4 + r() * 8) * k, up = (3 + r() * 8) * k, tan = (r() - 0.5) * 6;
      let vx, vz, qy, qw;
      if (WALL) { vx = px * 0.5 + (r() - 0.5) * 9; vz = out * 1.3; qy = 0; qw = 1; }
      else { vx = sx * out + cz * tan; vz = cz * out - sx * tan; qy = Math.sin(ang / 2); qw = Math.cos(ang / 2); }
      const size = DEBRIS_SIZE[0] + r() * (DEBRIS_SIZE[1] - DEBRIS_SIZE[0]);
      D.spawn(px + (r() - 0.5) * 0.7, y + (r() - 0.5) * 0.6, pz, vx, up, vz,
        (r() - 0.5) * 24, (r() - 0.5) * 24, (r() - 0.5) * 24, 0, qy, 0, qw, 1.0 + r() * 0.7, size, color);
    }
    for (let s = 0; s < a.shards; s++) {
      const sp = (5 + r() * 10) * k, spark = (s & 1) === 1;
      const vy = (r() - 0.15) * 11 * k;
      if (WALL) P.emit(px, y, pz, px * 0.6 + (r() - 0.5) * 8, vy, sp, 0.5 + r() * 0.6, spark ? 1 : 0, color);
      else P.emit(px, y, pz, sx * sp + (r() - 0.5) * 5, vy, cz * sp + (r() - 0.5) * 5, 0.5 + r() * 0.6, spark ? 1 : 0, color);
    }
    this.glow.emit(px, y, pz, 0, 0, 0, 0.3, 0, color);
    this.shake(0.035 + 0.02 * k);
  }

  /** Cells that must move wait at their old place, then break loose just behind the wave and fall. */
  _startFalls(st, colDelay) {
    const a = this.anim, T = this.tower, F = this.fall, r = this.rnd, mv = st.moves;
    const n = mv.length / 4;
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((x, y) => (mv[y * 4 + 1] - mv[y * 4 + 2]) - (mv[x * 4 + 1] - mv[x * 4 + 2]));
    const overflow = [];
    for (let j = 0; j < n; j++) {
      const i = order[j], c = mv[i * 4], from = mv[i * 4 + 1], to = mv[i * 4 + 2], id = mv[i * 4 + 3];
      const delay = colDelay[c] + 0.06 + r() * 0.08 + to * 0.004;
      const slot = j < OVERFLOW_AT ? F.spawn(c, from, to, delay) : -1;
      if (slot >= 0) { this.fallType[slot] = id; T.setTileFx(from, c, 0); } // leaves the settled set, drawn as a free tile
      else overflow.push({ c, from, to, id, t: delay });
    }
    overflow.sort((x, y) => (x.c - y.c) || (x.from - y.from));
    a.overflow = overflow;
    a.falls = [];
    for (let i = 0; i < F.n; i++) if (F.alive[i]) a.falls.push(i);
  }

  _finishFalls() {
    const a = this.anim, T = this.tower, F = this.fall;
    for (const i of a.falls) {
      if (!F.alive[i]) continue;
      T.setTileFx(Math.round(F.to[i]), F.col[i], this.fallType[i]);
      F.kill(i);
      if (this.fallShown[i]) { T.hideFall(i); this.fallShown[i] = 0; }
    }
    a.falls = null;
  }

  // ---------- per-frame ----------
  /** Advance by dt seconds. Called by the main loop (unless `manual`) and by step(). */
  update(dt) {
    this.time += dt;
    const T = this.tower, a = this.anim;
    // lock pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      const f = p.t / 0.22, id = T.getTile(p.row, p.col);
      if (f >= 1 || !id) { if (id) T.setTileFx(p.row, p.col, id); this.pulses.splice(i, 1); continue; }
      T.setTileFx(p.row, p.col, id, 1 + 0.16 * (1 - f) * (1 - f), -1, p.row, p.col, 1 + 0.6 * (1 - f));
    }
    // clear / cascade state machine
    if (a) {
      a.t += dt;
      const st = a.steps[a.i];
      if (a.phase === 'flash') {
        if (a.t < a.flash) {
          const f = a.t / a.flash;
          for (const row of st.rows) for (let c = 0; c < a.cols; c++) {
            const id = st.before[row * a.cols + c];
            if (id) T.setTileFx(row, c, id, 1 + 0.16 * Math.sin(f * Math.PI), -1, row, c, 1 + 0.9 * f);
          }
        } else {
          this._planWave(st);
          this.onFlash && this.onFlash(st.count, a.waveEnd + 0.25);   // one explosion sound per wave / chain step
          a.phase = 'wave'; a.t = 0;
        }
      } else if (a.phase === 'wave') {
        const w = a.wave;
        while (a.wi < w.length && w[a.wi].t <= a.t) this._burstTile(w[a.wi++]);
        // overflow cells (more movers than animation slots) hop to their destination behind the wave
        const ov = a.overflow;
        if (ov) for (let i = 0; i < ov.length; i++) {
          const o = ov[i];
          if (o && a.t >= o.t) { T.setTileFx(o.from, o.c, 0); T.setTileFx(o.to, o.c, o.id); ov[i] = null; }
        }
        this.fall.step(dt);
        if (a.wi >= w.length && this.fall.allFinished() && (!ov || ov.every((o) => !o))) {
          this._finishFalls(); a.phase = 'gap'; a.t = 0;
        }
      } else if (a.phase === 'gap' && a.t >= STEP_GAP) {
        if (a.i + 1 < a.steps.length) { a.i++; this._beginStep(); this.shake(0.08 + 0.04 * a.i); } else this.finishClear();
      }
    }
    // falling (cascade) tiles
    const F = this.fall;
    for (let i = 0; i < F.n; i++) {
      if (F.alive[i]) {
        T.setFall(i, F.rowAt(i), F.col[i], this.fallType[i], F.t[i] <= 0 ? 1 : 1.15);
        this.fallShown[i] = 1;
      } else if (this.fallShown[i]) { T.hideFall(i); this.fallShown[i] = 0; }
    }
    for (let h = 0; h < F.nLanded; h++) { // impact shards (a few, small, in the tile colour)
      const i = F.landed[h];
      if (this.rnd() < 0.5) {
        this._cellWorld(F.col[i]);
        const y = (F.to[i] + 0.9) * TILE_H, c = TILE_COLORS[this.fallType[i]] || 0xffffff;
        for (let s = 0; s < 3; s++) this.parts.emit(this._wx, y, this._wz, (this.rnd() - 0.5) * 5, 2 + this.rnd() * 3, (this.rnd() - 0.5) * 5, 0.3 + this.rnd() * 0.3, s === 2 ? 1 : 0, c);
      }
    }
    F.nLanded = 0;
    // debris
    const D = this.debris;
    D.step(dt, -24, WATER_Y);
    for (let h = 0; h < D.nHits; h++) {
      const x = D.hits[h * 2], z = D.hits[h * 2 + 1];
      for (let s = 0; s < 4; s++) this.parts.emit(x, WATER_Y + 0.1, z, (this.rnd() - 0.5) * 6, 4 + this.rnd() * 6, (this.rnd() - 0.5) * 6, 0.5 + this.rnd() * 0.4, 2);
    }
    for (let i = 0; i < D.n; i++) {
      if (D.alive[i]) {
        const a3 = i * 3, a4 = i * 4;
        T.setDebris(i, D.p[a3], D.p[a3 + 1], D.p[a3 + 2], D.q[a4], D.q[a4 + 1], D.q[a4 + 2], D.q[a4 + 3], D.scale(i), D.color[i]);
        this.shown[i] = 1;
      } else if (this.shown[i]) { T.hideDebris(i); this.shown[i] = 0; }
    }
    // particles (coloured shards, white sparks, splash) and glow flashes
    const P = this.parts;
    P.step(dt, -18, WATER_Y);
    const S = this.sp;
    let any = false;
    for (let i = 0; i < P.n; i++) {
      const a3 = i * 3;
      if (P.alive[i]) {
        any = true;
        S.pos[a3] = P.p[a3]; S.pos[a3 + 1] = P.p[a3 + 1]; S.pos[a3 + 2] = P.p[a3 + 2];
        const k = P.kind[i];
        if (k === 0) { const h = P.tint[i]; S.col[a3] = ((h >> 16) & 255) / 255; S.col[a3 + 1] = ((h >> 8) & 255) / 255; S.col[a3 + 2] = (h & 255) / 255; }
        else if (k === 1) { S.col[a3] = 1; S.col[a3 + 1] = 0.98; S.col[a3 + 2] = 0.9; }
        else { S.col[a3] = 0.85; S.col[a3 + 1] = 0.95; S.col[a3 + 2] = 1; }
        S.size[i] = (k === 2 ? POINT_SIZE.splash : k === 1 ? POINT_SIZE.spark : POINT_SIZE.shard) * (0.35 + 0.65 * P.fade(i));
      } else if (S.size[i] > 0) { S.size[i] = 0; S.pos[a3 + 1] = -1000; any = true; }
    }
    const G = this.glow, Gs = this.gl;
    G.step(dt, 0, -Infinity);
    for (let i = 0; i < G.n; i++) {
      const a3 = i * 3;
      if (G.alive[i]) {
        any = true;
        Gs.pos[a3] = G.p[a3]; Gs.pos[a3 + 1] = G.p[a3 + 1]; Gs.pos[a3 + 2] = G.p[a3 + 2];
        const l = lighten(G.tint[i], 0.45), f = G.fade(i);
        Gs.col[a3] = l[0]; Gs.col[a3 + 1] = l[1]; Gs.col[a3 + 2] = l[2];
        Gs.size[i] = (1.6 + 3.2 * (1 - f)) * TILE_W * (0.4 + 0.6 * f);
      } else if (Gs.size[i] > 0) { Gs.size[i] = 0; Gs.pos[a3 + 1] = -1000; any = true; }
    }
    if (any || this._dirtyPts) {
      for (const o of [S, Gs]) {
        const g = o.geo;
        g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.aSize.needsUpdate = true;
      }
      this._dirtyPts = false;
    }
    // shake
    this.shakeAmp *= Math.exp(-dt * 8);
    if (this.shakeAmp < 0.002) { this.shakeAmp = 0; T.group.position.set(0, 0, 0); } else {
      T.group.position.set(Math.sin(this.time * 61) * this.shakeAmp, Math.sin(this.time * 83 + 1) * this.shakeAmp, 0);
    }
    // game-over dim
    if (Math.abs(this.dim - this.dimTarget) > 0.002) {
      this.dim += (this.dimTarget - this.dim) * (1 - Math.exp(-dt * 4));
      T.setDim(this.dim);
    }
  }

  /** Deterministic test hook: advance effects by dt seconds (use with manual = true). */
  step(dt) { this.update(dt); }
}

const OVERFLOW_AT = OVERLAY_FALL_COUNT;
