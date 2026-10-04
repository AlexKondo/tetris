// Synthesised WebAudio SFX (no asset files). The AudioContext is created only after a user gesture.
const KEY = 'mahjong-tower-muted';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch (_) { /* storage unavailable */ }
    this.ambient = null;
    this._last = {};
    this.active = true;
  }

  /** Call from a user-gesture handler (click / key / pointerdown). Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._startAmbient();
      }
      this._sync();
    } catch (_) { /* audio unsupported */ }
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch (_) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
    this._sync();
  }

  /** Suspend the context while paused / hidden / muted (stops the ambient loop too). */
  setActive(active) { this.active = active; this._sync(); }

  _sync() {
    if (!this.ctx) return;
    const run = this.active !== false && !this.muted;
    if (run && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    else if (!run && this.ctx.state === 'running') setTimeout(() => { if (this.active === false || this.muted) this.ctx.suspend().catch(() => {}); }, 120);
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

  _startAmbient() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
    const lg = c.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.ambient = g;
  }

  // ----- building blocks -----
  _tone(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, f0, f1, type = 'lowpass', delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    const len = Math.min(dur + 0.02, 1.9);
    s.start(t, Math.random() * (1.95 - len), len);   // offset + length always stay inside the 2 s noise buffer
  }

  _gate(name, minMs) {
    const now = performance.now();
    if (now - (this._last[name] || -1e9) < minMs) return false;
    this._last[name] = now; return true;
  }

  // ----- game sfx -----
  move() { if (this.ready && this._gate('move', 30)) this._tone('triangle', 520, 460, 0.045, 0.1); }
  rotate() { if (this.ready && this._gate('rot', 30)) this._tone('triangle', 420, 760, 0.08, 0.13); }
  lock() { if (!this.ready) return; this._tone('sine', 150, 60, 0.14, 0.4); this._noise(0.05, 0.12, 1800, 400); }
  hardDrop() { if (!this.ready) return; this._tone('sine', 190, 42, 0.22, 0.55); this._noise(0.12, 0.25, 2600, 200); }
  /** Run fn once the context is running; resumes a suspended context first (never silently skipped). */
  _whenRunning(fn) {
    const c = this.ctx;
    if (!c || this.muted || this.active === false) return;
    if (c.state === 'running') { fn(); return; }
    if (c.state === 'suspended' && c.resume) {
      Promise.resolve(c.resume()).then(() => { if (c.state === 'running' && !this.muted && this.active !== false) fn(); }).catch(() => {});
    }
  }

  /**
   * Row-clear explosion for ONE wave (call once per clear step / chain step, when its wave starts):
   * a heavy thump + blast at the start and a rolling crackle spread over `dur` seconds, scaled by the rows cleared.
   * The number of audio nodes is bounded (<= ~16 short sources per call).
   */
  explosion(rows = 1, dur = 0.6, delay = 0) {
    this.explosions = (this.explosions || 0) + 1;
    this._whenRunning(() => {
      const n = Math.min(4, Math.max(1, rows));
      this._tone('sine', 150 + 25 * n, 36, 0.35 + 0.12 * n, 0.5 + 0.06 * n, delay);
      this._noise(0.28 + 0.1 * n, 0.32 + 0.08 * n, 4200, 180, 'lowpass', delay);
      const k = Math.min(14, 3 + 2 * n + Math.round(dur * 6));
      for (let i = 0; i < k; i++) {
        const t = delay + (dur * i) / k;
        this._noise(0.05 + Math.random() * 0.06, 0.1 + 0.03 * n, 7000 - 300 * i, 700, 'bandpass', t);
        if (i % 3 === 0) this._tone('triangle', 320 + Math.random() * 280, 90, 0.09, 0.05 + 0.015 * n, t);
      }
    });
  }

  /** Reward chime for a clear (the explosion itself is `explosion()`, played per wave). */
  clear(count) {
    if (!this.ready) return;
    const n = Math.min(4, count);
    for (let i = 0; i < n + 2; i++) this._tone('triangle', 520 * Math.pow(1.26, i), 520 * Math.pow(1.26, i) * 1.02, 0.18, 0.12, 0.05 + i * 0.06);
  }
  levelUp() {
    if (!this.ready) return;
    [523, 659, 784, 1047].forEach((f, i) => this._tone('square', f, f, 0.16, 0.08, i * 0.09));
  }
  gameOver() {
    if (!this.ready) return;
    [392, 330, 262, 196].forEach((f, i) => this._tone('sawtooth', f, f * 0.97, 0.3, 0.1, i * 0.2));
    this._noise(0.9, 0.15, 900, 80, 'lowpass', 0.4);
  }
}
