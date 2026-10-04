import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
const sizes = [['m430', 430, 900, true], ['m360', 360, 640, true], ['d1280', 1280, 720, false]];
for (const [name, w, h, mobile] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(name + ' ' + m.type() + ': ' + m.text()));
  p.on('pageerror', e => logs.push(name + ' PAGEERROR: ' + e.message));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&autostart=1');
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  const shot = async (n) => { await p.evaluate(() => window.__game.snapCamera()); await p.waitForTimeout(2500); await p.screenshot({ path: `screenshots/w3b-${name}-${n}.png`, timeout: 120000 }); };
  await shot('play');
  if (name === 'm430') {
    for (let i = 0; i < 12; i++) await p.keyboard.press('ArrowRight');
    await shot('right12');
  }
  if (name === 'd1280') {
    await p.evaluate(() => window.__game.togglePause());
    await shot('pause');
  }
  await ctx.close();
}
console.log(logs.join('\n') || 'no console errors');
await b.close();
