import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };

async function open(w, h, mobile, query, blockStorage = false) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  if (blockStorage) await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('x', 'SecurityError'); } }); });
  const p = await ctx.newPage();
  const tag = `${w}x${h}${blockStorage ? ' blocked' : ''}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${query} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} ${query} PAGEERROR: ${e.message}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1' + query);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  return { ctx, p, tag };
}
const snap = async (p, name) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2200); await p.screenshot({ path: `screenshots/${name}.png`, timeout: 120000 }); };
// is the whole active piece + ghost inside the visible band (below HUD, above bottom)?
const pieceBox = (p) => p.evaluate(() => {
  const g = window.__game, cam = g.camera, l = g.logic, R = g.tower;
  g.camera.updateMatrixWorld(); g.camera.updateProjectionMatrix();
  const H = innerHeight, W = innerWidth, pts = [];
  const v = g.camera.position.clone();
  const proj = (row, col) => { const q = v.clone(); g.tower.cellPosition(row, col, q); q.applyMatrix4(g.tower.group.matrixWorld); q.project(cam); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
  const cells = l.pieceCells();
  const drop = l.piece.row - l.landingRow();
  for (const c of cells) { pts.push(proj(c.row, c.col)); pts.push(proj(c.row - drop, c.col)); }
  const ys = pts.map((q) => q[1]);
  return { top: Math.min(...ys), bottom: Math.max(...ys), H };
});

for (const [w, h, mobile] of [[430, 900, true]]) {
  for (const mode of ['cylinder', 'wall']) {
    const { ctx, p, tag } = await open(w, h, mobile, `&mode=${mode}`);
    check(`${tag} ${mode} cols`, await p.evaluate(() => window.__game.logic.cols) === (mode === 'wall' ? 14 : 44));
    await snap(p, `u3-${tag}-${mode}-default`);
    const unit = await p.evaluate(() => document.querySelector('#hud .card:nth-child(4) span').textContent);
    check(`${tag} ${mode} HUD label`, unit === (mode === 'wall' ? 'rows' : 'rings'), unit);
    await ctx.close();
  }
}
// extreme view combos: piece + ghost must stay inside [HUD, bottom)
for (const mode of ['cylinder', 'wall']) for (const [w, h, mobile] of [[430, 900, true], [900, 430, false], [1280, 720, false]]) {
  const { ctx, p, tag } = await open(w, h, mobile, `&mode=${mode}`);
  for (const [pitch, zoom] of [[55, 0.6], [8, 1.8], [55, 1.8], [8, 0.6]]) {
    await p.evaluate(([pi, zo]) => { const g = window.__game; g.view.pitch = pi; g.view.zoom = zo; g.snapCamera(); }, [pitch, zoom]);
    const box = await pieceBox(p);
    const hudBottom = w > h ? 24 : 90;
    check(`${tag} ${mode} pitch ${pitch} zoom ${zoom}: piece+ghost in band`, box.top >= hudBottom - 6 && box.bottom <= h - 4, `top ${box.top.toFixed(0)} bottom ${box.bottom.toFixed(0)} of ${h}`);
    if (mode === 'cylinder' && w === 430 || (mode === 'wall' && w === 430 && pitch === 55 && zoom === 0.6)) await snap(p, `u3-${tag}-${mode}-p${pitch}-z${zoom}`);
  }
  await ctx.close();
}
// blocked storage
for (const q of ['&mode=wall', '&mode=cylinder', '']) {
  const { ctx, p, tag } = await open(360, 640, true, q, true);
  check(`${tag} ${q || '(no mode)'} game starts with blocked storage`, await p.evaluate(() => typeof __game === 'object'));
  if (q === '&mode=wall') await snap(p, 'u3-blocked-storage-wall');
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
