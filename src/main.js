import { createStage } from './scene.js';
import { Tower, OVERLAY_ACTIVE } from './tower.js';
import { SUN_DIR } from './environment.js';
import { Game, mulberry32, rotatedCells } from './game/index.js';
import { GameAudio } from './audio.js';
import { Vfx } from './vfx.js';
import { Persistence } from './persistence.js';
import { loadView, saveView, stepPitch, stepZoom, stepPan, sanitizeView, clampPitch, clampPan } from './view.js';
import { CAMERA } from './config.js';
import { createMonitor, pushFrame, levelFromParam } from './quality.js';
import { COLS, ROWS, BUFFER_ROWS, TILE_H, MODE, MODES, WALL, MODE_KEY, UNIT, MAX_STACK_ROWS, DANGER_ROWS, SPAWN_GAP_ROWS, SEED_ROWS } from './config.js';
import { attachPointerInput } from './input.js';
import { createUI } from './ui.js';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const gravityOn = params.get('gravity') !== '0'; // ?gravity=0 freezes auto-fall (tests / screenshots)
const makeRng = (seed) => (seed !== null && seed !== undefined && seed !== '' ? mulberry32(Number(seed)) : Math.random);

const stage = createStage(document.getElementById('app'));
const tower = new Tower();
stage.scene.add(tower.group);

const logic = new Game({
  rng: makeRng(seedParam), rows: ROWS, buffer: BUFFER_ROWS, initialStack: true, relativeSpawn: true,
  spawnGap: SPAWN_GAP_ROWS, seedRows: SEED_ROWS, maxStack: MAX_STACK_ROWS, cascade: true,
  cols: COLS, wrap: MODES[MODE].wrap, spawnCol: WALL ? Math.floor((COLS - 1) / 2) : 0,
  // next piece appears at the column currently facing the camera, so the view does not swing back after a lock
  spawnHint: () => { const f = -tower.group.rotation.y / ((Math.PI * 2) / COLS); return ((f % COLS) + COLS) % COLS; },
});

const ACTIVE_BOOST = 1.35; // the falling piece glows a little brighter than settled tiles of the same colour

const audio = new GameAudio();
const persistence = new Persistence('/api', MODE);
let runStart = performance.now();
const qParam = params.get('q');            // ?q=low | mid forces a level, ?q=high disables adaptation
const qMon = createMonitor({ level: levelFromParam(qParam), maxLevel: qParam === 'high' ? 0 : 2 });
if (qMon.level > 0) stage.setQuality(qMon.level);
const audioActive = () => !document.hidden && state !== 'paused';

// ---------- game state machine: ready -> playing <-> paused -> over ----------
let state = 'ready';
const ui = createUI({
  onStart: () => start(),
  onPause: () => togglePause(),
  onResume: () => togglePause(),
  onRestart: () => restart(),
  mode: MODE,
  onMode: (m) => switchMode(m),
  onView: (a) => viewAction(a),
  onMute: () => { audio.setMuted(!audio.muted); ui.setMuted(audio.muted); audio.unlock(); },
});
ui.setMuted(audio.muted);
/** Switch game mode: remember it and reload so the tower is rebuilt for the new layout (this restarts the game). */
function switchMode(m) {
  if (m === MODE || !MODES[m]) return;
  try { localStorage.setItem(MODE_KEY, m); } catch (_) { /* ignore */ }
  const u = new URL(location.href);
  u.searchParams.set('mode', m);
  location.href = u.toString();
}
function setState(s) { state = s; ui.setState(s); audio.setActive(audioActive()); }
function start() { audio.unlock(); if (state === 'ready') { runStart = performance.now(); setState('playing'); } }
function togglePause() {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') setState('playing');
}
function restart() {
  audio.unlock();
  logic.restart(makeRng(seedParam));
  runStart = performance.now();
  setState('playing');
}
setState('ready');
if (params.has('autostart')) setState('playing');
ui.setBest(persistence.best);
persistence.onBest = (b) => ui.setBest(b);
persistence.load();

