/**
 * Pointer (touch / mouse / pen) controls on an element.
 *  - horizontal drag: one move per stepPx, continuous while dragging
 *  - tap (short, barely moved): rotate
 *  - slow downward drag: soft drop, one row per rowPx
 *  - fast downward flick (release): hard drop
 */
export function attachPointerInput(el, h, isActive = () => true) {
  const o = { stepPx: 17, rowPx: 30, tapMove: 10, tapMs: 320, flickPx: 70, flickSpeed: 0.8 };
  let panDrag = false, tiltDrag = false, tiltY = 0, cancelled = false, id = null, sx = 0, sy = 0, t0 = 0, ax = 0, ay = 0, moved = false, ly = 0, lt = 0, speedY = 0;

  el.style.touchAction = 'none';
  const down = (e) => {
    if (id !== null) { cancelled = true; return; } // second finger (pinch): abort the gesture
    if (h.pan && e.pointerType === 'mouse' && (e.button === 1 || e.ctrlKey)) { // desktop: pan the view vertically
      panDrag = true; tiltY = e.clientY; id = e.pointerId;
      try { el.setPointerCapture(id); } catch (_) { /* ignore */ }
      e.preventDefault(); return;
    }
    if (h.tilt && e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey)) { // desktop: orbit-style tilt
      tiltDrag = true; tiltY = e.clientY; id = e.pointerId;
      try { el.setPointerCapture(id); } catch (_) { /* ignore */ }
      e.preventDefault(); return;
    }
    if (!isActive()) return;
    cancelled = false;
    id = e.pointerId; sx = ax = e.clientX; sy = ay = ly = e.clientY; t0 = lt = e.timeStamp; moved = false; speedY = 0;
    try { el.setPointerCapture(id); } catch (_) { /* synthetic events */ }
    e.preventDefault();
  };
  const move = (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault();
    if (panDrag) { h.pan((e.clientY - tiltY) / Math.max(1, innerHeight)); tiltY = e.clientY; return; } // drag down = picture down
    if (tiltDrag) { h.tilt((e.clientY - tiltY) * 0.25); tiltY = e.clientY; return; } // drag down = look from higher up
    if (cancelled) return;
    const dt = Math.max(1, e.timeStamp - lt);
    speedY = (e.clientY - ly) / dt; ly = e.clientY; lt = e.timeStamp;
    if (Math.abs(e.clientX - sx) > o.tapMove || Math.abs(e.clientY - sy) > o.tapMove) moved = true;
    while (e.clientX - ax >= o.stepPx) { h.right(); ax += o.stepPx; }
    while (ax - e.clientX >= o.stepPx) { h.left(); ax -= o.stepPx; }
    // slow downward drag only; fast flicks are left for pointerup
    if (speedY < o.flickSpeed) {
      while (e.clientY - ay >= o.rowPx) { h.softDrop(); ay += o.rowPx; }
    } else ay = e.clientY;
    if (e.clientY < ay) ay = e.clientY;
  };
  const up = (e) => {
    if (e.pointerId !== id) return;
    if (panDrag) { panDrag = false; id = null; try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    if (tiltDrag) { tiltDrag = false; id = null; try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    const dy = e.clientY - sy, dx = e.clientX - sx, dur = e.timeStamp - t0;
    id = null;
    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (e.type === 'pointercancel' || cancelled) { cancelled = false; return; }
    if (!moved && dur <= o.tapMs) h.rotate();
    else if (dy >= o.flickPx && Math.abs(dy) > Math.abs(dx) && (dy / Math.max(1, dur) >= o.flickSpeed || speedY >= o.flickSpeed)) h.hardDrop();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return { options: o };
}
