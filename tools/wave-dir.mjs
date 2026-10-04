// Screen-space check: the burst front on the visible front face travels to the RIGHT (cylinder) / left->right (wall).
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
for (const [w, h, mode] of [[1536, 820, 'cylinder'], [1536, 820, 'wall'], [430, 900, 'cylinder'], [320, 568, 'wall']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(`${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  const r = await p.evaluate(() => {
    const g = window.__game, l = g.logic, v = g.vfx, C = l.cols; v.manual = true;
    l.grid.fill(0);
    for (let r = 0; r < 10; r++) for (let c = 0; c < C; c++) l.grid[r * C + c] = c === 5 ? 0 : (r % 8) + 8;
    for (let r = 7; r < 10; r++) l.grid[r * C] = 9;
    for (let c = 1; c < C; c++) l.grid[10 * C + c] = 10;
    g.tower.clear(); v.reset(); l.emit('restart');
    const col = g.MODE === 'wall' ? 0 : Math.floor(C / 2) + 3;                 // lock somewhere other than col 0
    for (let r = 7; r < 10; r++) { l.grid[r * C + 0] = 0; l.grid[r * C + col] = 9; }
    for (let r = 0; r < 10; r++) if (r < 7) l.grid[r * C + col] = (r % 8) + 8;
    for (let c = 0; c < C; c++) if (c !== col) l.grid[10 * C + c] = 10; else l.grid[10 * C + c] = 0;
    for (let c = 0; c < C; c++) if (c !== col && l.grid[9 * C + c] === 0) l.grid[9 * C + c] = 9;
    g.tower.clear(); l.emit('restart');
    l.piece = { name: 'I', id: 1, col, row: 24, rot: 1 }; l.lowest = 24;
    g.snapCamera(); g.camera.updateMatrixWorld();
    l.hardDrop();                                                                 // lock on `col`, clear row 10
    g.snapCamera(); g.camera.updateMatrixWorld();
    const W = innerWidth;
    const sx = (c) => { const q = g.tower.cellPosition(10, c); q.applyMatrix4(g.tower.group.matrixWorld); const z = q.z; q.project(g.camera); return { x: (q.x + 1) / 2 * W, z }; };
    v.step(0.3);                                                                  // flash -> wave planned
    const first = v.anim && v.anim.wave ? v.anim.wave.slice() : [];
    const seen = [];
    for (let i = 0; i < 40; i++) { const before = v.anim ? v.anim.wi : 0; v.step(0.02); const a = v.anim; if (!a || !a.wave) break; for (let k = before; k < a.wi; k++) seen.push({ col: a.wave[k].col, row: a.wave[k].row, ...sx(a.wave[k].col), order: seen.length }); }
    return { seen, lock: col, n: first.length };
  });
  // use only the visible front face (towards the camera) tiles
  const row0 = r.seen.length ? r.seen[0].row : 0, oneRow = r.seen.filter((s) => s.row === row0);
  const frontTiles = mode === 'wall' ? oneRow : oneRow.filter((s) => s.z > 0);
  const xs = frontTiles.map((s) => s.x);
  // Spearman-like check: correlation between burst order and screen x on the right half starting at the lock column
  const start = frontTiles.find((s) => s.col === r.lock) || frontTiles[0];
  const rightHalf = frontTiles.filter((s) => s.x >= start.x - 2);
  let inc = 0, tot = 0;
  for (let i = 1; i < rightHalf.length; i++) { tot++; if (rightHalf[i].x >= rightHalf[i - 1].x - 1) inc++; }
  check(`${w}x${h} ${mode}: first burst is at the lock column`, r.seen.length > 0 && (mode === 'wall' ? r.seen[0].col <= 1 : Math.abs(r.seen[0].col - r.lock) <= 2), `first col ${r.seen[0] && r.seen[0].col}, lock ${r.lock}`);
  check(`${w}x${h} ${mode}: burst order moves RIGHT on screen (${inc}/${tot} steps)`, tot >= 3 && inc / tot > 0.85, `n=${r.seen.length}`);
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
