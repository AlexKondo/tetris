import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
for (const [w, h, mobile] of [[1894, 905, false], [1536, 820, false], [430, 900, true]]) for (const mode of ['wall', 'cylinder']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h} ${mode}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.evaluate(() => { window.__game.vfx.manual = true; });
  for (const [pitch, zoom, name] of [[18, 1, 'p18'], [8, 1, 'p8'], [55, 1, 'p55'], [20, 0.6, 'p20-z0.6']]) {
    await p.evaluate(([pi, zo]) => { const g = window.__game; g.view.pitch = pi; g.view.zoom = zo; g.view.pan = 0; g.snapCamera(); }, [pitch, zoom]);
    await p.waitForTimeout(1800);
    await p.screenshot({ path: `screenshots/u8-${w}x${h}-${mode}-${name}.png`, timeout: 120000 });
  }
  const m = await p.evaluate(() => { const g = window.__game; g.view.pitch = 18; g.view.zoom = 1; g.snapCamera(); g.renderer.info.autoReset = false; g.renderer.info.reset(); g.stage.shadowDirty = true; g.stage.render(); const o = { tri: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls, frame: Math.round(g.tower.frame.triangles) }; g.renderer.info.autoReset = true; return o; });
  console.log(`${tag} renderer.info`, JSON.stringify(m));
  await ctx.close();
}
// 320x568: compact panel incl. pan buttons fits
{
  const ctx = await b.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(`320 ${m.type()}: ${m.text()}`));
  await p.goto('http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=wall');
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  const r = await p.evaluate(() => [...document.querySelectorAll('#hud .card, #hud button, #viewctl button')].map((e) => { const x = e.getBoundingClientRect(); return [x.left, x.top, x.right, x.bottom]; }));
  check('320x568 HUD + VISTA buttons (incl. pan) inside the viewport', r.every(([l, t, rr, bb]) => l >= 0 && rr <= 320 && t >= 0 && bb <= 568), `${r.length} elements`);
  await p.evaluate(() => { window.__game.vfx.manual = true; window.__game.snapCamera(); });
  await p.waitForTimeout(1800);
  await p.screenshot({ path: 'screenshots/u8-320x568-wall.png', timeout: 120000 });
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
