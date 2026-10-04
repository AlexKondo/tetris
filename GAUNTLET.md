# Gauntlet — Cylinder Tetris (Tetris Super Tower)

Reference image: `C:\Users\remoto\AppData\Local\Temp\claude\c--projects-tetris\e20c90e5-da25-442f-8e61-138b6795ff4d\images\1.jpg`
(copy at `reference/ref.jpg`)

ENGINE: Three.js + Vite (vanilla JS, no framework). PLATFORM: mobile-first web (portrait), desktop kb/mouse too.
DB: Postgres in Docker (port 5442) — see docker-compose.yml. Progress API comes later.

## What the reference shows (observed)
- A tall HOLLOW cylinder made of cube tiles, ~36+ tiles around, ~40+ rows visible.
- Tile: white/ivory face with a red mahjong "中" glyph, gold/yellow sides & inner wall. Slight bevel, thin gaps.
- Outer surface = white faces; inside of the ring = flat gold.
- Ocean environment, hazy light-blue sky, camera slightly above looking down into the open top, tower fills the frame (portrait).
- A band of rows is exploding (tile debris, gold shards, water splash) and a notch is missing in the ring below.

## Assumed rules (reference does not prove them — simplest coherent mechanic)
- Grid wraps horizontally: COLS around the cylinder (24), ROWS tall (visible window ~20; stack builds from the bottom).
- Tetromino-like pieces fall from the top along the outer surface; left/right moves it AROUND the cylinder (wraps); rotate; soft drop; hard drop.
- A fully filled ring (all COLS) clears with an explosion; everything above drops down one row.
- Score: per ring cleared (1/2/3/4 rings = 100/300/500/800 × level). Level up every 10 rings -> faster fall.
- Game over when a new piece cannot spawn. Restart available.
- Camera slowly follows the current piece's column by rotating the tower so the active piece stays front-center.

## Quality bar (observable)
VISUAL: cylinder reads as a cylinder (curvature, perspective from above); white tile w/ red 中 glyph + gold sides; ocean + sky; soft shadows; explosion debris on clear.
GAMEPLAY: spawn, move/wrap, rotate, collide, lock, ring-clear, score, level, game-over, restart all work with zero console errors.
INPUT: touch (swipe L/R = move, tap = rotate, swipe down = drop), keyboard (arrows/WASD, space = hard drop), buttons optional.
PERFORMANCE: InstancedMesh for tiles; >= 55 fps desktop headless sanity; no per-frame allocations in hot paths; capped particles.

## Workstreams
W1 Foundation+Camera+Environment+Cylinder tiles (static render)   [visual]
W2 Game core (grid, pieces, move/rotate/collide/lock/clear/score/level/over) + keyboard  [gameplay]
W3 Piece rendering on cylinder + camera follow + touch input + UI/HUD
W4 VFX (ring-clear explosion, debris) + audio (WebAudio synth)
W5 Perf + mobile adaptation + persistence hook (API/DB)
Then: Integration critic.

## Log
- W5: PASS (critic; 269k tris / 11 calls; API+DB persistence). Cleanup round: GET read-only, rate limit, plausibleRun, desktop framing.
- INTEGRATION: first critic FAIL (HUD clipped at 320px) -> fixed -> second critic PASS (0 CRITICAL, 0 HIGH). Open MEDIUM: portrait composition vs reference (40% empty sea above rim, no horizon, 24 cols vs ~36, no base foam, chunky debris). LOW: ultrawide 22%, glyph slightly heavy.
- W4: PASS (critic). Open LOW: mute doesn't stop ambient/suspend ctx; Vfx.update per-frame option objects; debris pool exhaustion (128) on back-to-back clears; mute glyph state.
- W3: first critic FAIL (framing HIGH, lock-delay stall) -> fixed -> PASS. Open MEDIUM: desktop 1280x720 tower only ~28% width (-> W5 aspect-aware framing). LOW: ~40% empty sea above rim in portrait; 360w side crop.
- W2: first critic FAIL (empty tower, no rotation follow, slow pace) -> fixed -> second critic PASS. Open MEDIUM: spawn gap grows as stack lowers; tower small/cropped in frame (-> W3); no rotation kicks; no lock delay. LOW: weak ghost cue.
- W1: PASS (critic). Open MEDIUM: ocean banding/pale (-> W4/W5), 1.65M tris (-> W5), tower.js lacks overlay pool for active piece/debris (-> W2/W3). LOW: glyph heavy, camera pitch shallow (16deg, want 22-28).
