// Ornamental frame: polished-gold picture frame (wall) / collar rings (cylinder) with gems in the tile palette.
// All gold parts are merged into ONE geometry and all gems into ONE InstancedMesh -> 2 draw calls, no per-frame cost.
import {
  BoxGeometry, TorusGeometry, IcosahedronGeometry, InstancedMesh, Mesh, MeshStandardMaterial, Matrix4, Color,
  BufferAttribute, Group,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROWS, BUFFER_ROWS, TILE_H, TILE_W, R_OUT, BAND_ORDER, MAX_STACK_ROWS } from './config.js';

const GOLD = 0xdcab32;

/** Tint a geometry with a constant vertex colour (lets one merged mesh carry darker lips / lighter caps). */
function tinted(geo, k) {
  const n = geo.attributes.position.count, col = new Float32Array(n * 3).fill(k);
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
}
const box = (w, h, d, cx, cy, cz, r = 0.26, k = 1) => {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  return tinted(g.index ? g.toNonIndexed() : g, k);     // merge needs all parts non-indexed
};

/**
 * @returns {{ group: Group, goldMat: MeshStandardMaterial, dispose(): void, triangles: number }}
 */
export function buildFrame({ wall, cols }) {
  const group = new Group();
  const parts = [], gems = [];            // gems: [x, y, z, radius, colourIndex]
  const top = ROWS * TILE_H;
  if (wall) {
    const W = cols * TILE_W, hw = W / 2;
    const railX = hw + 0.5, railH = top + 1.7;
    for (const s of [-1, 1]) {
      parts.push(box(0.95, railH, 1.7, s * railX, (top + 0.6 - 0.9) / 2, 0, 0.3));                 // rail
      parts.push(box(0.16, railH - 0.8, 2.1, s * (hw + 0.04), (top - 0.3) / 2, 0, 0, 0.62));         // dark inner lip (soft shadow edge)
    }
    parts.push(box(W + 3.0, 1.15, 1.95, 0, top + 0.1, 0, 0.34));                                      // header bar
    parts.push(box(6.4, 0.9, 2.15, 0, top + 0.95, 0, 0.3, 1.08));                                     // crown cap
    parts.push(box(W + 2.6, 0.9, 2.5, 0, -0.38, 0, 0.3, 0.95));                                       // plinth, tier 1
    parts.push(box(W + 4.0, 0.7, 3.2, 0, -1.2, 0, 0.26, 0.8));                                        // plinth, tier 2
    let gi = 0;
    for (const s of [-1, 1]) {
      gems.push([s * railX, top + 0.1, 1.05, 0.66, gi++]);                                            // top corners
      gems.push([s * (hw + 1.35), -0.38, 1.3, 0.55, gi++]);                                           // base corners
      gems.push([s * railX, MAX_STACK_ROWS * TILE_H, 0.98, 0.42, 2]);                                 // danger-line anchors
      for (let r = 4; r < ROWS - 2; r += 6) gems.push([s * railX, r * TILE_H, 0.95, 0.28, gi++]);
    }
    gems.push([0, top + 0.95, 1.2, 0.55, gi++]);
    for (let i = -2; i <= 2; i++) if (i) gems.push([i * (W / 6), -0.38, 1.3, 0.3, gi++]);
  } else {
    const rc = R_OUT - 0.1, topY = (ROWS + BUFFER_ROWS + 1) * TILE_H;
    for (const [y, tube, k] of [[-0.35, 0.62, 1], [topY, 0.42, 1.05]]) {
      const t = new TorusGeometry(rc, tube, 14, 128); t.rotateX(Math.PI / 2); t.translate(0, y, 0);
      parts.push(tinted(t.toNonIndexed(), k));
    }
    const n = Math.max(12, Math.round(cols / 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      gems.push([Math.sin(a) * (rc + 0.5), -0.1, Math.cos(a) * (rc + 0.5), 0.34, i]);
      gems.push([Math.sin(a) * (rc + 0.18), topY + 0.1, Math.cos(a) * (rc + 0.18), 0.26, i + 3]);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const goldMat = new MeshStandardMaterial({ color: GOLD, metalness: 0.85, roughness: 0.3, vertexColors: true, envMapIntensity: 1.3 });
  const mesh = new Mesh(merged, goldMat);
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
  group.add(mesh);

  const gemGeo = new IcosahedronGeometry(1, 1);
  const gemMat = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.12, emissive: 0x181818 });
  const im = new InstancedMesh(gemGeo, gemMat, gems.length);
  const m = new Matrix4(), c = new Color();
  gems.forEach(([x, y, z, r, ci], i) => {
    m.makeScale(r, r, r).setPosition(x, y, z);
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.set(BAND_ORDER[ci % BAND_ORDER.length]));
  });
  im.castShadow = false; im.frustumCulled = false;
  group.add(im);

  const triangles = merged.attributes.position.count / 3 + gems.length * 80;
  return {
    group, goldMat, triangles,
    dispose() { merged.dispose(); gemGeo.dispose(); goldMat.dispose(); gemMat.dispose(); im.dispose(); },
  };
}
