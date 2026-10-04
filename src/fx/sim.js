// Pure (no Three.js) ballistic simulations for ring-clear VFX. Preallocated typed arrays, no per-step allocation.

/** Tumbling tile debris. Positions are tower-local; y is up. */
export class DebrisSim {
  constructor(n) {
    this.n = n;
    this.alive = new Uint8Array(n);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.w = new Float32Array(n * 3);   // angular velocity (rad/s) about x,y,z
    this.q = new Float32Array(n * 4);   // orientation quaternion x,y,z,w
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);    // base visual scale (1 = a full tile)
    this.color = new Uint32Array(n);    // tile colour (hex)
    this.hits = new Float32Array(n * 2); // x,z where debris entered the water this step
    this.nHits = 0;
    this.cursor = 0;
  }

  get count() { let c = 0; for (let i = 0; i < this.n; i++) c += this.alive[i]; return c; }

  /** Spawn into the next free slot (round robin). Returns slot index or -1 if the pool is full. */
  spawn(px, py, pz, vx, vy, vz, wx, wy, wz, qx, qy, qz, qw, maxLife, size = 1, color = 0xffffff) {
    for (let k = 0; k < this.n; k++) {
      const i = (this.cursor + k) % this.n;
      if (this.alive[i]) continue;
      this.cursor = (i + 1) % this.n;
      const a = i * 3, b = i * 4;
      this.alive[i] = 1; this.life[i] = 0; this.maxLife[i] = maxLife; this.size[i] = size; this.color[i] = color;
      this.p[a] = px; this.p[a + 1] = py; this.p[a + 2] = pz;
      this.v[a] = vx; this.v[a + 1] = vy; this.v[a + 2] = vz;
      this.w[a] = wx; this.w[a + 1] = wy; this.w[a + 2] = wz;
      this.q[b] = qx; this.q[b + 1] = qy; this.q[b + 2] = qz; this.q[b + 3] = qw;
      return i;
    }
    return -1;
  }

  /** Visual scale: size * (1 at launch, shrinking steadily to 0 by the end of life). */
  scale(i) {
    const f = this.life[i] / this.maxLife[i];
    return this.size[i] * Math.max(0, 1 - 0.55 * f - (f > 0.6 ? (f - 0.6) * 1.125 : 0));
  }

  kill(i) { this.alive[i] = 0; }
  reset() { this.alive.fill(0); this.nHits = 0; }

  step(dt, gravity = -24, waterY = -Infinity) {
    this.nHits = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const a = i * 3, b = i * 4;
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.alive[i] = 0; continue; }
      this.v[a + 1] += gravity * dt;
      this.p[a] += this.v[a] * dt; this.p[a + 1] += this.v[a + 1] * dt; this.p[a + 2] += this.v[a + 2] * dt;
      if (this.p[a + 1] < waterY) {
        this.alive[i] = 0;
        this.hits[this.nHits * 2] = this.p[a]; this.hits[this.nHits * 2 + 1] = this.p[a + 2]; this.nHits++;
        continue;
      }
      // q += 0.5 * dt * (0,w) * q ; normalise
      const wx = this.w[a], wy = this.w[a + 1], wz = this.w[a + 2];
      const qx = this.q[b], qy = this.q[b + 1], qz = this.q[b + 2], qw = this.q[b + 3];
      const h = 0.5 * dt;
      let nx = qx + h * (wx * qw + wy * qz - wz * qy);
      let ny = qy + h * (wy * qw + wz * qx - wx * qz);
      let nz = qz + h * (wz * qw + wx * qy - wy * qx);
      let nw = qw + h * (-wx * qx - wy * qy - wz * qz);
      const l = 1 / Math.hypot(nx, ny, nz, nw);
      this.q[b] = nx * l; this.q[b + 1] = ny * l; this.q[b + 2] = nz * l; this.q[b + 3] = nw * l;
    }
  }
}

/** Small point particles (shards, splash). kind: 0 gold shard, 1 ivory shard, 2 water splash. */
export class ParticleSim {
  constructor(n) {
    this.n = n;
    this.alive = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.tint = new Uint32Array(n);     // colour of kind-0 particles (hex)
    this.cursor = 0;
  }

  get count() { let c = 0; for (let i = 0; i < this.n; i++) c += this.alive[i]; return c; }