// ---------- state -> tower ----------
let settledDirty = true, pieceDirty = true, hudDirty = true;
let stackTop = logic.stackTop();
function syncSettled() {
  const { grid, totalRows, cols } = logic;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid[r * cols + c];   // tile id = colour index
      if (tower.getTile(r, c) !== t) tower.setTile(r, c, t);
    }
  }
  stackTop = logic.stackTop();
  tower.setShadowRows(stackTop);
  stage.shadowDirty = true;
}
const vfx = new Vfx(tower, () => { tower.clear(); syncSettled(); });
vfx.onFlash = (count, dur) => audio.explosion(count, dur);   // every wave / chain step booms in sync with its burst
let inHard = false;

function syncPiece() {
  tower.hideOverlayRange(OVERLAY_ACTIVE, 4);
  tower.hideGhost();
  const p = logic.piece;
  if (!p || logic.over) return;
  const cells = logic.pieceCells();
  const drop = p.row - logic.landingRow();
  if (drop > 0) for (let i = 0; i < cells.length; i++) tower.setGhost(i, cells[i].row - drop, cells[i].col);
  for (let i = 0; i < cells.length; i++) {
    tower.setOverlay(OVERLAY_ACTIVE + i, cells[i].row, cells[i].col, p.id, -1, ACTIVE_BOOST);
  }
}

logic.on('lock', (e) => {
  if (vfx.animating) vfx.finishClear();
  syncSettled();                       // grid is pre-clear here (clear, if any, is emitted next)
  vfx.lockPulse(e.cells);
  pieceDirty = true; hudDirty = true;
  if (!inHard) audio.lock();
});
logic.on('clear', (e) => {
  vfx.startClear(e.steps, logic.cols, logic.totalRows);
  audio.clear(e.count + e.chain - 1);
  ui.popup('+' + e.gain, e.count >= 2 || e.chain >= 2);
  if (e.chain >= 2) ui.popup('CHAIN x' + e.chain + '!', true);
  else if (e.count >= 2) ui.popup(e.count + ' ' + UNIT + '!', true);
  pieceDirty = true; hudDirty = true;
});
logic.on('restart', () => { vfx.reset(); tower.clear(); syncSettled(); pieceDirty = true; hudDirty = true; });
logic.on('level', (e) => { hudDirty = true; ui.levelFlash(e.level); audio.levelUp(); });
logic.on('spawn', () => { hudDirty = true; pieceDirty = true; });
logic.on('gameOver', (e) => {
  hudDirty = true; pieceDirty = true; setState('over'); vfx.setGameOver(true); audio.gameOver();
  const prev = persistence.best;
  persistence.saveRun({ score: e.score, lines: e.rings, level: e.level, durationMs: performance.now() - runStart });
  ui.setBest(persistence.best, e.score > prev && e.score > 0);
});

