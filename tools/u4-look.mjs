import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
for (const [w, h, mobile] of [[430, 900, true], [1536, 880, false], [1920, 1080, false]]) for (const mode of ['cylinder', 'wall']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(`${w} ${mode} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${w} ${mode} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.evaluate(() => { window.__game.vfx.manual = true; window.__game.snapCamera(); });
  await p.waitForTimeout(2500);
  const m = await p.evaluate(() => {
    const g = window.__game, l = g.logic, cam = g.camera, W = innerWidth, H = innerHeight;
    cam.updateMatrixWorld();
    const pr = (row, col) => { const q = g.tower.cellPosition(row, col); q.applyMatrix4(g.tower.group.matrixWorld); q.project(cam); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
    const c0 = Math.round(l.piece.col);
    const a = pr(l.piece.row, c0), r1 = pr(l.piece.row + 1, c0), c1 = pr(l.piece.row, c0 + 1);
    g.renderer.info.autoReset = false; g.renderer.info.reset(); g.stage.shadowDirty = true; g.stage.render();
    const tri = g.renderer.info.render.triangles, calls = g.renderer.info.render.calls; g.renderer.info.autoReset = true;
    return { cols: l.cols, rowPx: +Math.abs(a[1] - r1[1]).toFixed(1), colPx: +Math.abs(a[0] - c1[0]).toFixed(1), stack: l.stackTop(), spawn: l.piece.row, tiles: g.tower.n, tri, calls };
  });
  console.log(`${w}x${h} ${mode}`, JSON.stringify(m));
  await p.screenshot({ path: `screenshots/u4-${w}x${h}-${mode}-default.png`, timeout: 120000 });
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
await b.close();
