import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };

async function open(w, h, mobile, extra = '') {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&autostart=1&q=high' + extra);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.evaluate(() => { localStorage.removeItem('mahjong-tower-view'); });
  return { ctx, p, tag };
}
const snap = async (p, name) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2200); await p.screenshot({ path: `screenshots/${name}.png`, timeout: 120000 }); };
const state = (p) => p.evaluate(() => { const g = window.__game, l = g.logic; return { col: l.piece.col, rot: l.piece.rot, row: l.piece.row, pitch: +g.stage.pitchDeg.toFixed(1), zoom: +g.stage.zoom.toFixed(2), vp: +g.view.pitch.toFixed(1), vz: +g.view.zoom.toFixed(2) }; });

for (const [w, h, mobile] of [[430, 900, true], [1280, 720, false]]) {
  const { ctx, p, tag } = await open(w, h, mobile);
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  const s0 = await state(p);
  check(`${tag} default pitch 18`, s0.pitch === 18 && s0.zoom === 1, JSON.stringify(s0));
  await snap(p, `u1-${tag}-default`);
  // tilt up to max via buttons (tap/click) - piece must not move/rotate
  for (let i = 0; i < 14; i++) await p.click('#viewctl [data-v=tiltUp]');
  let s = await state(p);
  check(`${tag} max tilt clamps at 55, piece untouched`, s.vp === 55 && s.col === s0.col && s.rot === s0.rot && s.row === s0.row, JSON.stringify(s));
  await snap(p, `u1-${tag}-tilt-max`);
  for (let i = 0; i < 20; i++) await p.keyboard.press('[');
  s = await state(p);
  check(`${tag} min tilt clamps at 8 via keyboard`, s.vp === 8, JSON.stringify(s));
  await snap(p, `u1-${tag}-tilt-min`);
  await p.click('#viewctl [data-v=resetView]');
  for (let i = 0; i < 4; i++) await p.click('#viewctl [data-v=zoomIn]');
  await snap(p, `u1-${tag}-zoom-in`);
  s = await state(p);
  check(`${tag} zoom in`, s.vz < 0.7 && s.vz >= 0.6 && s.col === s0.col, JSON.stringify(s));
  await p.click('#viewctl [data-v=resetView]');
  for (let i = 0; i < 5; i++) await p.keyboard.press('-');
  await snap(p, `u1-${tag}-zoom-out`);
  await p.mouse.move(w / 2, h / 2);
  await p.mouse.wheel(0, -300);
  s = await state(p);
  check(`${tag} wheel zooms in`, s.vz < 1.6 || !mobile, JSON.stringify(s));
  // persistence
  await p.reload();
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  const s2 = await state(p);
  check(`${tag} view persisted across reload`, s2.vz === s.vz && s2.vp === s.vp, JSON.stringify(s2));
  await ctx.close();
}

// 320 HUD fit
{
  const { ctx, p, tag } = await open(320, 568, true);
  const r = await p.evaluate(() => {
    const q = (s) => { const x = document.querySelector(s).getBoundingClientRect(); return [x.left, x.top, x.right, x.bottom]; };
    return { hud: ['#hud .card.next', '#btn-pause', '#btn-mute'].map(q), view: [...document.querySelectorAll('#viewctl button')].map((e) => { const x = e.getBoundingClientRect(); return [x.left, x.top, x.right, x.bottom]; }), hudBottom: Math.max(...['#btn-mute', '#hud .card.main'].map((s) => q(s)[3])) };
  });
  check('320 HUD + view controls inside viewport', [...r.hud, ...r.view].every(([l, t, rr, bb]) => l >= 0 && rr <= 320 && t >= 0 && bb <= 568));
  check('320 view controls do not overlap HUD', r.view[0][1] >= r.hudBottom, `hud bottom ${r.hudBottom} view top ${r.view[0][1]}`);
  await snap(p, 'u1-320x568-hud');
  await ctx.close();
}
for (const [w, h, mobile] of [[360, 640, true], [900, 430, false]]) {
  const { ctx, p, tag } = await open(w, h, mobile);
  const r = await p.evaluate((W) => [...document.querySelectorAll('#hud button, #hud .card, #viewctl button')].every((e) => { const x = e.getBoundingClientRect(); return x.left >= 0 && x.right <= W; }), w);
  check(`${tag} controls inside viewport`, r);
  await snap(p, `u1-${tag}-hud`);
  await ctx.close();
}

// 36-column ring clear
{
  const { ctx, p } = await open(430, 900, true);
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  await p.evaluate(() => {
    const g = window.__game, l = g.logic;
    l.grid.fill(0);
    for (let r = 0; r < 10; r++) for (let c = 0; c < l.cols; c++) l.grid[r * l.cols + c] = c === 5 ? 0 : (c === 0 && r > 6 ? 0 : 1);
    l.grid[9 * l.cols] = 1; l.grid[8 * l.cols] = 1; l.grid[7 * l.cols] = 1;
    for (let r = 10; r < 14; r++) for (let c = 1; c < l.cols; c++) l.grid[r * l.cols + c] = 1;
    g.tower.clear(); g.vfx.reset(); l.emit('restart');
    l.piece = { name: 'I', id: 1, col: 0, row: 20, rot: 1 }; l.lowest = 20;
  });
  check('cols = 44', await p.evaluate(() => window.__game.logic.cols === 44));
  await snap(p, 'u1-ring-pre');
  await p.keyboard.press('Space');
  await p.evaluate(() => { const v = window.__game.vfx; v.step(0.2); v.step(0.15); });
  const m = await p.evaluate(() => ({ d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount, rings: window.__game.logic.rings }));
  check('4 rings x 44 = 176 debris, particles within cap', m.d === 176 && m.pa <= 300 && m.rings === 4, JSON.stringify(m));
  await snap(p, 'u1-ring-mid');
  await p.evaluate(() => { for (let i = 0; i < 80; i++) window.__game.vfx.step(0.05); });
  const ok = await p.evaluate(() => { const g = window.__game, l = g.logic; for (let r = 0; r < l.totalRows; r++) for (let c = 0; c < l.cols; c++) if (g.tower.getTile(r, c) !== l.grid[r * l.cols + c]) return false; return !g.vfx.animating && g.vfx.debrisCount === 0; });
  check('converged: tower matches logic, debris gone', ok);
  await snap(p, 'u1-ring-post');
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
