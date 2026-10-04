-- Game mode of a run: 'cylinder' | 'wall' (NULL for runs recorded before modes existed; treated as cylinder).
ALTER TABLE game_runs ADD COLUMN IF NOT EXISTS mode TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_runs_mode_check') THEN
    ALTER TABLE game_runs ADD CONSTRAINT game_runs_mode_check CHECK (mode IS NULL OR mode IN ('cylinder', 'wall'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_game_runs_mode_score ON game_runs(mode, score DESC);
