// Regression: after a lock the tower must NOT swing back to a fixed home column (cylinder mode, real-time follow).
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('console', m => m.type() !== 'debug' && logs.push(`${m.type()}: ${m.text()}`));
p.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:5173/?seed=7&gravity=0&q=high&autostart=1&mode=cylinder');
await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
const rot = () => p.evaluate(() => window.__game.tower.group.rotation.y);
const info = () => p.evaluate(() => {
  const g = window.__game, l = g.logic, cam = g.camera, W = innerWidth;
  cam.updateMatrixWorld();
  let sx = 0; const cells = l.pieceCells();
  for (const c of cells) { const q = g.tower.cellPosition(c.row, c.col); q.applyMatrix4(g.tower.group.matrixWorld); q.project(cam); sx += (q.x + 1) / 2 * W; }
  return { col: l.piece.col, sx: sx / cells.length, W, rot: g.tower.group.rotation.y, over: l.over, step: (Math.PI * 2) / l.cols };
});
const settle = () => p.waitForTimeout(3500);   // real-time follow at headless fps
await settle();
const first = await info();
check('first piece is front-centre', Math.abs(first.sx - first.W / 2) < first.W * 0.12, `x ${first.sx.toFixed(0)}`);
const moves = [['ArrowRight', 13], ['ArrowLeft', 25], ['ArrowRight', 40], ['ArrowLeft', 9], ['ArrowRight', 3]];
for (const [key, n] of moves) {
  for (let i = 0; i < n; i++) await p.keyboard.press(key);
  await settle();
  const before = await info();
  await p.keyboard.press('Space');                 // lock -> spawn the next piece
  await settle();
  const after = await info();
  let d = after.rot - before.rot; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  check(`${key} x${n}: view does not swing on lock (|d rot| = ${(Math.abs(d) / after.step).toFixed(2)} column steps)`, Math.abs(d) < 1.5 * after.step && !after.over, `rot ${before.rot.toFixed(2)} -> ${after.rot.toFixed(2)}`);
  check(`${key} x${n}: next piece appears near the horizontal centre`, Math.abs(after.sx - after.W / 2) < after.W * 0.15, `x ${after.sx.toFixed(0)} of ${after.W}, col ${after.col}`);
}
await p.screenshot({ path: 'screenshots/u7-after-locks.png', timeout: 120000 });
// restart is allowed to reset the view (deterministic home column)
await p.evaluate(() => window.__game.restart());
await settle();
const rs = await info();
check('restart spawns at the home column (deterministic)', rs.col === 0, `col ${rs.col}`);
await p.screenshot({ path: 'screenshots/u7-after-restart.png', timeout: 120000 });
// pause / resume does not move the view
const r0 = await rot();
await p.keyboard.press('p'); await settle(); await p.keyboard.press('p'); await settle();
const r1 = await rot();
check('pause / resume keeps the view', Math.abs(r1 - r0) < 1e-3, `${r0.toFixed(3)} -> ${r1.toFixed(3)}`);
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
process.exit(fails.length ? 1 : 0);
