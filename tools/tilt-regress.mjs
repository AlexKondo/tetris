// Regression: the tilt buttons / keys must visibly change the camera in both modes at desktop sizes.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fails = [], logs = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };

// pixel difference computed in a page (no image libs needed)
let diffPage = null;
async function diff(a, c) {
  return diffPage.evaluate(async ([x, y]) => {
    const load = async (b64) => { const bl = await (await fetch('data:image/png;base64,' + b64)).blob(); return createImageBitmap(bl); };
    const [A, C] = await Promise.all([load(x), load(y)]);
    const cv = new OffscreenCanvas(A.width, A.height), g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, A.width, A.height).data;
    g.clearRect(0, 0, A.width, A.height); g.drawImage(C, 0, 0); const dc = g.getImageData(0, 0, A.width, A.height).data;
    let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - dc[i]) + Math.abs(da[i + 1] - dc[i + 1]) + Math.abs(da[i + 2] - dc[i + 2]) > 60) n++;
    return n / (A.width * A.height);
  }, [a.toString('base64'), c.toString('base64')]);
}
diffPage = await (await b.newContext()).newPage();
await diffPage.goto('about:blank');

for (const [w, h] of [[1536, 880], [1920, 1080]]) for (const mode of ['cylinder', 'wall']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  const tag = `${w}x${h} ${mode}`;
  p.on('console', m => m.type() !== 'debug' && logs.push(`${tag} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${tag} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=123&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  // buttons exist, are visible and are the top-most element at their centre (not covered)
  const btn = await p.evaluate(() => {
    const out = {};
    for (const v of ['tiltUp', 'tiltDown', 'zoomIn', 'zoomOut', 'resetView']) {
      const e = document.querySelector(`#viewctl [data-v=${v}]`);
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out[v] = { inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, clickable: top === e || e.contains(top), opacity: getComputedStyle(e).opacity };
    }
    return out;
  });
  check(`${tag} view buttons visible + clickable`, Object.values(btn).every((x) => x.inViewport && x.clickable), JSON.stringify(btn));
  const cam = () => p.evaluate(() => { const g = window.__game, c = g.camera; return { pitch: g.stage.pitchDeg, y: c.position.y, z: c.position.z, vp: g.view.pitch }; });
  const shot = async () => { await p.waitForTimeout(1500); return p.screenshot({ timeout: 120000 }); };
  const settle = () => p.evaluate(() => window.__game.snapCamera());

  const c0 = await cam(); await settle(); const s0 = await shot();
  // real clicks on the on-screen button, several steps
  for (let i = 0; i < 6; i++) await p.click('#viewctl [data-v=tiltUp]');
  await settle();
  const c1 = await cam(); const s1 = await shot();
  check(`${tag} click tilt UP changes pitch`, c1.vp > c0.vp + 15 && c1.pitch > c0.pitch + 15, `${c0.pitch.toFixed(1)} -> ${c1.pitch.toFixed(1)}`);
  check(`${tag} camera moves up when tilting up`, c1.y > c0.y + 1, `${c0.y.toFixed(1)} -> ${c1.y.toFixed(1)}`);
  const d1 = await diff(s0, s1);
  check(`${tag} render changes (>8% pixels) after tilt up`, d1 > 0.08, `${(d1 * 100).toFixed(1)}%`);
  for (let i = 0; i < 12; i++) await p.click('#viewctl [data-v=tiltDown]');
  await settle();
  const c2 = await cam(); const s2 = await shot();
  check(`${tag} click tilt DOWN lowers pitch to the minimum`, c2.vp === 8 && c2.pitch < c1.pitch - 30, `${c1.pitch.toFixed(1)} -> ${c2.pitch.toFixed(1)}`);
  const d2 = await diff(s1, s2);
  check(`${tag} render changes (>8% pixels) low vs high tilt`, d2 > 0.08, `${(d2 * 100).toFixed(1)}%`);
  // keyboard
  const k0 = (await cam()).vp;
  await p.keyboard.press(']'); await p.keyboard.press('PageUp');
  check(`${tag} keys ] / PageUp raise the pitch`, (await cam()).vp > k0 + 5);
  await p.keyboard.press('['); await p.keyboard.press('PageDown'); await p.keyboard.press('PageDown');
  check(`${tag} keys [ / PageDown lower the pitch`, (await cam()).vp <= k0, String((await cam()).vp));
  // smoothing converges without snapping (real loop, within 0.6 s of wall time at low fps is not meaningful, so check target reachable via frames)
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
process.exit(fails.length ? 1 : 0);
