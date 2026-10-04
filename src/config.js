// Central tunables shared by every workstream.
// Game modes: "cylinder" (63 tiles around, wraps) and "wall" (flat wall, no wrap; 20 columns in portrait,
// 30 on a landscape window - chosen at load so tiles are ~30% smaller than the previous 44 / 14 layouts).
const LANDSCAPE = (() => { try { return window.innerWidth > window.innerHeight; } catch (_) { return false; } })();
const NARROW = (() => { try { return window.innerWidth < 380; } catch (_) { return false; } })();
export const WALL_COLS_NARROW = 14, WALL_COLS_PORTRAIT = 20, WALL_COLS_LANDSCAPE = 30; // narrow phones get a smaller wall so tiles stay >= ~16px
export const MODES = {
  cylinder: { cols: 63, minCols: 63, wrap: true, label: 'CILINDRO', unit: 'RINGS' },
  wall: { cols: LANDSCAPE ? WALL_COLS_LANDSCAPE : NARROW ? WALL_COLS_NARROW : WALL_COLS_PORTRAIT, minCols: WALL_COLS_NARROW, wrap: false, label: 'PAREDE', unit: 'ROWS' },
};
export const MODE_KEY = 'mahjong-tower-mode';
export function detectMode() {
  try {
    const q = new URLSearchParams(location.search).get('mode');
    if (q === 'wall' || q === 'cylinder') return q;
  } catch (_) { /* not in a browser */ }
  try {
    const s = localStorage.getItem(MODE_KEY);
    if (s === 'wall' || s === 'cylinder') return s;
  } catch (_) { /* storage unavailable */ }
  return 'cylinder';
}
export const MODE = detectMode();
export const WALL = MODE === 'wall';
export const COLS = MODES[MODE].cols;        // columns of the active mode
export const TILE_W = Math.PI * 0.4;           // tile pitch (same in both modes)
export const UNIT = MODES[MODE].unit;          // what a cleared line is called in the UI
export const ROWS = 44;          // playfield rows (row 0 = bottom): 30 stacking rows + spawn gap + piece room
export const BUFFER_ROWS = 4;    // extra rows above ROWS
export const MAX_STACK_ROWS = 30;   // game over when the settled stack reaches this height
export const DANGER_ROWS = 26;      // warning pulse from this stack height
export const SPAWN_GAP_ROWS = 10;   // empty rows between the stack top and a new piece (reaction room)
export const SEED_ROWS = 11;        // height of the starting stack

// Tile geometry (world units)
export const R_OUT = 12.6;       // outer radius of the white faces = 63 * TILE_W / 2pi (so tiles keep their aspect)
export const TILE_DEPTH = 0.85;  // radial thickness
export const TILE_H = 1.3;       // row height
export const FACE_DEPTH = 0.26;   // ivory face block thickness
export const FACE_PROTRUDE = 0.12;// how far the face sticks out of the gold body

export const TOWER_TOP = ROWS * TILE_H;

// Tile colours. A tile id is stored in the game grid: 1..7 = piece types (I O T S Z J L), 8..15 = the colour
// bands of the seeded starting stack (one colour per row, adjacent rows always differ in hue AND luminance).
export const PALETTE = {
  lime: 0x92d636, purple: 0x8b4fd8, blue: 0x2e90e6, teal: 0x0d968b,
  orange: 0xf6892a, red: 0xe2323c, yellow: 0xf4d02a, pink: 0xec6aaa,
};
export const PIECE_COLORS = [PALETTE.teal, PALETTE.yellow, PALETTE.purple, PALETTE.lime, PALETTE.red, PALETTE.blue, PALETTE.orange];
// cyclic order chosen so neighbouring bands differ by >= 0.1 relative luminance (colour-blind friendly)
export const BAND_ORDER = [PALETTE.lime, PALETTE.purple, PALETTE.pink, PALETTE.red, PALETTE.orange, PALETTE.teal, PALETTE.yellow, PALETTE.blue];
export const BAND_BASE = 8;
export const TILE_COLORS = [0, ...PIECE_COLORS, ...BAND_ORDER];
export const WALL_COLOR = 0x2a3140;   // neutral dark rails / base of the flat wall

export const COLORS = {
  gold: 0xf0c64c,
  skyHorizon: 0xdbe8f0,
  skyTop: 0x7fb0da,
  waterDeep: 0x053a73,
  waterShallow: 0x1c78bd,
  fog: 0xcfe0ec,
};

export const CAMERA = {
  fov: 52,
  pitchDeg: 18,        // default look-down angle (user adjustable)
  pitchMin: 8, pitchMax: 55, // tilt range in degrees
  zoomMin: 0.6, zoomMax: 1.8, // camera distance multiplier range
  widthFill: 0.9,      // tower silhouette width / viewport width (portrait)
  maxAspect: 0.7,      // landscape is framed as if the viewport were this aspect, so the tower stays big
  landscapeAspect: 0.62, // landscape: framed like a portrait viewport of this aspect
  minRowPx: 12,        // minimum tile row height in px on very short viewports // desktop: one tile row = this fraction of the viewport height
  hudPxLandscape: 24,  // landscape HUD sits at the left, so the piece may rise nearly to the top
  wallLandscapeAspect: 0.93, // wall on a landscape window: wider virtual viewport (30 columns)
  hudPx: 90,           // pixels reserved for the HUD at the top
  rimRows: 5.3,        // rows of room (HUD bottom -> rim) so the spawn zone and piece sit below the HUD
};

export const WATER_Y = -0.5;   // ocean just below the tower base so every playfield row is visible
export const MAX_DPR = 2;
