// Anonymous-player progress persistence. Fully optional: every failure degrades to local-only play.
const ID_KEY = 'mahjong-tower-player';
const BEST_KEY = 'mahjong-tower-best';
const TIMEOUT_MS = 7000;

function store(op, key, val) {
  try { return op === 'get' ? localStorage.getItem(key) : localStorage.setItem(key, val); } catch (_) { return null; }
}

function makeId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fall through */ }
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class Persistence {
  constructor(base = '/api', mode = 'cylinder') {
    this.base = base;
    this.mode = mode;
    let id = store('get', ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = makeId(); store('set', ID_KEY, id); }
    this.playerId = id;
    this.bestKey = BEST_KEY + '-' + mode;
    this.best = Number(store('get', this.bestKey)) || 0;
    this.online = false;
    this._warned = false;
    this.onBest = null;
  }

  _warn(msg) {
    if (this._warned) return;
    this._warned = true;
    console.warn('[progress] ' + msg + ' - playing offline (scores saved locally only)');
  }

  async _req(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(this.base + path, {
        method, signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || j.offline) throw new Error('api unavailable');
      this.online = true;
      return j;
    } catch (e) {
      this.online = false;
      this._warn(e.name === 'AbortError' ? 'API timed out' : e.message);
      return null;
    } finally { clearTimeout(timer); }
  }

  _setBest(n) {
    if (n > this.best) { this.best = n; store('set', this.bestKey, String(n)); if (this.onBest) this.onBest(n); }
  }

  /** Load the best score from the server (falls back to the local one). */
  async load() {
    const j = await this._req('GET', '/progress/' + encodeURIComponent(this.playerId) + '?mode=' + this.mode);
    if (j && Number.isFinite(j.bestScore)) this._setBest(j.bestScore);
    return this.best;
  }

  /** Record a finished run. Updates the local best immediately, then tries the server. */
  async saveRun({ score, lines, level, durationMs }) {
    this._setBest(score);
    const j = await this._req('POST', '/runs', { playerId: this.playerId, mode: this.mode, score, lines, level, durationMs: Math.round(durationMs) });
    if (j && Number.isFinite(j.bestScore)) this._setBest(j.bestScore);
    return j;
  }
}
