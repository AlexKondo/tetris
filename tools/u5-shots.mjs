import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
for (const [w, h, mobile] of [[1536, 820, false], [430, 900, true]]) for (const mode of ['cylinder', 'wall']) for (const nrows of [1, 4]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h} ${mode} ${nrows}-row`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.evaluate((n) => {
    const g = window.__game, l = g.logic, C = l.cols; g.vfx.manual = true;
    l.cascade = false;                       // isolate the explosion from the collapse animation
    l.grid.fill(0);
    for (let r = 0; r < 10; r++) for (let c = 0; c < C; c++) l.grid[r * C + c] = c === 5 ? 0 : (c === 0 && r > 6 ? 0 : 1);
    l.grid[9 * C] = 1; l.grid[8 * C] = 1; l.grid[7 * C] = 1;
    for (let r = 10; r < 10 + n; r++) for (let c = 1; c < C; c++) l.grid[r * C + c] = 1;
    g.tower.clear(); g.vfx.reset(); l.emit('restart');
    l.piece = { name: 'I', id: 1, col: 0, row: 10 + n + 8, rot: 1 }; l.lowest = l.piece.row;
  }, nrows);
  await p.keyboard.press('Space');
  await p.evaluate(() => { const v = window.__game.vfx; v.step(0.16); v.step(0.14); v.step(0.1); });
  const m = await p.evaluate(() => ({ d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount, rings: window.__game.logic.rings }));
  check(`${tag} within caps`, m.d <= 256 && m.pa <= 300 && m.rings >= 1, JSON.stringify(m));
  await p.evaluate(() => window.__game.snapCamera());
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `screenshots/u5-explosion-${w}x${h}-${mode}-${nrows}row.png`, timeout: 120000 });
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
