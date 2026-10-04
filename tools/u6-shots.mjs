import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
const failed404 = [];
for (const [w, h, mobile] of [[1536, 820, false], [430, 900, true]]) for (const mode of ['cylinder', 'wall']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h} ${mode}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  p.on('response', r => { if (r.status() >= 400 && !/\/api\//.test(r.url())) failed404.push(`${tag} ${r.status()} ${r.url()}`); });
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  const shot = async (n) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2000); await p.screenshot({ path: `screenshots/u6-${w}x${h}-${mode}-${n}.png`, timeout: 120000 }); };
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  await shot('default');
  for (const nrows of [1, 4]) {
    await p.evaluate((n) => {
      const g = window.__game, l = g.logic, C = l.cols; g.vfx.reset();
      l.grid.fill(0);
      for (let r = 0; r < 10; r++) for (let c = 0; c < C; c++) l.grid[r * C + c] = c === 5 ? 0 : (r % 8) + 8;
      for (let r = 0; r < 10; r++) if (r > 6) l.grid[r * C] = 9;
      for (let r = 10; r < 10 + n; r++) for (let c = 1; c < C; c++) l.grid[r * C + c] = ((r % 8) + 8);
      for (let r = 10 + n; r < 13 + n; r++) for (let c = 8; c < C - 8; c++) if ((c + r) % 3) l.grid[r * C + c] = (r % 8) + 8;   // overhanging blob that must collapse
      g.tower.clear(); l.emit('restart');
      l.piece = { name: 'I', id: 1, col: 0, row: 10 + n + 10, rot: 1 }; l.lowest = l.piece.row;
    }, nrows);
    await p.keyboard.press('Space');
    const info = await p.evaluate(() => ({ anim: window.__game.vfx.animating, rings: window.__game.logic.rings, lockCol: window.__game.vfx.lockCol }));
    check(`${tag} ${nrows}-row clear started`, info.anim && info.rings >= nrows, JSON.stringify(info));
    const cost = [];
    const stepT = (dt) => p.evaluate((d) => { const t0 = performance.now(); window.__game.vfx.step(d); return performance.now() - t0; }, dt);
    await stepT(0.26);                                  // flash done -> wave planned
    const first = await p.evaluate(() => { const a = window.__game.vfx.anim; return a && a.wave && a.wave.length ? { col: a.wave[0].col, last: a.wave[a.wave.length - 1].col, n: a.wave.length } : null; });
    check(`${tag} ${nrows}-row wave starts at the right place`, first && (mode === 'wall' ? first.col <= 1 : Math.abs(first.col - info.lockCol) <= 1), JSON.stringify(first));
    const frames = nrows === 1 ? [0.18, 0.2, 0.3] : [0.15, 0.2, 0.25];
    let maxD = 0, maxP = 0;
    for (let i = 0; i < frames.length; i++) {
      cost.push(await stepT(frames[i]));
      const s = await p.evaluate(() => ({ wi: window.__game.vfx.anim && window.__game.vfx.anim.wi, n: window.__game.vfx.anim && window.__game.vfx.anim.wave ? window.__game.vfx.anim.wave.length : 0, d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount, f: window.__game.vfx.fallingCount }));
      maxD = Math.max(maxD, s.d); maxP = Math.max(maxP, s.pa);
      if (i === 0) check(`${tag} ${nrows}-row mid-wave is partial (${s.wi}/${s.n} burst)`, s.wi > 0 && s.wi < s.n, JSON.stringify(s));
      if (i === 0) await shot(`${nrows}row-wave-a`);
      if (i === 1) await shot(`${nrows}row-wave-b`);
      if (i === 2 && nrows === 4) await shot('4row-peak');
    }
    check(`${tag} ${nrows}-row caps respected`, maxD <= 512 && maxP <= 800, `debris ${maxD} particles ${maxP}`);
    for (let i = 0; i < 60; i++) cost.push(await stepT(0.05));
    const ok = await p.evaluate(() => { const g = window.__game, l = g.logic; for (let r = 0; r < l.totalRows; r++) for (let c = 0; c < l.cols; c++) if (g.tower.getTile(r, c) !== l.grid[r * l.cols + c]) return `mismatch ${r},${c}`; return g.vfx.animating ? 'animating' : 'ok'; });
    check(`${tag} ${nrows}-row converged`, ok === 'ok', ok);
    const peak = Math.max(...cost.slice(0, 6)), avg = cost.slice(0, 20).reduce((x, y) => x + y, 0) / 20;
    console.log(`     vfx.update cost ${nrows}-row: peak ${peak.toFixed(2)} ms, avg ${avg.toFixed(2)} ms (headless SwiftShader CPU side)`);
  }
  // pause / restart mid-wave
  await p.evaluate(() => {
    const g = window.__game, l = g.logic, C = l.cols; g.vfx.reset(); l.grid.fill(0);
    for (let r = 0; r < 10; r++) for (let c = 0; c < C; c++) l.grid[r * C + c] = c === 5 ? 0 : (r % 8) + 8;
    for (let r = 7; r < 10; r++) l.grid[r * C] = 9;
    for (let r = 10; r < 14; r++) for (let c = 1; c < C; c++) l.grid[r * C + c] = (r % 8) + 8;
    g.tower.clear(); l.emit('restart'); l.piece = { name: 'I', id: 1, col: 0, row: 24, rot: 1 }; l.lowest = 24;
  });
  await p.keyboard.press('Space');
  await p.evaluate(() => { window.__game.vfx.step(0.3); window.__game.vfx.step(0.2); });
  await p.evaluate(() => window.__game.restart());
  const rs = await p.evaluate(() => { const v = window.__game.vfx; return { a: v.animating, f: v.fallingCount, d: v.debrisCount, p: v.particleCount }; });
  check(`${tag} restart mid-wave cancels cleanly`, !rs.a && rs.f === 0 && rs.d === 0 && rs.p === 0, JSON.stringify(rs));
  await ctx.close();
}
console.log(failed404.join('\n') || 'no failed (404) requests');
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
