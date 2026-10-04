import {
  InstancedMesh, MeshStandardMaterial, MeshBasicMaterial, Matrix4, Mesh, BoxGeometry, CylinderGeometry, DoubleSide,
  Quaternion, Vector3, Color, Group, DynamicDrawUsage, BufferAttribute,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  COLS, ROWS, BUFFER_ROWS, R_OUT, TILE_DEPTH, TILE_H, TILE_COLORS, WALL, TILE_W, MAX_STACK_ROWS,
} from './config.js';
import { buildFrame } from './frame.js';

export const TOTAL_ROWS = ROWS + BUFFER_ROWS;
const COUNT = TOTAL_ROWS * COLS;
const STEP = (Math.PI * 2) / COLS;
const Y_AXIS = new Vector3(0, 1, 0);
const TILE_MID = R_OUT - TILE_DEPTH / 2;                 // radial centre of a tile
export const WALL_Z = TILE_MID;                          // flat wall: tile mid-depth sits on z = 0
const TILE_CENTER_SHIFT = new Matrix4().makeTranslation(0, 0, -TILE_MID); // tile centre -> origin for tumbling

export const OVERLAY_ACTIVE = 0;   // slots 0..3
export const OVERLAY_DEBRIS = 4;   // ring-clear debris
export const OVERLAY_DEBRIS_COUNT = 512;
export const OVERLAY_FALL = OVERLAY_DEBRIS + OVERLAY_DEBRIS_COUNT; // cascade: settled cells that break loose and fall
export const OVERLAY_FALL_COUNT = 384;
export const OVERLAY_COUNT = OVERLAY_FALL + OVERLAY_FALL_COUNT;

const colorOf = (type) => (TILE_COLORS[type] === undefined ? 0xcccccc : TILE_COLORS[type]);

/** A fixed-capacity pool of coloured tile instances (ONE InstancedMesh; colour per instance). */
class TilePool {
  constructor(count, geo, mat, group, shadows = true, receive = true, autoCount = true) {
    this.capacity = count;
    this.autoCount = autoCount;
    this._dirty = true;
    this._m = new Matrix4();
    this._zero = new Matrix4().makeScale(0, 0, 0);
    this._q = new Quaternion();
    this._p = new Vector3();
    this._s = new Vector3();
    this._c = new Color();
    this.on = new Uint8Array(count);
    this.mesh = new InstancedMesh(geo, mat, count);
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = receive;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    group.add(this.mesh);
    this.mesh.setColorAt(0, this._c.set(0xffffff)); // allocates instanceColor
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this._zero);
    this.setCount(0);
  }

  setCount(n) { this.mesh.count = n; }

  hide(i) {
    this.on[i] = 0;
    this.mesh.setMatrixAt(i, this._zero);
    this._dirty = true;
  }

  /** Grid-aligned tile at fractional row/col. faceColor < 0 uses the tile type's colour; boost brightens. */
  write(i, rowF, colF, type, scale = 1, faceColor = -1, boost = 1) {
    this._dirty = true;
    if (!type) { this.hide(i); return; }
    this.on[i] = 1;
    if (WALL) { // flat wall facing +Z, centred on x = 0
      this._q.identity();
      this._p.set((colF - (COLS - 1) / 2) * TILE_W, (rowF + 0.5) * TILE_H, -WALL_Z);
    } else {
      this._q.setFromAxisAngle(Y_AXIS, colF * STEP);
      this._p.set(0, (rowF + 0.5) * TILE_H, 0);
    }
    this._s.set(scale, scale, scale);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this._c.set(faceColor >= 0 ? faceColor : colorOf(type));
    if (boost !== 1) this._c.multiplyScalar(boost);
    this.mesh.setColorAt(i, this._c);
  }

  /** Free-form tile (debris): tower-local centre position, quaternion, uniform scale. */
  writeFree(i, px, py, pz, qx, qy, qz, qw, scale, color) {
    this._dirty = true;
    this.on[i] = 1;
    this._q.set(qx, qy, qz, qw);
    this._p.set(px, py, pz);
    this._s.set(scale, scale, scale);
    this._m.compose(this._p, this._q, this._s);
    this._m.multiply(TILE_CENTER_SHIFT);
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.setColorAt(i, this._c.set(color));
  }

  /** Move instance `from` over `to` (settled grid swap-remove compaction). */
  copySlot(from, to) {
    this.mesh.instanceMatrix.array.copyWithin(to * 16, from * 16, from * 16 + 16);
    this.mesh.instanceColor.array.copyWithin(to * 3, from * 3, from * 3 + 3);
  }

  /** Upload changes; returns true if anything changed. */
  flush() {
    if (!this._dirty) return false;
    if (this.autoCount) {
      let hi = 0;
      for (let i = this.capacity - 1; i >= 0; i--) if (this.on[i]) { hi = i + 1; break; }
      this.setCount(hi);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this._dirty = false;
    return true;
  }
}

