// Tetromino definitions. Cells are [dc, dr] offsets from the pivot; dr grows upward.
export const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const SHAPES = {
  I: [[-1, 0], [0, 0], [1, 0], [2, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[-1, 0], [0, 0], [1, 0], [0, 1]],
  S: [[-1, 0], [0, 0], [0, 1], [1, 1]],
  Z: [[-1, 1], [0, 1], [0, 0], [1, 0]],
  J: [[-1, 1], [-1, 0], [0, 0], [1, 0]],
  L: [[1, 1], [-1, 0], [0, 0], [1, 0]],
};

/** Tile ids >= BAND_BASE are the colour bands of the seeded starting stack (8 colours). */
export const BAND_BASE = 8;
export const BAND_COUNT = 8;

/** Piece id stored in the grid: 1..7 (0 = empty). */
export function pieceId(name) { return PIECE_NAMES.indexOf(name) + 1; }

const CACHE = {};
for (const name of PIECE_NAMES) {
  CACHE[name] = [];
  let cells = SHAPES[name];
  for (let r = 0; r < 4; r++) {
    CACHE[name].push(name === 'O' ? SHAPES.O : cells);
    cells = cells.map(([x, y]) => [y, 0 - x]); // CW with y up
  }
}

/** Offsets of `name` after `rot` clockwise quarter turns (cached, do not mutate). */
export function rotatedCells(name, rot) {
  return CACHE[name][((rot % 4) + 4) % 4];
}
