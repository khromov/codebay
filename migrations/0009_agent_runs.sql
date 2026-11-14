CREATE TABLE IF NOT EXISTS agent_runs (
  id                TEXT PRIMARY KEY,
  instance_id       TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  status            TEXT NOT NULL,
  session_id        TEXT,
  resume_session_id TEXT,
  options           TEXT,
  result            TEXT,
  structured_output TEXT,
  last_activity     TEXT,
  is_error          INTEGER NOT NULL DEFAULT 0,
  exit_code         INTEGER,
  cost_usd          REAL,
  duration_ms       INTEGER,
  num_turns         INTEGER,
  error             TEXT,
  created_at        INTEGER NOT NULL,
  started_at        INTEGER,
  finished_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_instance ON agent_runs(instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