// ---------- camera: rotate the tower so the active piece stays front-centre; aim at the stack top ----------
const STEP = (Math.PI * 2) / COLS;
let rotTarget = 0;
function followCamera(dt, snap = false) {
  const p = logic.piece;
  if (p && !WALL) { // the flat wall stays frontal; only the cylinder turns to follow the piece
    const cells = rotatedCells(p.name, p.rot);
    let m = 0; for (const c of cells) m += c[0];
    const want = -(p.col + m / cells.length) * STEP;
    let d = want - tower.group.rotation.y;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; // shortest path
    rotTarget = tower.group.rotation.y + d;
  }
  const k = snap ? 1 : 1 - Math.exp(-dt * 8);
  const rot0 = tower.group.rotation.y;
  tower.setRotation(rot0 + (rotTarget - rot0) * k);
  if (tower.group.rotation.y !== rot0) stage.shadowDirty = true;
  const wantY = Math.max(10, stackTop * TILE_H);
  const ky = snap ? 1 : 1 - Math.exp(-dt * 3);
  const y = stage.rimY + (wantY - stage.rimY) * ky;
  // user view (tilt + zoom), smoothed; zoom is eased in log space
  const kv = snap ? 1 : 1 - Math.exp(-dt * 9);
  const pitch = stage.pitchDeg + (view.pitch - stage.pitchDeg) * kv;
  const zoom = Math.exp(Math.log(stage.zoom) + (Math.log(view.zoom) - Math.log(stage.zoom)) * kv);
  const pan = stage.pan + (view.pan - stage.pan) * kv;
  ui.setView(view.pitch, view.zoom);
  const changed = Math.abs(y - stage.rimY) > 1e-3 || Math.abs(pitch - stage.pitchDeg) > 1e-3 || Math.abs(zoom - stage.zoom) > 1e-4 || Math.abs(pan - stage.pan) > 1e-4;
  if (!changed && !snap) return;
  stage.rimY = y; stage.pitchDeg = pitch; stage.zoom = zoom; stage.pan = pan;
  stage.frame();
}

// ---------- user view: tilt / zoom (persisted) ----------
const view = loadView();
stage.pitchDeg = view.pitch; stage.zoom = view.zoom; stage.pan = view.pan;
let saveTimer = 0;
function saveViewSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveView(view), 300); }
function viewAction(a) {
  if (a === 'tiltUp') view.pitch = stepPitch(view.pitch, 1);
  else if (a === 'tiltDown') view.pitch = stepPitch(view.pitch, -1);
  else if (a === 'zoomIn') view.zoom = stepZoom(view.zoom, 1);
  else if (a === 'zoomOut') view.zoom = stepZoom(view.zoom, -1);
  else if (a === 'panUp') view.pan = stepPan(view.pan, -1);       // picture moves up
  else if (a === 'panDown') view.pan = stepPan(view.pan, 1);      // picture moves down
  else if (a === 'resetView') Object.assign(view, sanitizeView({ pitch: CAMERA.pitchDeg, zoom: 1, pan: 0 }));
  else return false;
  saveView(view);
  return true;
}

// ---------- input ----------
const playing = () => state === 'playing';
function act(a) {
  if (viewAction(a)) return;                       // view keys never touch the game
  if (a === 'restart') { restart(); }
  else if (a === 'pause') togglePause();
  else if (playing()) {
    switch (a) {
      case 'left': if (logic.moveLeft()) audio.move(); break;
      case 'right': if (logic.moveRight()) audio.move(); break;
      case 'rotate': if (logic.rotate()) audio.rotate(); break;
      case 'down': if (logic.softDrop()) audio.move(); break;
      case 'drop': {
        inHard = true;
        const dist = logic.hardDrop();
        inHard = false;
        audio.hardDrop(); vfx.shake(dist > 0 ? 0.12 : 0.05);
        break;
      }
      default: return;
    }
  } else return;
  pieceDirty = true; hudDirty = true;
}
const KEYS = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'rotate', w: 'rotate', W: 'rotate',
  ArrowDown: 'down', s: 'down', S: 'down',
  ' ': 'drop', Spacebar: 'drop',
  r: 'restart', R: 'restart',
  '[': 'tiltDown', ']': 'tiltUp', PageDown: 'tiltDown', PageUp: 'tiltUp',
  Home: 'panUp', End: 'panDown',
  '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '_': 'zoomOut', '0': 'resetView',
  p: 'pause', P: 'pause', Escape: 'pause',
};
// Chrome only counts pointerup / click / touchend / keydown as user activation for audio
for (const t of ['pointerup', 'click', 'touchend', 'keydown']) window.addEventListener(t, () => audio.unlock(), { capture: true, passive: true });
window.addEventListener('keydown', (e) => {
  let a = KEYS[e.key];
  if (e.shiftKey && e.key === 'PageUp') a = 'panUp';        // Shift+PageUp / PageDown pan the picture
  else if (e.shiftKey && e.key === 'PageDown') a = 'panDown';
  if (state === 'ready' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); start(); return; }
  if (state === 'over' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); restart(); return; }
  if (!a) return;
  e.preventDefault();
  if (a === 'restart' && state !== 'paused' && state !== 'over') return; // R only restarts from pause / game over
  if (e.repeat && (a === 'resetView' || a === 'drop' || a === 'restart' || a === 'rotate' || a === 'pause')) return;
  act(a);
});
const canvas = stage.renderer.domElement;
canvas.addEventListener('wheel', (e) => { e.preventDefault(); viewAction(e.deltaY < 0 ? 'zoomIn' : 'zoomOut'); }, { passive: false });
const pointer = attachPointerInput(canvas, {
  left: () => act('left'), right: () => act('right'), rotate: () => act('rotate'),
  softDrop: () => act('down'), hardDrop: () => act('drop'),
  tilt: (deg) => { view.pitch = clampPitch(view.pitch + deg); saveViewSoon(); },
  pan: (frac) => { view.pan = clampPan(view.pan + frac); saveViewSoon(); },
}, playing);

