import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const logs = [];
p.on('console', m => m.type() !== 'debug' && logs.push(m.type() + ': ' + m.text()));
p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + ' ' + info); if (!ok) fails.push(name); };
const st = (pg = p) => pg.evaluate(() => { const l = window.__game.logic; return { state: window.__game.state, piece: l.piece && { n: l.piece.name, col: l.piece.col, row: l.piece.row, rot: l.piece.rot }, score: l.score, rings: l.rings, top: l.stackTop() }; });
const shot = async (pg, n) => { await pg.evaluate(() => window.__game.snapCamera()); await pg.waitForTimeout(2500); await pg.screenshot({ path: `screenshots/${n}.png`, timeout: 120000 }); };
// pointer helpers (synthetic PointerEvents, pointerType touch)
const ptr = (pg, type, x, y, id = 1) => pg.evaluate(([type, x, y, id]) => {
  const c = document.querySelector('canvas');
  c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}, [type, x, y, id]);

await p.goto('http://localhost:5173/?seed=123&gravity=0');
await p.waitForFunction(() => window.__game && window.__game.logic);
check('start screen shown', (await st()).state === 'ready');
await shot(p, 'w3-start');
await p.click('#btn-start');
check('tap start -> playing', (await st()).state === 'playing');
let s0 = await st();
console.log('spawn', JSON.stringify(s0), 'top', s0.top);
check('spawn gap = 3 rows above stack', s0.piece.row === s0.top + 3);
await shot(p, 'w3-initial');

// tap = rotate
await ptr(p, 'pointerdown', 215, 500); await ptr(p, 'pointerup', 215, 500);
let s1 = await st();
check('tap rotates', s1.piece.rot === 1, JSON.stringify(s1.piece));

// swipe right 3 steps (continuous drag, 34px/step)
await ptr(p, 'pointerdown', 100, 500);
for (let x = 100; x <= 220; x += 12) { await ptr(p, 'pointermove', x, 500); await p.waitForTimeout(15); }
await shot(p, 'w3-mid-drag');
let s2 = await st();
check('drag right moves piece (>=3 cols)', ((s2.piece.col - s1.piece.col + 24) % 24) >= 3, `col ${s1.piece.col}->${s2.piece.col}`);
await ptr(p, 'pointerup', 220, 500);
check('drag does not rotate on release', (await st()).piece.rot === 1);
// swipe left wraps
await ptr(p, 'pointerdown', 300, 500);
for (let x = 300; x >= 20; x -= 14) { await ptr(p, 'pointermove', x, 500); await p.waitForTimeout(10); }
await ptr(p, 'pointerup', 20, 500);
let s3 = await st();
check('drag left moves piece back/wraps', s3.piece.col !== s2.piece.col, `col ${s2.piece.col}->${s3.piece.col}`);
// slow drag down = soft drop
const r0 = (await st()).piece.row, sc0 = (await st()).score;
await ptr(p, 'pointerdown', 215, 300);
for (let y = 300; y <= 420; y += 6) { await ptr(p, 'pointermove', 215, y); await p.waitForTimeout(40); }
await ptr(p, 'pointerup', 215, 420);
let s4 = await st();
check('slow drag down soft drops', s4.piece.row < r0 && s4.score > sc0 && s4.piece.row > 0, `row ${r0}->${s4.piece.row} score ${sc0}->${s4.score}`);
// fast flick down = hard drop
const lockedBefore = await p.evaluate(() => window.__game.logic.grid.reduce((a, v) => a + (v ? 1 : 0), 0));
await p.evaluate(() => { const c = document.querySelector('canvas'); const f = (t, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: 'touch', clientX: 215, clientY: y, bubbles: true, cancelable: true })); f('pointerdown', 300); f('pointermove', 330); f('pointermove', 420); f('pointerup', 420); });
const lockedAfter = await p.evaluate(() => window.__game.logic.grid.reduce((a, v) => a + (v ? 1 : 0), 0));
check('fast flick hard drops (4 cells locked)', lockedAfter - lockedBefore === 4, `${lockedBefore}->${lockedAfter}`);
await shot(p, 'w3-after-touch');

// keyboard still works
const kb0 = (await st()).piece.col; await p.keyboard.press('ArrowRight');
check('keyboard right works', (await st()).piece.col === (kb0 + 1) % 24);
// pause
await p.keyboard.press('p');
check('P pauses', (await st()).state === 'paused');
const pc = (await st()).piece.col; await p.keyboard.press('ArrowRight');
check('no input while paused', (await st()).piece.col === pc);
await shot(p, 'w3-paused');
await p.click('#btn-resume');
check('resume', (await st()).state === 'playing');

// ring clear: well drop
await p.evaluate(() => {
  const l = window.__game.logic; const r = l.rows - 14; let hc = 0;
  for (let c = 0; c < l.cols; c++) if (!l.grid[r * l.cols + c]) { hc = c; break; }
  l.piece = { name: 'I', id: 1, col: hc, row: l.piece.row, rot: 1 }; l.lockAcc = 0; l.emit('restart');
});
await p.keyboard.press('Space');
const sc = await st();
check('ring clear scored', sc.rings >= 1, JSON.stringify(sc));
await shot(p, 'w3-ring-clear');

// game over overlay with restart button
await p.evaluate(() => { const l = window.__game.logic; for (let r = 0; r < l.rows + 2; r++) for (let c = 0; c < l.cols; c++) l.grid[r * l.cols + c] = c !== 5 ? 1 : 0; l.piece.row = l.rows; l.emit('lock', {}); l.hardDrop(); });
await p.waitForTimeout(500);
check('game over state', (await st()).state === 'over');
await shot(p, 'w3-gameover');
await p.click('#btn-restart');
const rs = await st();
check('restart button works', rs.state === 'playing' && rs.score === 0);

// desktop landscape + mouse drag
await ctx.close();
const d = await b.newPage({ viewport: { width: 1280, height: 720 } });
d.on('console', m => m.type() !== 'debug' && logs.push('desktop ' + m.type() + ': ' + m.text()));
d.on('pageerror', e => logs.push('desktop PAGEERROR: ' + e.message));
await d.goto('http://localhost:5173/?seed=123&gravity=0&autostart=1');
await d.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
const c0 = (await st(d)).piece.col;
await d.mouse.move(640, 300); await d.mouse.down();
for (let x = 640; x <= 760; x += 10) { await d.mouse.move(x, 300); }
await d.mouse.up();
const c1 = (await st(d)).piece.col;
check('mouse drag moves piece', c1 !== c0, `col ${c0}->${c1}`);
await shot(d, 'w3-desktop');

console.log(logs.join('\n') || 'no console errors');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
