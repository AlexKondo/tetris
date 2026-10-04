import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };

async function open(w, h, mobile, query) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&q=high' + query);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  return { ctx, p, tag };
}
const snap = async (p, name) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2200); await p.screenshot({ path: `screenshots/${name}.png`, timeout: 120000 }); };
const ptr = (p, type, x, y) => p.evaluate(([type, x, y]) => document.querySelector('canvas').dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [type, x, y]);

for (const [w, h, mobile] of [[430, 900, true], [1280, 720, false]]) {
  // ---- wall: start screen with mode buttons
  let { ctx, p, tag } = await open(w, h, mobile, '&mode=wall');
  check(`${tag} wall mode active, 12 cols, no wrap`, await p.evaluate(() => window.__game.MODE === 'wall' && window.__game.logic.cols === 12 && window.__game.logic.wrap === false));
  await snap(p, `u2-${tag}-wall-start`);
  // mode buttons on the start screen
  const on = await p.evaluate(() => [...document.querySelectorAll('#modes button')].map((x) => x.dataset.m + ':' + x.classList.contains('on')));
  check(`${tag} start screen shows both modes, wall highlighted`, on.join() === 'cylinder:false,wall:true', on.join());
  await p.evaluate(() => window.__game.start());
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  const c0 = await p.evaluate(() => window.__game.logic.piece.col);
  check(`${tag} wall spawn centred`, c0 === 5, String(c0));
  // piece at the left edge via keyboard
  for (let i = 0; i < 14; i++) await p.keyboard.press('ArrowLeft');
  let st = await p.evaluate(() => window.__game.logic.pieceCells().map((c) => c.col));
  check(`${tag} piece stops at left edge (no wrap)`, Math.min(...st) === 0 && st.every((c) => c <= 3), st.join());
  await snap(p, `u2-${tag}-wall-left-edge`);
  for (let i = 0; i < 20; i++) await p.keyboard.press('ArrowRight');
  st = await p.evaluate(() => window.__game.logic.pieceCells().map((c) => c.col));
  check(`${tag} piece stops at right edge`, Math.max(...st) === 11, st.join());
  // touch swipe moves one column per step and does not wrap
  if (mobile) {
    const before = await p.evaluate(() => window.__game.logic.piece.col);
    await ptr(p, 'pointerdown', 100, 500);
    for (let x = 100; x >= 20; x -= 10) await ptr(p, 'pointermove', x, 500);
    await ptr(p, 'pointerup', 20, 500);
    const after = await p.evaluate(() => window.__game.logic.piece.col);
    check(`${tag} swipe left: 80px = 2 columns (30px/col)`, before - after === 2, `${before}->${after}`);
  }
  // ring clear in the wall
  await p.evaluate(() => {
    const g = window.__game, l = g.logic;
    l.grid.fill(0);
    for (let r = 0; r < 10; r++) for (let c = 0; c < l.cols; c++) l.grid[r * l.cols + c] = c === 5 ? 0 : (c === 0 && r > 6 ? 0 : 1);
    for (let r = 10; r < 14; r++) for (let c = 1; c < l.cols; c++) l.grid[r * l.cols + c] = 1;
    l.grid[9 * l.cols] = 1; l.grid[8 * l.cols] = 1; l.grid[7 * l.cols] = 1;
    g.tower.clear(); g.vfx.reset(); l.emit('restart');
    l.piece = { name: 'I', id: 1, col: 0, row: 20, rot: 1 }; l.lowest = 20;
  });
  await snap(p, `u2-${tag}-wall-pre-clear`);
  await p.keyboard.press('Space');
  await p.evaluate(() => { const v = window.__game.vfx; v.step(0.2); v.step(0.15); });
  const m = await p.evaluate(() => ({ d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount, rings: window.__game.logic.rings }));
  check(`${tag} wall 4-ring clear: 48 debris`, m.d === 48 && m.rings === 4 && m.pa <= 300, JSON.stringify(m));
  await snap(p, `u2-${tag}-wall-explosion`);
  await p.evaluate(() => { for (let i = 0; i < 80; i++) window.__game.vfx.step(0.05); });
  const ok = await p.evaluate(() => { const g = window.__game, l = g.logic; for (let r = 0; r < l.totalRows; r++) for (let c = 0; c < l.cols; c++) if (g.tower.getTile(r, c) !== l.grid[r * l.cols + c]) return false; return !g.vfx.animating; });
  check(`${tag} wall converged after clear`, ok);
  await snap(p, `u2-${tag}-wall-post-clear`);
  await ctx.close();

  // ---- cylinder still fine + switching modes from the start screen persists
  ({ ctx, p, tag } = await open(w, h, mobile, '&mode=cylinder'));
  check(`${tag} cylinder mode active`, await p.evaluate(() => window.__game.MODE === 'cylinder' && window.__game.logic.cols === 36 && window.__game.logic.wrap === true));
  await snap(p, `u2-${tag}-cylinder-start`);
  await p.evaluate(() => window.__game.start());
  await snap(p, `u2-${tag}-cylinder-play`);
  await ctx.close();
}

// switching by clicking the mode button (no ?mode param), persisted in localStorage
{
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(`switch ${m.type()}: ${m.text()}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&q=high');
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.click('#modes button[data-m=wall]');
  await p.waitForFunction(() => window.__game && window.__game.MODE === 'wall', null, { timeout: 120000 });
  check('click PAREDE switches mode (reload)', true);
  const stored = await p.evaluate(() => localStorage.getItem('mahjong-tower-mode'));
  check('mode persisted in localStorage', stored === 'wall', stored);
  await p.evaluate(() => { const l = window.__game.logic; l.score = 300; l.over = true; l.emit('gameOver', { score: 300, level: 1, rings: 0 }); });
  await p.waitForTimeout(800);
  const sw = await p.evaluate(() => document.getElementById('btn-mode-switch').textContent);
  check('game-over offers switching mode', /CILINDRO/.test(sw), sw);
  await p.screenshot({ path: 'screenshots/u2-430x900-wall-gameover.png', timeout: 120000 });
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
