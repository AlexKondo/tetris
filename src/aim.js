// Pure camera framing math: distance, aim, vertical centring on zoom-out, user pan and a guarantee that the
// spawn/landing band stays on screen.
import { CAMERA, R_OUT, TILE_W, TILE_H, SPAWN_GAP_ROWS } from './config.js';

const rad = (d) => (d * Math.PI) / 180;
export const SPAWN_ROWS_ABOVE_RIM = 4;      // piece centre sits ~4 rows above the stack top at spawn
const TOP_ROWS_ABOVE_RIM = SPAWN_GAP_ROWS + 3.5;  // highest cell a spawned / rotated piece can reach
const BOTTOM_ROWS_BELOW_RIM = 0.5;          // lowest the piece / ghost goes (landing on the stack top)
const BOTTOM_MARGIN_NDC = 0.12;             // keep the landing zone this far above the bottom edge
const FIT_MARGIN_NDC = 0.1;                 // margin used when centring the whole playfield
export const PAN_MAX = 0.35;                // manual pan range, as a fraction of the viewport height
const LANDING_LIMIT = 0.92;                 // the stack top / landing zone never leaves this NDC band

/**
 * Frame the tower/wall.
 * @param {{w:number,h:number,wall:boolean,cols:number,pitchDeg:number,zoom:number,rimY:number,pan?:number}} o
 *   pan: user vertical pan, fraction of the viewport height; positive moves the picture DOWN (the stack top moves
 *   by exactly 2*pan in NDC; the rest of the picture follows with perspective).
 * @returns {{d:number,ty:number,camY:number,camZ:number,zoom:number,topNdc:number,bottomNdc:number,limitTop:number,
 *   baseNdc:number,centred:boolean,landNdc:number}}
 *   zoom may be larger than requested when the requested one would push the piece out of the safe band.
 *   Without pan the highest reachable cell sits just under the HUD; when the whole playfield fits (zoom out) it is
 *   centred vertically in the free viewport instead, so zooming out does not leave the picture glued to the top.
 */
export function frameFor({ w, h, wall, cols, pitchDeg, zoom, rimY, pan = 0 }) {
  const tv = Math.tan(rad(CAMERA.fov) / 2);
  const R = R_OUT + 0.1;
  const landscape = w / h > 1;
  const aspect = landscape ? (wall ? CAMERA.wallLandscapeAspect : CAMERA.landscapeAspect) : Math.min(w / h, CAMERA.maxAspect);
  const Rr = wall ? 0 : R * 0.9;
  let d0 = wall ? (cols * TILE_W + 3) / 2 / (CAMERA.widthFill * tv * aspect)
    : R / Math.sin(Math.atan(CAMERA.widthFill * tv * aspect));
  if ((1.3 * h) / (2 * tv * Math.max(1, d0 - Rr)) < CAMERA.minRowPx) d0 = (1.3 * h) / (2 * tv * CAMERA.minRowPx) + Rr;

  const hudPx = landscape ? CAMERA.hudPxLandscape : CAMERA.hudPx;
  const limitTop = 1 - (2 * hudPx) / h;      // NDC y of the HUD's lower edge
  const zF = wall ? 0 : R_OUT;               // pieces live on the front surface of the tower
  const p = rad(pitchDeg), cp = Math.cos(p), sp = Math.sin(p);
  const zMax = CAMERA.zoomMax;
  const yTop = rimY + TOP_ROWS_ABOVE_RIM * TILE_H;
  const yLand = rimY - BOTTOM_ROWS_BELOW_RIM * TILE_H;
  let z = Math.min(zMax, Math.max(CAMERA.zoomMin, zoom));
  let out = null;
  for (let i = 0; i < 60; i++) {
    const d = d0 * z;
    // look-at height that puts world height y at screen height ndc
    const tyFor = (y, ndc) => y - (ndc * tv * (d - cp * zF) + sp * zF) / (cp + ndc * tv * sp);
    const proj = (ty, y) => (cp * (y - ty) - sp * zF) / (tv * (d - sp * (y - ty) - cp * zF));
    const ndcT = limitTop - 0.012;
    let ty = tyFor(yTop, ndcT);
    const baseNdc0 = proj(ty, 0);
    const freeBottom = -1 + FIT_MARGIN_NDC;
    let centred = false;
    if (ndcT - baseNdc0 < ndcT - freeBottom) {          // the whole playfield (base .. highest reach) fits: centre it
      const delta = (ndcT + freeBottom) / 2 - (ndcT + baseNdc0) / 2;
      ty = tyFor(yTop, ndcT + delta);
      centred = true;
    }
    const topNdc = proj(ty, yTop);
    const bottomNdc = proj(ty, yLand);
    out = { d, ty, camY: ty + sp * d, camZ: cp * d, zoom: z, topNdc, bottomNdc, limitTop, baseNdc: proj(ty, 0), centred, landNdc: bottomNdc };
    if ((topNdc <= limitTop + 1e-6 && bottomNdc >= -1 + BOTTOM_MARGIN_NDC) || z >= zMax * 1.6) break;
    z *= 1.04;                                                    // too close: back off until the band fits
  }
  // user pan (applied on top; never lets the stack top / landing zone leave the screen)
  const pn = Math.max(-PAN_MAX, Math.min(PAN_MAX, Number.isFinite(pan) ? pan : 0));
  if (pn !== 0) {
    const d = out.d;
    const proj = (ty, y) => (cp * (y - ty) - sp * zF) / (tv * (d - sp * (y - ty) - cp * zF));
    const tyFor = (y, ndc) => y - (ndc * tv * (d - cp * zF) + sp * zF) / (cp + ndc * tv * sp);
    // pan is anchored on the stack top / landing zone (what the player tracks): it moves by exactly 2*pan NDC
    let ty = tyFor(yLand, out.landNdc - 2 * pn);
    const land = proj(ty, yLand);
    if (land > LANDING_LIMIT) ty = tyFor(yLand, LANDING_LIMIT);
    else if (land < -LANDING_LIMIT) ty = tyFor(yLand, -LANDING_LIMIT);
    out = { ...out, ty, camY: ty + sp * d, topNdc: proj(ty, yTop), bottomNdc: proj(ty, yLand), baseNdc: proj(ty, 0), landNdc: proj(ty, yLand), pan: pn };
  } else out.pan = 0;
  return out;
}
