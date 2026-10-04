import { chromium } from 'playwright';
const mode = process.argv[2] || 'up';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
const sizes = [[320, 568, true], [360, 640, true], [375, 667, true], [430, 900, true], [900, 430, true], [1280, 720, false], [1920, 1080, false], [2560, 1080, false]];
for (const [w, h, mobile] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${mode}/${w}x${h}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&q=high');
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  // start via a real tap on the start button (unlocks audio from a gesture)
  await p.tap ? null : null;
  if (mobile) await p.tap('#btn-start'); else await p.click('#btn-start');
  await p.waitForTimeout(300);
  check(`${tag} started`, await p.evaluate(() => window.__game.state === 'playing'));
  const audio = await p.evaluate(() => window.__game.audio.ctx && window.__game.audio.ctx.state);
  check(`${tag} audio unlocked by start tap`, audio === 'running', String(audio));
  const hud = await p.evaluate(() => {
    const sel = ['#hud .card.next', '#hud .card.main', '#hud .card:nth-child(3)', '#hud .card:nth-child(4)', '#btn-pause', '#btn-mute'];
    return sel.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.left), Math.round(r.right), Math.round(r.width)]; });
  });
  check(`${tag} HUD fully inside viewport`, hud.every(([, l, r]) => l >= 0 && r <= w), JSON.stringify(hud.map((x) => x.slice(1, 3))));
  await p.evaluate(() => { window.__game.vfx.manual = true; window.__game.snapCamera(); });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `screenshots/final-${mode}-${w}x${h}.png`, timeout: 120000 });
  // R must not restart while playing
  const sc = await p.evaluate(() => { window.__game.logic.score = 77; return window.__game.logic.score; });
  await p.keyboard.press('r');
  check(`${tag} R ignored while playing`, (await p.evaluate(() => window.__game.logic.score)) === sc);
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
