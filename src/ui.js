import { pieceId, rotatedCells } from './game/index.js';

const SPEAKER = '<path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/>';
const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="22" height="22">' + SPEAKER + '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="22" height="22">' + SPEAKER + '<path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Mobile HUD + overlays (start / pause / game over). Pure DOM. */
import { UNIT, TILE_COLORS } from './config.js';

export function createUI({ onStart, onPause, onResume, onRestart, onMute, onView, onMode, mode = 'cylinder' }) {
  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = `
    <div id="hud">
      <div class="card next"><canvas id="next" width="96" height="96"></canvas><span>next</span></div>
      <div class="card main"><b id="h-score">0</b><span>score</span><small id="h-best">BEST 0</small></div>
      <div class="card"><b id="h-level">1</b><span>level</span></div>
      <div class="card"><b id="h-rings">0</b><span>${UNIT.toLowerCase()}</span></div>
      <div class="btns"><button id="btn-pause" aria-label="Pause">II</button><button id="btn-mute" aria-label="Mute sound"></button></div>
    </div>
    <div id="viewctl" aria-label="View controls" title="Tilt: [ ] / PageUp / PageDown / right-drag.  Zoom: + - / wheel.  Pan: Home End / Shift+PageUp/PageDown / Ctrl-drag or middle-drag.  Reset: 0">
      <div class="vlabel">VISTA</div>
      <button data-v="tiltUp" aria-label="Raise camera (look from above)" title="Tilt up  ( ] / PageUp )">&#9650;</button>
      <div class="vread" id="vread-pitch">18&deg;</div>
      <button data-v="tiltDown" aria-label="Lower camera (look straight on)" title="Tilt down  ( [ / PageDown )">&#9660;</button>
      <button data-v="zoomIn" aria-label="Zoom in" title="Zoom in  ( + )">+</button>
      <div class="vread" id="vread-zoom">1.0x</div>
      <button data-v="zoomOut" aria-label="Zoom out" title="Zoom out  ( - )">&minus;</button>
      <button data-v="panUp" aria-label="Move the view up" title="Picture up  ( Home / Shift+PageUp / Ctrl-drag )" class="small pan">&#8679;</button>
      <button data-v="panDown" aria-label="Move the view down" title="Picture down  ( End / Shift+PageDown / Ctrl-drag )" class="small pan">&#8681;</button>
      <button data-v="resetView" aria-label="Reset view" title="Reset view  ( 0 )" class="small">&#8634;</button>
    </div>
    <div id="popups"></div><div id="levelflash">LEVEL UP</div>
    <div class="overlay" id="ov-start"><h1>TETRIS<br>SUPER TOWER</h1><div class="byline">by Alex Kondo</div><div class="modes" id="modes"><button data-m="cylinder">CILINDRO</button><button data-m="wall">PAREDE</button></div><p>swipe to move &middot; tap to rotate &middot; flick down to drop</p><button class="primary" id="btn-start">TAP TO START</button></div>
    <div class="overlay" id="ov-pause"><h2>PAUSED</h2><button class="primary" id="btn-resume">RESUME</button><button id="btn-restart-p">RESTART</button></div>
    <div class="overlay" id="ov-over"><h2>GAME OVER</h2><div class="final"><b id="o-score">0</b><span>score</span></div><p id="o-best"></p><p id="o-detail"></p><button class="primary" id="btn-restart">RESTART</button><button id="btn-mode-switch"></button></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const els = {
    score: $('#h-score'), level: $('#h-level'), rings: $('#h-rings'),
    start: $('#ov-start'), pause: $('#ov-pause'), over: $('#ov-over'), oScore: $('#o-score'), best: $('#h-best'), oBest: $('#o-best'), oDetail: $('#o-detail'),
  };
  const ctx = $('#next').getContext('2d');
  const tap = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  tap($('#btn-start'), onStart); tap($('#btn-pause'), onPause); tap($('#btn-resume'), onResume);
  tap($('#btn-mute'), onMute);
  for (const b of root.querySelectorAll('#modes button')) {
    b.classList.toggle('on', b.dataset.m === mode);
    tap(b, () => onMode(b.dataset.m));
  }
  const other = mode === 'wall' ? 'cylinder' : 'wall';
  const sw = $('#btn-mode-switch');
  sw.textContent = 'PLAY ' + (other === 'wall' ? 'PAREDE' : 'CILINDRO');
  tap(sw, () => onMode(other));
  for (const b of root.querySelectorAll('#viewctl button')) {
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    tap(b, () => onView(b.dataset.v));
  }
  tap($('#btn-restart'), onRestart); tap($('#btn-restart-p'), onRestart);

  let lastNext = null;
  const vp = $('#vread-pitch'), vz = $('#vread-zoom');
  const popups = $('#popups'), lvl = $('#levelflash'), muteBtn = $('#btn-mute');
  return {
    root, els,
    setView(pitch, zoom) {
      vp.textContent = Math.round(pitch) + '\u00b0';
      vz.textContent = (1 / zoom).toFixed(1) + 'x';
    },
    setMuted(m) {
      muteBtn.classList.toggle('muted', m); muteBtn.setAttribute('aria-pressed', String(m));
      muteBtn.innerHTML = m ? SPEAKER_OFF : SPEAKER_ON;
    },
    setBest(best, isNew = false) {
      els.best.textContent = 'BEST ' + best;
      els.oBest.textContent = isNew ? 'NEW BEST!' : 'best ' + best;
      els.oBest.classList.toggle('newbest', isNew);
    },
    /** Floating text popup (e.g. "+300"). big = multi-ring. */
    popup(text, big = false) {
      const d = document.createElement('div');
      d.className = 'popup' + (big ? ' big' : '');
      d.textContent = text;
      popups.appendChild(d);
      setTimeout(() => d.remove(), 1400);
    },
    levelFlash(level) {
      lvl.textContent = 'LEVEL ' + level;
      lvl.classList.remove('go'); void lvl.offsetWidth; lvl.classList.add('go');
    },
    setStats(g) {
      els.score.textContent = g.score; els.level.textContent = g.level; els.rings.textContent = g.rings;
      els.oScore.textContent = g.score; els.oDetail.textContent = `level ${g.level} · ${g.rings} ${UNIT.toLowerCase()}`;
    },
    setState(state) {
      root.dataset.state = state;
      els.start.style.display = state === 'ready' ? 'flex' : 'none';
      els.pause.style.display = state === 'paused' ? 'flex' : 'none';
      els.over.style.display = state === 'over' ? 'flex' : 'none';
    },
    setNext(name) {
      if (name === lastNext) return;
      lastNext = name;
      ctx.clearRect(0, 0, 96, 96);
      if (!name) return;
      const cells = rotatedCells(name, 0);
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX + 1, h = maxY - minY + 1, s = 22;
      const ox = (96 - w * s) / 2, oy = (96 - h * s) / 2;
      for (const [x, y] of cells) {
        const px = ox + (x - minX) * s, py = oy + (maxY - y) * s;
        const base = hex(TILE_COLORS[pieceId(name)]);
        ctx.fillStyle = base; ctx.beginPath(); ctx.roundRect(px + 1, py + 1, s - 2, s - 2, 5); ctx.fill();
        const g = ctx.createLinearGradient(0, py, 0, py + s);       // soft top highlight / bottom shade
        g.addColorStop(0, 'rgba(255,255,255,.38)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(px + 1, py + 1, s - 2, s - 2, 5); ctx.fill();
      }
    },
  };
}
