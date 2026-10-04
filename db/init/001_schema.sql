-- Progresso do jogador (identificado por um player_id anônimo gerado no cliente)
CREATE TABLE IF NOT EXISTS player_progress (
    player_id   TEXT PRIMARY KEY,
    level       INTEGER NOT NULL DEFAULT 1,
    best_score  INTEGER NOT NULL DEFAULT 0,
    total_lines INTEGER NOT NULL DEFAULT 0,
    state       JSONB   NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico de partidas
CREATE TABLE IF NOT EXISTS game_runs (
    id          BIGSERIAL PRIMARY KEY,
    player_id   TEXT NOT NULL REFERENCES player_progress(player_id) ON DELETE CASCADE,
    score       INTEGER NOT NULL,
    lines       INTEGER NOT NULL DEFAULT 0,
    level       INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_runs_player ON game_runs(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_runs_score ON game_runs(score DESC);
