import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mode = process.argv[2] || 'up'; // 'up' | 'down' (label only: start/stop the API outside)
const logs = [];
const fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
const sizes = [['d1920', 1920, 1080, false], ['d1280', 1280, 720, false], ['m390', 390, 844, true], ['m360', 360, 640, true]];
for (const [name, w, h, mobile] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(`${mode}/${name} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${mode}/${name} PAGEERROR: ${e.message}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&autostart=1&q=high');
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  await p.evaluate(() => window.__game.snapCamera());
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `screenshots/w5-${mode}-${name}.png`, timeout: 120000 });
  if (name === 'd1920' || name === 'm390') {
    // piece after moving + game over overlay with BEST
    for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Space');
    await p.evaluate(() => { const l = window.__game.logic; l.score = 4321; l.rings = 9; l.over = true; l.emit('gameOver', { score: l.score, level: l.level, rings: l.rings }); });
    await p.waitForTimeout(1500);
    const best = await p.evaluate(() => ({ best: window.__game.persistence.best, online: window.__game.persistence.online, txt: document.getElementById('o-best').textContent }));
    check(`${mode}/${name} best shown on game over`, best.best >= 4321 && /BEST/i.test(best.txt), JSON.stringify(best));
    await p.evaluate(() => window.__game.snapCamera());
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `screenshots/w5-${mode}-${name}-gameover.png`, timeout: 120000 });
    const pw = await p.evaluate(() => window.__game.restart && (window.__game.restart(), window.__game.state));
    check(`${mode}/${name} restart after game over`, pw === 'playing');
  }
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
