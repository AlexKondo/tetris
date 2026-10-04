# Tetris Super Tower

by Alex Kondo

Cylinder Tetris rendered with Three.js (Vite, vanilla JS).

## Run

```
docker compose up -d      # Postgres on :5442 (optional - the game plays offline without it)
npm install
npm run dev:all           # Vite on :5173 + API on :3001   (or: npm run dev / npm run server)
npm test                  # unit tests (game logic, VFX sims, quality monitor, server validation)
npm run test:api          # integration test against the live DB (uses a throwaway player id)
```

URL flags: `?seed=123` (deterministic RNG), `?q=low|mid|high` (quality), `?gravity=0`, `?autostart=1`, `?debug`.

## Progress API (`server/`)

| Endpoint | Notes |
|---|---|
| `GET /api/progress/:id` | read-only; returns defaults if the player has no row |
| `PUT /api/progress/:id` | upsert; level / best score / lines never decrease; values are clamped |
| `POST /api/runs` | one transaction: insert run + update best score, total lines, level |
| `GET /api/leaderboard?limit=` | masked ids |

Protections: parameterized SQL only, 4 KB body limit, CORS limited to the dev origin, 60 requests/min per IP
(429), malformed ids/percent-encoding -> 400, and a plausibility rule for runs (see `server/validate.js`).

### Security note (no real anti-cheat)

The player id is an anonymous random UUID stored in the browser. There is no account, no signature and no
server-side game simulation, so **anyone can submit any run under any id**. The clamping and plausibility checks
only reject numbers that are impossible for the game's scoring rules (e.g. score too high for lines/level/duration);
a determined cheater can still post plausible fake scores, and the public leaderboard must not be trusted.
Real protection would need authentication plus server-side replay or validation of inputs.
