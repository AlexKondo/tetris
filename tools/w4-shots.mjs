import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const logs = [];
p.on('console', m => m.type() !== 'debug' && logs.push(m.type() + ': ' + m.text()));
p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
const fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
const shot = async (n) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2200); await p.screenshot({ path: `screenshots/${n}.png`, timeout: 120000 }); };
const consistent = () => p.evaluate(() => { const g = window.__game, l = g.logic; for (let r = 0; r < l.totalRows; r++) for (let c = 0; c < l.cols; c++) if (g.tower.getTile(r, c) !== l.grid[r * l.cols + c]) return `mismatch ${r},${c}`; return 'ok'; });

await p.goto('http://localhost:5173/?seed=123&gravity=0&autostart=1');
await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
check('audio ctx not created before gesture', await p.evaluate(() => window.__game.audio.ctx === null));
await p.evaluate(() => { window.__game.vfx.manual = true; });
await p.keyboard.press('ArrowLeft');
await p.waitForTimeout(300);
check('audio ctx created after gesture', await p.evaluate(() => !!window.__game.audio.ctx), await p.evaluate(() => window.__game.audio.ctx && window.__game.audio.ctx.state));

async function wellSetup(rowsToFill) {
  await p.evaluate((n) => {
    const g = window.__game, l = g.logic;
    l.grid.fill(0);
    for (let r = 0; r < 10; r++) for (let c = 0; c < l.cols; c++) l.grid[r * l.cols + c] = c === 0 && r > 6 ? 0 : 1;
    l.grid[9 * l.cols] = 1; l.grid[8 * l.cols] = 1; l.grid[7 * l.cols] = 1; l.grid[0] = 1;
    // remove any accidental full rows below by punching hole col 5 rows 0..6
    for (let r = 0; r < 10; r++) l.grid[r * l.cols + 5] = 0;
    for (let r = 10; r < 10 + n; r++) for (let c = 1; c < l.cols; c++) l.grid[r * l.cols + c] = 1;
    for (let r = 10 + n; r < 14; r++) for (let c = 8; c < 16; c++) l.grid[r * l.cols + c] = 1;
    l.piece = { name: 'I', id: 1, col: 0, row: 10 + n + 6, rot: 1 };
    l.lowest = l.piece.row; l.armed = false; l.lockAcc = 0;
    g.tower.clear(); g.vfx.reset();
    l.emit('restart');           // re-sync tower from the edited grid
    l.piece = { name: 'I', id: 1, col: 0, row: 10 + n + 6, rot: 1 };
    l.lowest = l.piece.row;
  }, rowsToFill);
}

await wellSetup(2);
await shot('w4-pre-clear');
await p.keyboard.press('Space');
check('clear started', await p.evaluate(() => window.__game.vfx.animating));
await p.evaluate(() => window.__game.vfx.step(0.1));
await shot('w4-flash');
await p.evaluate(() => window.__game.vfx.step(0.12));
await p.evaluate(() => window.__game.vfx.step(0.08));
const mid = await p.evaluate(() => ({ d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount }));
check('debris + particles spawned', mid.d > 0 && mid.pa > 0, JSON.stringify(mid));
await shot('w4-mid-explosion-1');
await p.evaluate(() => window.__game.vfx.step(0.25));
await shot('w4-mid-explosion-2');
await p.evaluate(() => { for (let i = 0; i < 80; i++) window.__game.vfx.step(0.05); });
const post = await p.evaluate(() => ({ anim: window.__game.vfx.animating, d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount, rings: window.__game.logic.rings, score: window.__game.logic.score }));
check('animation converged, debris gone', !post.anim && post.d === 0 && post.pa === 0 && post.rings === 2, JSON.stringify(post));
check('tower matches logic grid after clear', (await consistent()) === 'ok', await consistent());
await shot('w4-post-clear');

// 4-ring clear
await wellSetup(4);
await p.keyboard.press('Space');
await p.evaluate(() => { const v = window.__game.vfx; v.step(0.2); v.step(0.15); });
const m4 = await p.evaluate(() => ({ d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount, rings: window.__game.logic.rings }));
check('4-ring: 96 debris, capped particles', m4.d === 96 && m4.pa <= 300 && m4.rings === 6, JSON.stringify(m4));
await shot('w4-4ring-mid');
await p.evaluate(() => { for (let i = 0; i < 80; i++) window.__game.vfx.step(0.05); });
check('tower matches logic grid after 4-ring', (await consistent()) === 'ok');
await shot('w4-4ring-post');

// restart mid-animation cancels cleanly
await wellSetup(2);
await p.keyboard.press('Space');
await p.evaluate(() => window.__game.vfx.step(0.25));
await p.keyboard.press('r');
const rr = await p.evaluate(() => ({ anim: window.__game.vfx.animating, d: window.__game.vfx.debrisCount, pa: window.__game.vfx.particleCount }));
check('restart cancels animation', !rr.anim && rr.d === 0 && rr.pa === 0, JSON.stringify(rr));
check('tower matches logic after restart', (await consistent()) === 'ok');

// game over dim
await p.evaluate(() => { const l = window.__game.logic; l.over = true; l.emit('gameOver', {}); window.__game.vfx.step(2); });
await shot('w4-gameover-dim');
await p.evaluate(() => window.__game.restart());

// ocean close-up
await p.evaluate(() => { const g = window.__game; g.tower.group.visible = false; g.stage.frame = () => {}; g.camera.position.set(0, 7, 40); g.camera.lookAt(0, 3, -80); g.camera.updateMatrixWorld(); });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'screenshots/w4-ocean.png', timeout: 120000 });
await p.evaluate(() => { const g = window.__game; g.camera.position.set(0, 30, 25); g.camera.lookAt(0, 0, -20); });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'screenshots/w4-ocean-high.png', timeout: 120000 });

// mute persistence
await p.evaluate(() => document.getElementById('btn-mute').click());
check('mute persisted', await p.evaluate(() => localStorage.getItem('mahjong-tower-muted') === '1' && window.__game.audio.muted));

console.log(logs.join('\n') || 'no console errors/warnings');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
