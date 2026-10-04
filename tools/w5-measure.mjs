import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const logs = [];
p.on('console', m => m.type() !== 'debug' && logs.push(m.type() + ': ' + m.text()));
p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
await p.goto('http://localhost:5173/?seed=123&gravity=0&autostart=1&q=high');
await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
await p.waitForTimeout(4000);
const info = await p.evaluate(() => {
  const g = window.__game, r = g.renderer;
  // run one explicit render to read per-frame stats (autoReset zeroes them each render)
  r.info.autoReset = false; r.info.reset(); g.stage.shadowDirty = true; g.stage.render();
  const out = { triangles: r.info.render.triangles, calls: r.info.render.calls, geometries: r.info.memory.geometries, textures: r.info.memory.textures, tiles: g.tower.n };
  r.info.autoReset = true; return out;
});
console.log('renderer.info', JSON.stringify(info));
console.log(logs.join('\n') || 'no console output');
await b.close();
