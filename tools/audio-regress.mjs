// Regression: every clear event / chain step / wave triggers an explosion sound (live page, real GameAudio).
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] });
const logs = [], fails = [];
const check = (n, ok, i = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + ' ' + i); if (!ok) fails.push(n); };
for (const mode of ['wall', 'cylinder']) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
  const p = await ctx.newPage();
  p.on('console', m => m.type() !== 'debug' && logs.push(`${mode} ${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push(`${mode} PAGEERROR: ${e.message}`));
  await p.goto(`http://localhost:5173/?seed=3&gravity=0&q=high&autostart=1&mode=${mode}`);
  await p.waitForFunction(() => window.__game && window.__game.logic, null, { timeout: 120000 });
  await p.keyboard.press('ArrowLeft');                 // user gesture -> audio unlocked
  await p.waitForTimeout(400);
  const res = await p.evaluate(async () => {
    const g = window.__game, a = g.audio, l = g.logic, v = g.vfx; v.manual = true;
    const calls = []; const oe = a.explosion.bind(a); a.explosion = (rows, dur, d) => { calls.push({ rows, dur: +dur.toFixed(2), state: a.ctx.state }); return oe(rows, dur, d); };
    const out = {};
    const C = l.cols;
    const plain = () => {          // 1 row, no chain
      l.grid.fill(0); g.vfx.reset();
      for (let c = 0; c < C; c++) l.grid[c] = c === 5 ? 0 : 8;       // only row 0 completes (single step)
      l.grid[C + 0] = 9;
      g.tower.clear(); l.emit('restart'); l.piece = { name: 'I', id: 1, col: 5, row: 14, rot: 1 }; l.lowest = 14;
    };
    const chain = () => {          // row 0 completes, then a floating tile collapses and completes a 2nd row
      l.grid.fill(0); g.vfx.reset();
      for (let c = 0; c < C; c++) if (c !== 1) l.grid[c] = 8;       // row 0: hole at col 1 (the piece fills it)
      for (let c = 2; c < C; c++) l.grid[C + c] = 9;               // row 1: holes at 0,1
      l.grid[3 * C + 0] = 10;                                      // floats above col 0
      g.tower.clear(); l.emit('restart'); l.piece = { name: 'I', id: 1, col: 1, row: 14, rot: 1 }; l.lowest = 14;
    };
    const play = (setup) => { setup(); const before = calls.length, ev = []; const h = (e) => ev.push(e); l.on('clear', h); l.hardDrop(); for (let i = 0; i < 160; i++) v.step(0.05); return { events: ev.length, steps: ev.reduce((s, e) => s + e.chain, 0), booms: calls.length - before }; };
    out.first = play(plain);
    out.second = play(plain);
    out.third = play(plain);
    out.chain = play(chain);
    g.togglePause(); await new Promise(r => setTimeout(r, 300)); g.togglePause(); await new Promise(r => setTimeout(r, 300));
    out.afterPause = play(plain);
    a.setMuted(true); await new Promise(r => setTimeout(r, 300)); a.setMuted(false); await new Promise(r => setTimeout(r, 300));
    out.afterMute = play(plain);
    g.restart(); await new Promise(r => setTimeout(r, 300));
    out.afterRestart = play(plain);
    out.states = [...new Set(calls.map((c) => c.state))].join(',');
    out.total = a.explosions;
    return out;
  });
  console.log(mode, JSON.stringify(res));
  for (const k of ['first', 'second', 'third', 'afterPause', 'afterMute', 'afterRestart']) check(`${mode} ${k}: 1 clear event -> 1 explosion`, res[k].events === 1 && res[k].steps === 1 && res[k].booms === 1, JSON.stringify(res[k]));
  check(`${mode} chain: ${res.chain.steps} steps -> ${res.chain.booms} explosions (>= steps, >= 2)`, res.chain.steps >= 2 && res.chain.booms >= res.chain.steps, JSON.stringify(res.chain));
  check(`${mode} context was running for every explosion`, res.states === 'running', res.states);
  await ctx.close();
}
console.log(logs.join('\n') || 'no console output');
console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'all checks ok');
await b.close();
process.exit(fails.length ? 1 : 0);
