def edit(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (p, a)
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)

# ============ config ============
s = open('src/config.js', encoding='utf8').read()
a = s.index("// Game modes:")
b = s.index("export const MODE_KEY")
s = s[:a] + """// Game modes: "cylinder" (63 tiles around, wraps) and "wall" (flat wall, no wrap; 20 columns in portrait,
// 30 on a landscape window - chosen at load so tiles are ~30% smaller than the previous 44 / 14 layouts).
const LANDSCAPE = (() => { try { return window.innerWidth > window.innerHeight; } catch (_) { return false; } })();
export const WALL_COLS_PORTRAIT = 20, WALL_COLS_LANDSCAPE = 30;
export const MODES = {
  cylinder: { cols: 63, minCols: 63, wrap: true, label: 'CILINDRO', unit: 'RINGS' },
  wall: { cols: LANDSCAPE ? WALL_COLS_LANDSCAPE : WALL_COLS_PORTRAIT, minCols: WALL_COLS_PORTRAIT, wrap: false, label: 'PAREDE', unit: 'ROWS' },
};
""" + s[b:]
s = s.replace("export const ROWS = 40;          // playfield rows (row 0 = bottom)\nexport const BUFFER_ROWS = 4;    // extra rows above ROWS where new pieces can spawn",
 "export const ROWS = 44;          // playfield rows (row 0 = bottom): 30 stacking rows + spawn gap + piece room\nexport const BUFFER_ROWS = 4;    // extra rows above ROWS\nexport const MAX_STACK_ROWS = 30;   // game over when the settled stack reaches this height\nexport const DANGER_ROWS = 26;      // warning pulse from this stack height\nexport const SPAWN_GAP_ROWS = 10;   // empty rows between the stack top and a new piece (reaction room)\nexport const SEED_ROWS = 11;        // height of the starting stack")
s = s.replace("export const R_OUT = 8.8;        // outer radius of the white faces = 44 * TILE_W / 2pi (so tiles keep their aspect)", "export const R_OUT = 12.6;       // outer radius of the white faces = 63 * TILE_W / 2pi (so tiles keep their aspect)")
s = s.replace("  hudPx: 90,", "  wallLandscapeAspect: 0.93, // wall on a landscape window: wider virtual viewport (30 columns)\n  hudPx: 90,")
s = s.replace("minRowPx: 22,", "minRowPx: 12,")
open('src/config.js', 'w', encoding='utf8').write(s)

# ============ aim.js ============
edit('src/aim.js', [
    ("import { CAMERA, R_OUT, TILE_W, TILE_H } from './config.js';", "import { CAMERA, R_OUT, TILE_W, TILE_H, SPAWN_GAP_ROWS } from './config.js';"),
    ("const TOP_ROWS_ABOVE_RIM = 6.5;             // highest cell a spawned / rotated piece can reach", "const TOP_ROWS_ABOVE_RIM = SPAWN_GAP_ROWS + 3.5;  // highest cell a spawned / rotated piece can reach"),
    ("const aspect = landscape ? CAMERA.landscapeAspect : Math.min(w / h, CAMERA.maxAspect);", "const aspect = landscape ? (wall ? CAMERA.wallLandscapeAspect : CAMERA.landscapeAspect) : Math.min(w / h, CAMERA.maxAspect);"),
])

