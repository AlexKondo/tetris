import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
p.on('console', m => logs.push(m.type() + ': ' + m.text()));
p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await p.goto('http://localhost:5173/?seed=123&gravity=0');
await p.waitForFunction(() => window.__game && window.__game.logic);
const st = () => p.evaluate(() => { const l = window.__game.logic; return { piece: l.piece && { n: l.piece.name, col: l.piece.col, row: l.piece.row, rot: l.piece.rot }, score: l.score, level: l.level, rings: l.rings, over: l.over }; });
const settle = (ms = 2500) => p.waitForTimeout(ms);
const shot = async (n) => { await p.evaluate(() => window.__game.snapCamera()); await settle(); await p.screenshot({ path: `screenshots/${n}.png`, timeout: 120000 }); };
console.log('initial', JSON.stringify(await st()));
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('w');
console.log('after keys', JSON.stringify(await st()));
await shot('w2-active-piece');
// wrap test: move left past col 0
for (let i = 0; i < 4; i++) await p.keyboard.press('a');
console.log('wrapped', JSON.stringify(await st()));
// stack: rows 0..3 full except col 0 (well for vertical I), rows 4..9 partial
await p.evaluate(() => {
  const l = window.__game.logic;
  l.restart(); l.grid.fill(0);
  for (let r = 0; r < 4; r++) for (let c = 1; c < l.cols; c++) l.grid[r * l.cols + c] = 1 + ((r + c) % 7);
  for (let r = 4; r < 10; r++) for (let c = 4; c < 17 - r; c++) l.grid[r * l.cols + c] = 1 + ((r + c) % 7);
  l.piece = { name: 'I', id: 1, col: 0, row: 12, rot: 1 };
  l.emit('lock', {});
});
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowRight');
console.log('stack', JSON.stringify(await st()));
await shot('w2-stack-before');
await p.keyboard.press('Space');
await p.evaluate(() => { window.__game.logic.piece.row = 11; });
console.log('after drop', JSON.stringify(await st()));
await shot('w2-stack-after-clear');
// game over
await p.evaluate(() => { const l = window.__game.logic; l.restart(); l.grid.fill(0); for (let r = l.rows; r < l.rows + 2; r++) for (let c = 0; c < l.cols; c++) if (c !== 5) l.grid[r * l.cols + c] = 2; l.emit('lock', {}); });
await p.keyboard.press('Space');
console.log('gameover?', JSON.stringify(await st()));
await shot('w2-gameover');
await p.keyboard.press('r');
console.log('restart', JSON.stringify(await st()));
console.log('seeded same first piece on reload:');
console.log(logs.join('\n') || 'no console output');
await b.close();