  /** Emit into the next free slot; when full, overwrite the oldest cursor slot (hard cap = n). */
  emit(px, py, pz, vx, vy, vz, maxLife, kind, tint = 0xffffff) {
    const i = this.cursor; this.cursor = (i + 1) % this.n;
    const a = i * 3;
    this.alive[i] = 1; this.kind[i] = kind; this.tint[i] = tint; this.life[i] = 0; this.maxLife[i] = maxLife;
    this.p[a] = px; this.p[a + 1] = py; this.p[a + 2] = pz;
    this.v[a] = vx; this.v[a + 1] = vy; this.v[a + 2] = vz;
    return i;
  }

  /** 1 -> 0 over life. */
  fade(i) { return 1 - this.life[i] / this.maxLife[i]; }
  reset() { this.alive.fill(0); }

  step(dt, gravity = -18, waterY = -Infinity) {
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const a = i * 3;
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.alive[i] = 0; continue; }
      this.v[a + 1] += gravity * dt * (this.kind[i] === 2 ? 0.6 : 1);
      this.p[a] += this.v[a] * dt; this.p[a + 1] += this.v[a + 1] * dt; this.p[a + 2] += this.v[a + 2] * dt;
      if (this.p[a + 1] < waterY && this.kind[i] !== 2) this.alive[i] = 0;
      else if (this.kind[i] === 2 && this.p[a + 1] < waterY) this.alive[i] = 0;
    }
  }
}

/**
 * Settled tiles that break loose and fall to their new row (cascade collapse). Rows are fractional.
 * Each cell has a start delay (stagger), falls under gravity, then bounces a little.
 */
export class FallSim {
  constructor(n) {
    this.n = n;
    this.alive = new Uint8Array(n);
    this.col = new Int16Array(n);
    this.from = new Float32Array(n);
    this.to = new Float32Array(n);
    this.t = new Float32Array(n);       // negative while waiting for its delay
    this.T = new Float32Array(n);       // fall duration
    this.landed = new Int16Array(n);    // indices that hit the ground during the last step()
    this.nLanded = 0;
    this.impact = new Uint8Array(n);
  }

  static G = 70;          // rows / s^2
  static BOUNCE = 0.2;    // seconds

  get count() { let c = 0; for (let i = 0; i < this.n; i++) c += this.alive[i]; return c; }
  reset() { this.alive.fill(0); this.impact.fill(0); this.nLanded = 0; }

  spawn(col, fromRow, toRow, delay) {
    for (let i = 0; i < this.n; i++) {
      if (this.alive[i]) continue;
      this.alive[i] = 1; this.col[i] = col; this.from[i] = fromRow; this.to[i] = toRow;
      this.t[i] = -delay; this.impact[i] = 0;
      this.T[i] = Math.sqrt((2 * Math.max(0, fromRow - toRow)) / FallSim.G);
      return i;
    }
    return -1;
  }

  /** Current fractional row of cell i. */
  rowAt(i) {
    const t = this.t[i];
    if (t <= 0) return this.from[i];
    if (t < this.T[i]) return Math.max(this.to[i], this.from[i] - 0.5 * FallSim.G * t * t);
    const tb = Math.min(FallSim.BOUNCE, t - this.T[i]);
    const amp = Math.min(0.3, 0.05 * (this.from[i] - this.to[i]));
    return this.to[i] + amp * Math.abs(Math.sin((Math.PI * tb) / FallSim.BOUNCE)) * (1 - tb / FallSim.BOUNCE);
  }

  /** Advance; returns the number of cells that FINISHED (settled) this step; they stay `alive` until collected. */
  step(dt) {
    this.nLanded = 0;
    let finished = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const before = this.t[i];
      this.t[i] += dt;
      if (before < this.T[i] && this.t[i] >= this.T[i]) { this.impact[i] = 1; this.landed[this.nLanded++] = i; }
      if (this.t[i] >= this.T[i] + FallSim.BOUNCE) finished++;
    }
    return finished;
  }

  finished(i) { return this.t[i] >= this.T[i] + FallSim.BOUNCE; }
  allFinished() { for (let i = 0; i < this.n; i++) if (this.alive[i] && !this.finished(i)) return false; return true; }
  kill(i) { this.alive[i] = 0; }
}