# ============ tower ============
edit('src/tower.js', [
    ("export const OVERLAY_DEBRIS_COUNT = 192;\nexport const OVERLAY_COUNT = OVERLAY_DEBRIS + OVERLAY_DEBRIS_COUNT;",
     "export const OVERLAY_DEBRIS_COUNT = 256;       // ring-clear debris\nexport const OVERLAY_FALL = OVERLAY_DEBRIS + OVERLAY_DEBRIS_COUNT; // cascade: settled cells that break loose and fall\nexport const OVERLAY_FALL_COUNT = 384;\nexport const OVERLAY_COUNT = OVERLAY_FALL + OVERLAY_FALL_COUNT;"),
    ("  TILE_TYPES, COLORS, WALL, TILE_W,\n} from './config.js';", "  TILE_TYPES, COLORS, WALL, TILE_W, MAX_STACK_ROWS,\n} from './config.js';"),
    ("const faceGeo = new RoundedBoxGeometry(faceW, faceH, FACE_DEPTH, 2, 0.12);", "const faceGeo = new RoundedBoxGeometry(faceW, faceH, FACE_DEPTH, 1, 0.12);"),
    ("  /** Dim/tint all tiles (1 = normal). */", """  /** Cascade: a settled cell that broke loose and is falling (fractional row). faceColor < 0 = default. */
  setFall(k, rowF, col, faceColor = -1) { this.overlay.write(OVERLAY_FALL + k, rowF, col, 1, 1, faceColor); }
  hideFall(k) { this.overlay.hide(OVERLAY_FALL + k); }

  /** Danger line at the game-over height; pulses red when `warn` (stack close to the limit). */
  setDanger(warn, t) {
    const m = this.dangerMat;
    if (!m) return;
    m.opacity = warn ? 0.45 + 0.45 * Math.abs(Math.sin(t * 5)) : 0.32;
    m.color.setHex(warn ? 0xff2a1f : 0xff5a4a);
  }

  /** Dim/tint all tiles (1 = normal). */"""),
    ("    if (WALL) { // base slab + side rails of the flat wall", """    // danger line at the game-over height (thin translucent red rail)
    this.dangerMat = new MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.32, depthWrite: false, fog: false, side: DoubleSide });
    {
      const y = MAX_STACK_ROWS * TILE_H;
      let m;
      if (WALL) { m = new Mesh(new BoxGeometry(COLS * TILE_W, 0.12, 0.1), this.dangerMat); m.position.set(0, y, 0.62); }
      else { m = new Mesh(new CylinderGeometry(R_OUT + 0.08, R_OUT + 0.08, 0.14, 128, 1, true), this.dangerMat); m.position.set(0, y, 0); }
      m.renderOrder = 4;
      this.group.add(m);
    }

    if (WALL) { // base slab + side rails of the flat wall"""),
    ("  InstancedMesh, MeshStandardMaterial, Matrix4, Mesh, BoxGeometry,", "  InstancedMesh, MeshStandardMaterial, MeshBasicMaterial, Matrix4, Mesh, BoxGeometry, CylinderGeometry, DoubleSide,"),
])

# ============ scene shadow range for the bigger tower ============
edit('src/scene.js', [("sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 15; sc.far = 130;", "sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 10; sc.far = 150;")])

# ============ main ============
edit('src/main.js', [
    ("import { COLS, ROWS, TILE_H, MODE, MODES, WALL, MODE_KEY, UNIT } from './config.js';", "import { COLS, ROWS, BUFFER_ROWS, TILE_H, MODE, MODES, WALL, MODE_KEY, UNIT, MAX_STACK_ROWS, DANGER_ROWS, SPAWN_GAP_ROWS, SEED_ROWS } from './config.js';"),
    ("  rng: makeRng(seedParam), rows: 31, buffer: 13, initialStack: true, relativeSpawn: true,\n  cols: COLS, wrap: MODES[MODE].wrap, spawnCol: WALL ? Math.floor((COLS - 1) / 2) : 0,",
     "  rng: makeRng(seedParam), rows: ROWS, buffer: BUFFER_ROWS, initialStack: true, relativeSpawn: true,\n  spawnGap: SPAWN_GAP_ROWS, seedRows: SEED_ROWS, maxStack: MAX_STACK_ROWS, cascade: true,\n  cols: COLS, wrap: MODES[MODE].wrap, spawnCol: WALL ? Math.floor((COLS - 1) / 2) : 0,"),
    ("let preGrid = logic.grid.slice();\n", ""),
    ("  preGrid = logic.grid.slice();\n", ""),
    ("  vfx.startClear(e.rows, preGrid, logic.cols, logic.totalRows);\n  audio.clear(e.count);\n  const gain = SCORE_TABLE[Math.min(4, e.count)] * logic.level;\n  ui.popup('+' + gain, e.count >= 2);\n  if (e.count >= 2) ui.popup(e.count + ' ' + UNIT + '!', true);",
     "  vfx.startClear(e.steps, logic.cols, logic.totalRows);\n  audio.clear(e.count + e.chain - 1);\n  ui.popup('+' + e.gain, e.count >= 2 || e.chain >= 2);\n  if (e.chain >= 2) ui.popup('CHAIN x' + e.chain + '!', true);\n  else if (e.count >= 2) ui.popup(e.count + ' ' + UNIT + '!', true);"),
    ("  tower.flush() || vfx.shakeAmp > 0", "  tower.flush() || vfx.shakeAmp > 0"),
])
