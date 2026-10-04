import test from 'node:test';
import assert from 'node:assert/strict';
import { BAND_ORDER, PIECE_COLORS, TILE_COLORS, BAND_BASE } from '../src/config.js';
import { BAND_BASE as GAME_BAND_BASE, BAND_COUNT } from '../src/game/pieces.js';

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => 0.2126 * lin((h >> 16) & 255) + 0.7152 * lin((h >> 8) & 255) + 0.0722 * lin(h & 255);

test('adjacent colour bands differ in luminance (colour-blind friendly), including the wrap-around', () => {
  assert.equal(BAND_ORDER.length, BAND_COUNT);
  for (let i = 0; i < BAND_ORDER.length; i++) {
    const a = BAND_ORDER[i], b = BAND_ORDER[(i + 1) % BAND_ORDER.length];
    assert.notEqual(a, b);
    assert.ok(Math.abs(lum(a) - lum(b)) >= 0.1, `bands ${i}/${i + 1}: ${lum(a).toFixed(3)} vs ${lum(b).toFixed(3)}`);
  }
});

test('tile colour table: pieces 1..7, bands 8..15, all distinct pieces, no glyph/ivory scheme left', () => {
  assert.equal(BAND_BASE, GAME_BAND_BASE);
  assert.equal(TILE_COLORS.length, 1 + 7 + 8);
  assert.equal(new Set(PIECE_COLORS).size, 7);
  assert.ok(TILE_COLORS.slice(1).every((c) => c !== 0xf6f1e4 && c !== 0xf0c64c));
});

test('active-piece colours: lime / teal / orange are separated in luminance', () => {
  const [lime, teal, orange] = [PIECE_COLORS[3], PIECE_COLORS[0], PIECE_COLORS[6]];
  for (const [a, b] of [[lime, teal], [lime, orange], [teal, orange]]) assert.ok(Math.abs(lum(a) - lum(b)) >= 0.1, `${lum(a).toFixed(3)} vs ${lum(b).toFixed(3)}`);
});
