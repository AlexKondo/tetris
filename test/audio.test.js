import test from 'node:test';
import assert from 'node:assert/strict';

// --- minimal fake Web Audio so we can count what GameAudio schedules ---
let created = { src: 0, osc: 0, nodes: 0 };
class P { setValueAtTime() {} exponentialRampToValueAtTime() {} setTargetAtTime() {} }
const node = () => ({ connect() { created.nodes++; }, disconnect() {}, start() {}, stop() {}, gain: new P(), frequency: new P(), type: '', buffer: null, loop: false });
class FakeCtx {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; this.resumes = 0; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createGain() { return node(); }
  createBiquadFilter() { return node(); }
  createOscillator() { created.osc++; return node(); }
  createBufferSource() { created.src++; return node(); }
  createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
}
globalThis.window = { AudioContext: FakeCtx };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
const { GameAudio } = await import('../src/audio.js');

const fresh = () => { created = { src: 0, osc: 0, nodes: 0 }; const a = new GameAudio(); a.unlock(); return a; };
const tick = () => new Promise((r) => setTimeout(r, 5));

test('every explosion call schedules sound, also when the context was suspended (resume first, never silent)', async () => {
  const a = fresh();
  a.ctx.state = 'suspended';
  const before = created.src + created.osc;
  a.explosion(2, 0.6);
  await tick();
  assert.ok(a.ctx.resumes >= 1, 'resume() called before playing');
  assert.ok(created.src + created.osc > before, 'sound scheduled after the resume resolved');
  for (let i = 0; i < 5; i++) {
    const n0 = created.src + created.osc;
    a.explosion(1, 0.5);
    await tick();
    assert.ok(created.src + created.osc > n0, `explosion #${i + 2} produced sound`);
  }
  assert.equal(a.explosions, 6);
});

test('explosion scales with the rows cleared and keeps the node count bounded', async () => {
  const a = fresh(); a.ctx.state = 'running';
  const count = async (rows, dur) => { const s0 = created.src + created.osc; a.explosion(rows, dur); await tick(); return created.src + created.osc - s0; };
  const one = await count(1, 0.55), four = await count(4, 0.85);
  assert.ok(four > one, `4 rows (${four}) must sound bigger than 1 row (${one})`);
  assert.ok(four <= 40, 'bounded: ' + four);
});

test('pause / mute / restart cycle: sound resumes and keeps working', async () => {
  const a = fresh(); a.ctx.state = 'running';
  a.setActive(false); await tick(); await new Promise((r) => setTimeout(r, 150));
  assert.equal(a.ctx.state, 'suspended');
  const silent0 = created.src + created.osc;
  a.explosion(2, 0.5); await tick();
  assert.equal(created.src + created.osc, silent0, 'paused: nothing plays');
  a.setActive(true); await tick();
  assert.equal(a.ctx.state, 'running');
  a.explosion(2, 0.5); await tick();
  assert.ok(created.src + created.osc > silent0, 'after resume it plays again');
  a.setMuted(true); const m0 = created.src + created.osc; a.explosion(3, 0.5); await tick();
  assert.equal(created.src + created.osc, m0, 'muted: nothing plays');
  a.setMuted(false); await tick(); a.explosion(3, 0.5); await tick();
  assert.ok(created.src + created.osc > m0, 'unmuted: plays');
});
