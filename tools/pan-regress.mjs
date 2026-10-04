// Regression: zoom-out centres the picture vertically; pan buttons / keys / drags move it by the expected amount.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
for (const [w, h, mobile] of [[1536, 820, false], [1920, 1080, false], [1894, 905, false], [430, 900, true]]) for (const mode of ['wall', 'cylinder']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const tag = `${w}x${h} ${mode}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  const ys = () => p.evaluate(() => {
    const g = window.__game, cam = g.camera, l = g.logic, H = innerHeight;
    g.snapCamera(); cam.updateMatrixWorld();
    const at = (row) => { const q = g.tower.cellPosition(row, Math.round((l.cols - 1) / 2)); if (g.MODE === 'cylinder') { q.set(0, q.y, 0); } q.y = row * 1.3; q.applyMatrix4(g.tower.group.matrixWorld); q.project(cam); return (1 - q.y) / 2 * H; };
    const rim = l.stackTop();
    return { base: at(0), land: at(rim), top: at(rim + 13.5), H, zoom: +g.stage.effZoom.toFixed(2) };
  });
  await p.evaluate(() => { const g = window.__game; g.view.pitch = 20; g.view.zoom = g.MODE === 'wall' ? 0.6 : 1; g.view.pan = 0; });
  const z = await ys();
  if (mode === 'wall') {
    check(`${tag} zoom 0.6: wall base in the LOWER half of the screen`, z.base > z.H / 2, `base y ${z.base.toFixed(0)} of ${z.H}`);
    const centre = (z.base + z.top) / 2;
    check(`${tag} zoom 0.6: content centre in the middle third`, centre > z.H / 3 && centre < (2 * z.H) / 3, `centre ${centre.toFixed(0)} (${(centre / z.H * 100).toFixed(0)}%)`);
  } else {
    check(`${tag} zoom 0.6: stack top / landing zone not glued to the very top`, z.land > z.H * 0.2, `land y ${z.land.toFixed(0)} of ${z.H}`);
  }
  // pan buttons: 2 presses down then 4 up, expected 0.06*2*H/2... = 0.06 of H per press for the stack top
  const before = await ys();
  for (let i = 0; i < 2; i++) await p.click('#viewctl [data-v=panDown]');
  const down = await ys();
  const exp = 2 * 0.06 * z.H;
  check(`${tag} panDown x2 moves the stack top down by ~${exp.toFixed(0)}px`, Math.abs((down.land - before.land) - exp) < exp * 0.25 + 4, `${(down.land - before.land).toFixed(0)}px`);
  check(`${tag} panDown also moves the base down (same direction)`, down.base > before.base + exp * 0.15, `${(down.base - before.base).toFixed(0)}px`);
  for (let i = 0; i < 4; i++) await p.click('#viewctl [data-v=panUp]');
  const up = await ys();
  check(`${tag} panUp x4 moves the stack top up by ~${(2 * exp).toFixed(0)}px`, Math.abs((down.land - up.land) - 2 * exp) < exp * 0.5 + 4, `${(down.land - up.land).toFixed(0)}px`);
  // keyboard
  const k0 = (await ys()).land;
  await p.keyboard.press('End'); const k1 = (await ys()).land;
  await p.keyboard.press('Home'); await p.keyboard.press('Home'); const k2 = (await ys()).land;
  check(`${tag} End moves down, Home moves up`, k1 > k0 + 5 && k2 < k1 - 5, `${k0.toFixed(0)} -> ${k1.toFixed(0)} -> ${k2.toFixed(0)}`);
  await p.keyboard.press('Shift+PageDown'); const k3 = (await ys()).land;
  check(`${tag} Shift+PageDown moves down`, k3 > k2 + 5, `${k2.toFixed(0)} -> ${k3.toFixed(0)}`);
  // mouse: ctrl-drag pans (drag down = picture down)
  if (!mobile) {
    const d0 = (await ys()).land;
    await p.keyboard.down('Control'); await p.mouse.move(w / 2, h / 2); await p.mouse.down(); await p.mouse.move(w / 2, h / 2 + 60, { steps: 4 }); await p.mouse.up(); await p.keyboard.up('Control');
    const d1 = (await ys()).land;
    check(`${tag} Ctrl-drag down pans the picture down`, d1 > d0 + 10, `${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
  }
  // clamp + reset
  for (let i = 0; i < 30; i++) await p.keyboard.press('End');
  const clampPan = await p.evaluate(() => window.__game.view.pan);
  check(`${tag} pan clamped to +-0.35`, Math.abs(clampPan) <= 0.35 + 1e-9, String(clampPan));
  const lim = await ys();
  check(`${tag} stack top still on screen at max pan`, lim.land < lim.H, `y ${lim.land.toFixed(0)} of ${lim.H}`);
  await p.click('#viewctl [data-v=resetView]');
  const rs = await p.evaluate(() => ({ pan: window.__game.view.pan, zoom: window.__game.view.zoom }));
  check(`${tag} reset clears pan and zoom`, rs.pan === 0 && rs.zoom === 1, JSON.stringify(rs));
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
process.exit(fails.length ? 1 : 0);
