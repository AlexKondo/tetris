// User-adjustable camera view (tilt + zoom). Pure helpers plus a tiny persisted state holder.
import { CAMERA } from './config.js';
import { PAN_MAX } from './aim.js';

export const PITCH_STEP = 4;       // degrees per press
export const ZOOM_STEP = 1.12;     // multiplier per press
export const PAN_STEP = 0.06;      // fraction of the viewport height per press (positive pan = picture moves DOWN)
const KEY = 'mahjong-tower-view';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clampPitch = (p) => clamp(Number.isFinite(p) ? p : CAMERA.pitchDeg, CAMERA.pitchMin, CAMERA.pitchMax);
export const clampZoom = (z) => clamp(Number.isFinite(z) ? z : 1, CAMERA.zoomMin, CAMERA.zoomMax);
/** dir > 0 raises the camera (looks down more), dir < 0 lowers it. */
export const stepPitch = (p, dir) => clampPitch(p + Math.sign(dir) * PITCH_STEP);
/** dir > 0 zooms in (smaller camera distance), dir < 0 zooms out. */
export const stepZoom = (z, dir) => clampZoom(dir > 0 ? z / ZOOM_STEP : z * ZOOM_STEP);

export const clampPan = (v) => clamp(Number.isFinite(v) ? v : 0, -PAN_MAX, PAN_MAX);
/** dir > 0 moves the picture down, dir < 0 up. */
export const stepPan = (v, dir) => clampPan(v + Math.sign(dir) * PAN_STEP);

/** Sanitise a stored/untrusted view object. */
export function sanitizeView(v) {
  const o = v && typeof v === 'object' ? v : {};
  return { pitch: clampPitch(Number(o.pitch)), zoom: clampZoom(Number(o.zoom)), pan: clampPan(Number(o.pan)) };
}

// NOTE: the global `localStorage` getter can throw (blocked storage / private mode), so it is only read inside try.
export function loadView(storage) {
  try {
    const s = storage === undefined ? localStorage : storage;
    return sanitizeView(JSON.parse(s.getItem(KEY)));
  } catch (_) { return sanitizeView(null); }
}

export function saveView(v, storage) {
  try {
    const s = storage === undefined ? localStorage : storage;
    s.setItem(KEY, JSON.stringify({ pitch: v.pitch, zoom: v.zoom, pan: v.pan || 0 }));
  } catch (_) { /* storage unavailable */ }
}
