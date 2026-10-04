import test from 'node:test';
import assert from 'node:assert/strict';

// Simulate blocked storage (private mode / disabled cookies): merely READING `localStorage` throws.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
});

const { loadView, saveView, sanitizeView } = await import('../src/view.js');
const cfg = await import('../src/config.js');
const { Persistence } = await import('../src/persistence.js');
const { GameAudio } = await import('../src/audio.js');
const { frameFor } = await import('../src/aim.js');

test('view.js survives a throwing localStorage getter', () => {
  assert.doesNotThrow(() => loadView());
  assert.deepEqual(loadView(), sanitizeView(null));
  assert.doesNotThrow(() => saveView({ pitch: 20, zoom: 1 }));
});

test('config mode detection survives blocked storage (defaults to cylinder)', () => {
  assert.equal(cfg.detectMode(), 'cylinder');
  assert.equal(cfg.COLS, 63);
});

test('persistence and audio constructors survive blocked storage', () => {
  let p;
  assert.doesNotThrow(() => { p = new Persistence('/api', 'wall'); });
  assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(p.playerId));
  assert.equal(p.best, 0);
  let a;
  assert.doesNotThrow(() => { a = new GameAudio(); });
  assert.doesNotThrow(() => a.setMuted(true));
});

// ---- camera aim: the spawn/landing band stays on screen for every view combination ----
const SIZES = [[430, 900], [900, 430], [1280, 720], [360, 640], [320, 568], [1920, 1080]];
test('frameFor keeps the piece band between the HUD and the bottom edge (pitch x zoom matrix, both modes)', () => {
  let checked = 0;
  for (const wall of [false, true]) {
    const cols = wall ? cfg.MODES.wall.cols : cfg.MODES.cylinder.cols;
    for (const [w, h] of SIZES) for (const pitchDeg of [8, 18, 35, 55]) for (const zoom of [0.6, 1, 1.8]) for (const rimY of [20, 31, 42]) {
      const f = frameFor({ w, h, wall, cols, pitchDeg, zoom, rimY });
      const tag = `${wall ? 'wall' : 'cyl'} ${w}x${h} pitch ${pitchDeg} zoom ${zoom} rim ${rimY}`;
      assert.ok(f.topNdc <= f.limitTop + 1e-6, `top under HUD: ${tag} top=${f.topNdc.toFixed(3)} limit=${f.limitTop.toFixed(3)}`);
      assert.ok(f.bottomNdc >= -1 + 0.12 - 1e-6, `landing zone off screen: ${tag} bottom=${f.bottomNdc.toFixed(3)}`);
      assert.ok(f.zoom >= Math.min(zoom, 1.8) - 1e-9, tag);
      checked++;
    }
  }
  assert.equal(checked, 2 * SIZES.length * 4 * 3 * 3);
});

test('frameFor leaves the default view untouched in portrait', () => {
  const f = frameFor({ w: 430, h: 900, wall: false, cols: 44, pitchDeg: 18, zoom: 1, rimY: 31 });
  assert.equal(f.zoom, 1);
});

// ---- zoom-out centring + pan ----
const MODES_LIST = [false, true];
test('zoom-out re-centres the playfield vertically instead of gluing it to the top', () => {
  for (const wall of MODES_LIST) {
    const cols = wall ? cfg.MODES.wall.cols : cfg.MODES.cylinder.cols;
    for (const [w, h] of [[1536, 820], [1920, 1080], [1894, 905], [430, 900]]) {
      const f1 = frameFor({ w, h, wall, cols, pitchDeg: 20, zoom: 0.6, rimY: 14.3 });
      const tag = `${wall ? 'wall' : 'cyl'} ${w}x${h}`;
      if (!f1.centred) { assert.ok(f1.baseNdc < -0.9, `${tag}: not centred but the base is on screen (${f1.baseNdc.toFixed(2)})`); continue; }  // a tower taller than the screen stays top-aligned
      assert.ok(wall, 'wall always fits');
      assert.ok(f1.baseNdc < 0, `${tag}: base must sit in the lower half (ndc ${f1.baseNdc.toFixed(2)})`);
      const mid = (f1.topNdc + f1.baseNdc) / 2;
      assert.ok(Math.abs(mid) <= 1 / 3, `${tag}: content centre ndc ${mid.toFixed(2)} outside the middle third`);
      assert.ok(f1.topNdc <= f1.limitTop + 1e-9 && f1.baseNdc >= -1 + 0.09);
    }
  }
});

test('default zoom is unchanged by the centring (picture still starts under the HUD) and keeps the guarantees', () => {
  const f = frameFor({ w: 430, h: 900, wall: false, cols: 63, pitchDeg: 18, zoom: 1, rimY: 14.3 });
  assert.equal(f.zoom, 1);
  assert.ok(Math.abs(f.topNdc - (f.limitTop - 0.012)) < 1e-9 || f.centred);
});

test('pan moves the picture by the expected amount in both directions, clamped, landing zone never leaves the screen', () => {
  for (const wall of MODES_LIST) {
    const cols = wall ? cfg.MODES.wall.cols : cfg.MODES.cylinder.cols;
    const a = { w: 1536, h: 820, wall, cols, pitchDeg: 20, zoom: 0.6, rimY: 26 };
    const f0 = frameFor(a);
    const down = frameFor({ ...a, pan: 0.04 }), up = frameFor({ ...a, pan: -0.04 });
    if (Math.abs(f0.landNdc) > 0.75) continue;   // landing zone already near the screen edge: the safety clamp legitimately limits the pan
    assert.ok(Math.abs((f0.landNdc - down.landNdc) - 0.08) < 0.005, `down ${(f0.landNdc - down.landNdc).toFixed(3)}`);
    assert.ok(Math.abs((up.landNdc - f0.landNdc) - 0.08) < 0.005, `up ${(up.landNdc - f0.landNdc).toFixed(3)}`);
    assert.ok(f0.baseNdc - down.baseNdc > 0.03 && up.baseNdc - f0.baseNdc > 0.03, 'the whole picture follows in the same direction');
    for (const pan of [-5, -0.35, 0.35, 5]) {
      for (const [w, h] of [[1536, 820], [430, 900], [900, 430]]) for (const zoom of [0.6, 1, 1.8]) for (const pitchDeg of [8, 20, 55]) {
        const f = frameFor({ w, h, wall, cols, pitchDeg, zoom, rimY: 14.3, pan });
        assert.ok(Math.abs(f.landNdc) <= 0.92 + 1e-6, `landing zone off screen: pan ${pan} ${w}x${h} z${zoom} p${pitchDeg}: ${f.landNdc.toFixed(3)}`);
        assert.ok(Math.abs(f.pan) <= 0.35 + 1e-12);
      }
    }
  }
});
