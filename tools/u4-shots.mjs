import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };

async function open(w, h, mobile, mode) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h} ${mode}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  return { ctx, p, tag };
}
const snap = async (p, name) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2200); await p.screenshot({ path: `screenshots/${name}.png`, timeout: 120000 }); };
const consistent = (p) => p.evaluate(() => { const g = window.__game, l = g.logic; for (let r = 0; r < l.totalRows; r++) for (let c = 0; c < l.cols; c++) if (g.tower.getTile(r, c) !== l.grid[r * l.cols + c]) return `mismatch ${r},${c}`; return g.vfx.animating ? 'animating' : 'ok'; });
const step = (p, dts) => p.evaluate((a) => { for (const d of a) window.__game.vfx.step(d); }, dts);

// cascade scene: rows 0..2 full except col 0 (the well), two floating rows 6,7 (full except col 0) and a cell at (5,0).
const SETUP = () => {
  const g = window.__game, l = g.logic, C = l.cols;
  l.grid.fill(0);
  for (let r = 0; r < 3; r++) for (let c = 1; c < C; c++) l.grid[r * C + c] = 1;
  for (const r of [6, 7]) for (let c = 1; c < C; c++) l.grid[r * C + c] = 1;
  g.tower.clear(); g.vfx.reset(); l.emit('restart');
  l.piece = { name: 'I', id: 1, col: 0, row: 24, rot: 1 }; l.lowest = 24;
};

for (const [w, h, mobile, mode] of [[1536, 880, false, 'wall'], [430, 900, true, 'cylinder'], [1536, 880, false, 'cylinder'], [430, 900, true, 'wall']]) {
  const { ctx, p, tag } = await open(w, h, mobile, mode);
  const big = w === 1536 || mode === 'cylinder';
  await p.evaluate(SETUP);
  await snap(p, `u4-${w}x${h}-${mode}-cascade-pre`);
  await p.keyboard.press('Space');
  const ev = await p.evaluate(() => ({ rings: window.__game.logic.rings, anim: window.__game.vfx.animating }));
  check(`${tag} cascade chain: >=2 steps worth of rows (rings ${ev.rings})`, ev.rings >= 4 && ev.anim, JSON.stringify(ev));
  await step(p, [0.12, 0.12]);          // flash -> burst + cells break loose
  const mid1 = await p.evaluate(() => ({ falling: window.__game.vfx.fallingCount, debris: window.__game.vfx.debrisCount, particles: window.__game.vfx.particleCount }));
  check(`${tag} cells break loose + explode`, mid1.falling > 10, JSON.stringify(mid1));
  await step(p, [0.12]);
  await snap(p, `u4-${w}x${h}-${mode}-cascade-mid`);
  await step(p, [0.2, 0.2, 0.2]);
  await snap(p, `u4-${w}x${h}-${mode}-cascade-chain`);
  await step(p, new Array(160).fill(0.05));
  check(`${tag} converged to the logic grid`, (await consistent(p)) === 'ok', await consistent(p));
  const left = await p.evaluate(() => ({ f: window.__game.vfx.fallingCount, d: window.__game.vfx.debrisCount }));
  check(`${tag} no leftover falling tiles / debris`, left.f === 0 && left.d === 0, JSON.stringify(left));
  await snap(p, `u4-${w}x${h}-${mode}-cascade-post`);

  // back-to-back clears while animating, restart mid-animation
  await p.evaluate(SETUP);
  await p.keyboard.press('Space');
  await step(p, [0.2]);
  await p.evaluate(() => { const l = window.__game.logic; const C = l.cols; for (let r = 0; r < 3; r++) for (let c = 1; c < C; c++) l.grid[r * C + c] = 1; l.piece = { name: 'I', id: 1, col: 0, row: 24, rot: 1 }; l.lowest = 24; });
  await p.keyboard.press('Space');
  await step(p, new Array(160).fill(0.05));
  check(`${tag} back-to-back clears converge`, (await consistent(p)) === 'ok', await consistent(p));
  await p.evaluate(SETUP);
  await p.keyboard.press('Space');
  await step(p, [0.3]);
  await p.evaluate(() => window.__game.restart());
  const rs = await p.evaluate(() => ({ a: window.__game.vfx.animating, f: window.__game.vfx.fallingCount, d: window.__game.vfx.debrisCount }));
  check(`${tag} restart mid-animation cleans up`, !rs.a && rs.f === 0 && rs.d === 0, JSON.stringify(rs));
  check(`${tag} tower matches logic after restart`, (await consistent(p)) === 'ok');
  await ctx.close();
}

// game over after a normal amount of play (random bot, real logic + events), and numbers
for (const mode of ['wall', 'cylinder']) {
  const { ctx, p, tag } = await open(1536, 880, false, mode);
  const r = await p.evaluate(() => {
    const g = window.__game, l = g.logic; let n = 0, maxTop = 0; let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    while (!l.over && n < 4000) {
      const k = Math.floor(rnd() * 21) - 10; for (let i = 0; i < Math.abs(k); i++) k < 0 ? l.moveLeft() : l.moveRight();
      if (rnd() < 0.5) l.rotate();
      l.hardDrop(); n++; maxTop = Math.max(maxTop, l.stackTop());
      if (g.vfx.animating) g.vfx.finishClear();
    }
    return { pieces: n, over: l.over, top: l.stackTop(), maxTop, score: l.score, rings: l.rings };
  });
  check(`${tag} random bot reaches game over at the 30-row limit`, r.over && r.top >= 30, JSON.stringify(r));
  await p.waitForTimeout(500);
  await snap(p, `u4-1536x880-${mode}-gameover`);
  await ctx.close();
}
// danger line near the limit + perf at a tall stack
for (const [w, h, mobile, mode] of [[430, 900, true, 'cylinder'], [1536, 880, false, 'wall']]) {
  const { ctx, p, tag } = await open(w, h, mobile, mode);
  await p.evaluate(() => {
    const g = window.__game, l = g.logic, C = l.cols; l.grid.fill(0);
    for (let r = 0; r < 28; r++) for (let c = 0; c < C; c++) l.grid[r * C + c] = (c * 7 + r * 3) % 11 === 0 ? 0 : 1;
    g.tower.clear(); g.vfx.reset(); l.emit('restart');
    l.piece = { name: 'T', id: 3, col: l.cols >> 1, row: l.stackTop() + 10, rot: 0 }; l.lowest = l.piece.row;
  });
  await snap(p, `u4-${w}x${h}-${mode}-danger-stack28`);
  const m = await p.evaluate(() => { const g = window.__game; g.renderer.info.autoReset = false; g.renderer.info.reset(); g.stage.shadowDirty = true; g.stage.render(); const o = { tri: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls, top: g.logic.stackTop() }; g.renderer.info.autoReset = true; return o; });
  console.log(`${tag} tall stack renderer.info`, JSON.stringify(m));
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