// block page scroll / pinch-zoom / double-tap zoom on iOS
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
  audio.setActive(audioActive());
});

const snapCamera = () => followCamera(0, true);
window.__game = {
  snapCamera, renderer: stage.renderer, scene: stage.scene, camera: stage.camera, stage, tower, logic, act, COLS, ROWS,
  ui, vfx, audio, persistence, qMon, view, viewAction, MODE, switchMode, start, restart, togglePause, get state() { return state; },
};

// ---------- optional debug FPS counter (?debug) ----------
let fpsEl = null;
if (params.has('debug')) {
  fpsEl = document.createElement('div');
  fpsEl.id = 'fps';
  fpsEl.textContent = '-- fps';
  document.body.appendChild(fpsEl);
}
let frames = 0, last = performance.now(), prev = last;

function tick(now) {
  if (document.hidden) { prev = now; requestAnimationFrame(tick); return; } // no GPU work in background tabs
  const raw = now - prev;
  const dt = Math.min(raw, 250);
  prev = now;
  const lvl = pushFrame(qMon, raw);
  if (lvl !== null) stage.setQuality(lvl);
  const pr = logic.piece, sr = pr && pr.row, sc = pr && pr.col, sot = pr && pr.rot, sid = pr && pr.id;
  if (gravityOn && state === 'playing') logic.update(dt);
  const q = logic.piece;
  if (q !== pr || (q && (q.row !== sr || q.col !== sc || q.rot !== sot || q.id !== sid))) pieceDirty = true;
  if (settledDirty && !vfx.animating) { syncSettled(); settledDirty = false; hudDirty = true; }
  if (pieceDirty) { syncPiece(); pieceDirty = false; }
  if (hudDirty) {
    ui.setStats(logic); ui.setNext(logic.nextName); hudDirty = false;
    if (state !== 'over') ui.setBest(Math.max(persistence.best, logic.score));
  }
  if (!vfx.manual && state !== 'paused') vfx.update(dt / 1000);
  vfx.setViewport(canvas.height, stage.camera.fov);
  followCamera(dt / 1000);
  stage.update(now / 1000);
  if (tower.flush() || vfx.shakeAmp > 0) stage.shadowDirty = true;
  tower.setDanger(stackTop >= DANGER_ROWS && state === 'playing', now / 1000);
  stage.render();
  frames++;
  if (now - last >= 500) {
    if (fpsEl) fpsEl.textContent = `${Math.round((frames * 1000) / (now - last))} fps  ${stage.renderer.info.render.calls} calls`;
    window.__game.fps = (frames * 1000) / (now - last);
    frames = 0; last = now;
  }
  requestAnimationFrame(tick);
}
followCamera(0, true);
requestAnimationFrame(tick);