/**
 * Hollow cylinder (or flat wall) of coloured glossy cube tiles. The settled grid is stored densely (only
 * existing tiles are instanced and drawn), plus a separate overlay pool (active piece, debris, falling
 * cells) and a translucent ghost pool. Col 0 faces +Z (towards the default camera); col index increases
 * clockwise seen from above.
 */
export class Tower {
  constructor() {
    this.group = new Group();
    this.type = new Uint8Array(COUNT); // 0 = empty, else tile id (index into TILE_COLORS)
    this.slot = new Int16Array(COUNT).fill(-1);       // cell -> dense instance slot
    this.cellOfSlot = new Int16Array(COUNT);          // dense slot -> cell
    this.n = 0;

    // One rounded cube per tile. Vertex colours bake a soft top highlight / bottom shade (cheap AO).
    const geo = new RoundedBoxGeometry(TILE_W * 0.94, TILE_H * 0.96, TILE_DEPTH, 1, 0.15);
    geo.translate(0, 0, TILE_MID);
    {
      const n = geo.attributes.normal, count = n.count, col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const ny = n.getY(i), nz = n.getZ(i);
        const k = 0.84 + 0.2 * ny + 0.05 * Math.max(0, nz);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.max(0.55, Math.min(1.12, k));
      }
      geo.setAttribute('color', new BufferAttribute(col, 3));
    }
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.0, vertexColors: true });
    this.geometries = [geo];
    this.mat = mat;

    this.settled = new TilePool(COUNT, geo, mat, this.group, false, true, false); // settled tiles do not cast: a cheap proxy shell does
    this.overlay = new TilePool(OVERLAY_COUNT, geo, mat, this.group);
    // translucent, saturated ghost (landing preview)
    const gmat = mat.clone();
    gmat.transparent = true; gmat.opacity = 0.62; gmat.depthWrite = false;
    gmat.emissive.set(0x3aa0f0); gmat.emissiveIntensity = 0.9;
    this.ghostMat = gmat;
    this.ghost = new TilePool(4, geo, gmat, this.group, false, false);

    // invisible shadow proxy: one cheap shell (cylinder / slab) standing in for ~2000 settled tiles in the shadow pass
    {
      const g = WALL ? new BoxGeometry(COLS * TILE_W, 1, 0.8) : new CylinderGeometry(R_OUT - 0.45, R_OUT - 0.45, 1, 96, 1, true);
      this.shadowProxy = new Mesh(g, new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }));
      this.shadowProxy.castShadow = true; this.shadowProxy.frustumCulled = false;
      this.group.add(this.shadowProxy);
      this.setShadowRows(0);
    }
    // danger line at the game-over height (thin glowing rail)
    this.dangerMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, fog: false, side: DoubleSide });
    {
      const y = MAX_STACK_ROWS * TILE_H;
      let m;
      if (WALL) { m = new Mesh(new BoxGeometry(COLS * TILE_W, 0.12, 0.1), this.dangerMat); m.position.set(0, y, 0.55); }
      else { m = new Mesh(new CylinderGeometry(R_OUT + 0.08, R_OUT + 0.08, 0.14, 128, 1, true), this.dangerMat); m.position.set(0, y, 0); }
      m.renderOrder = 4;
      this.group.add(m);
    }

    // ornamental gold frame (wall: picture frame + plinth; cylinder: base / top collar rings) with palette gems
    this.frame = buildFrame({ wall: WALL, cols: COLS });
    this.group.add(this.frame.group);
  }

  /** Release GPU resources. */
  dispose() {
    for (const g of this.geometries) g.dispose();
    this.mat.dispose(); this.ghostMat.dispose(); this.frame.dispose();
    for (const pool of [this.settled, this.overlay, this.ghost]) pool.mesh.dispose();
  }

  static index(row, col) { return row * COLS + (((col % COLS) + COLS) % COLS); }
  static angleOfCol(col) { return col * STEP; }

  /** Tower-local centre of a cell (mid-depth), written into `out`. */
  cellPosition(row, col, out = new Vector3()) {
    if (WALL) return out.set((col - (COLS - 1) / 2) * TILE_W, (row + 0.5) * TILE_H, 0);
    const a = col * STEP;
    return out.set(Math.sin(a) * TILE_MID, (row + 0.5) * TILE_H, Math.cos(a) * TILE_MID);
  }

  _alloc(i) {
    if (this.slot[i] < 0) {
      this.slot[i] = this.n; this.cellOfSlot[this.n] = i; this.n++;
      this.settled.setCount(this.n);
    }
    return this.slot[i];
  }

  _free(i) {
    const s = this.slot[i];
    if (s < 0) return;
    const last = this.n - 1;
    if (s !== last) {
      this.settled.copySlot(last, s);
      const lc = this.cellOfSlot[last];
      this.slot[lc] = s; this.cellOfSlot[s] = lc;
    }
    this.slot[i] = -1; this.n--;
    this.settled.setCount(this.n);
    this.settled._dirty = true;
  }

  /**
   * Place a settled tile. type: tile id (colour index; 0 clears).
   * opts (optional): colF, rowF, scale, faceColor. Prefer setTileFx in hot paths (no object).
   */
  setTile(row, col, type = 1, opts) {
    if (opts) {
      this.setTileFx(row, col, type, opts.scale === undefined ? 1 : opts.scale,
        opts.faceColor === undefined ? -1 : opts.faceColor,
        opts.rowF === undefined ? row : opts.rowF, opts.colF === undefined ? col : opts.colF);
    } else this.setTileFx(row, col, type, 1, -1, row, col);
  }

  setTileFx(row, col, type, scale = 1, faceColor = -1, rowF = row, colF = col, boost = 1) {
    if (row < 0 || row >= TOTAL_ROWS) return;
    const i = Tower.index(row, col);
    if (!type) { this._free(i); this.type[i] = 0; return; }
    this.type[i] = type;
    this.settled.write(this._alloc(i), rowF, colF, type, scale, faceColor, boost);
  }

  /** Move an existing settled tile to a fractional row. */
  setTileRow(row, col, rowF) {
    const i = Tower.index(row, col), s = this.slot[i];
    if (s >= 0) this.settled.write(s, rowF, col, this.type[i], 1, -1);
  }

  clearTile(row, col) { this.setTileFx(row, col, 0); }

  getTile(row, col) {
    if (row < 0 || row >= TOTAL_ROWS) return 0;
    return this.type[Tower.index(row, col)];
  }

  /** Remove every settled tile. */
  clear() {
    this.type.fill(0); this.slot.fill(-1); this.n = 0;
    this.settled.setCount(0); this.settled._dirty = true;
  }

  /** Bulk-load a grid: grid[row][col] = tile id (rows may be missing). */
  setGrid(grid) {
    for (let r = 0; r < TOTAL_ROWS; r++) {
      const line = grid[r];
      for (let c = 0; c < COLS; c++) this.setTile(r, c, line ? line[c] || 0 : 0);
    }
  }

  /** Overlay pool (active piece / debris). slot in [0, OVERLAY_COUNT). boost > 1 brightens (glow). */
  setOverlay(slot, rowF, colF, type, faceColor = -1, boost = 1) { this.overlay.write(slot, rowF, colF, type, 1, faceColor, boost); }
  hideOverlay(slot) { this.overlay.hide(slot); }
  /** Hide `n` overlay slots starting at `from`. */
  hideOverlayRange(from, n) { for (let i = from; i < from + n; i++) this.overlay.hide(i); }
  /** Debris tile in overlay slot `OVERLAY_DEBRIS + k` (tower-local free transform). */
  setDebris(k, px, py, pz, qx, qy, qz, qw, scale, color) {
    this.overlay.writeFree(OVERLAY_DEBRIS + k, px, py, pz, qx, qy, qz, qw, scale, color);
  }
  hideDebris(k) { this.overlay.hide(OVERLAY_DEBRIS + k); }

  /** Cascade: a settled cell that broke loose and is falling (fractional row). */
  setFall(k, rowF, col, type, boost = 1) { this.overlay.write(OVERLAY_FALL + k, rowF, col, type, 1, -1, boost); }
  hideFall(k) { this.overlay.hide(OVERLAY_FALL + k); }

  /** Size the shadow proxy to the stack height (rows). */
  setShadowRows(rows) {
    const h = Math.max(0.01, rows * TILE_H);
    this.shadowProxy.scale.set(1, h, 1);
    this.shadowProxy.position.set(0, h / 2, 0);
  }

  /** Danger line at the game-over height; pulses white <-> red when `warn` (stack close to the limit). */
  setDanger(warn, t) {
    const m = this.dangerMat;
    if (warn) {
      const k = 0.5 + 0.5 * Math.sin(t * 6);
      m.opacity = 0.55 + 0.4 * k;
      m.color.setRGB(1, 1 - 0.8 * k, 1 - 0.8 * k);
    } else { m.opacity = 0.4; m.color.setRGB(1, 1, 1); }
  }

  /** Dim/tint all tiles (1 = normal). */
  setDim(k) { this.mat.color.setScalar(k); this.frame.goldMat.color.setHex(0xdcab32).multiplyScalar(k); }

  /** Ghost (landing preview) pool, 4 slots. */
  setGhost(slot, rowF, colF) { this.ghost.write(slot, rowF, colF, 3, 1, 0x7fd0ff); }
  hideGhost() { for (let i = 0; i < 4; i++) this.ghost.hide(i); }

  /** Rotate the whole tower around its axis (radians). */
  setRotation(a) { this.group.rotation.y = a; }

  /** Upload changes. Call once per frame. Returns true if any tile data changed. */
  flush() {
    const a = this.settled.flush(), b = this.overlay.flush(), c = this.ghost.flush();
    return a || b || c;
  }
}
