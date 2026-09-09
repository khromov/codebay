ALTER TABLE instances ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude' CHECK (agent IN ('claude', 'codex'));
ALTER TABLE instances ADD COLUMN agent_selection TEXT NOT NULL DEFAULT 'claude' CHECK (agent_selection IN ('claude', 'codex', 'both'));
ALTER TABLE agent_runs ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude' CHECK (agent IN ('claude', 'codex'));
ALTER TABLE agent_runs ADD COLUMN token_usage TEXT;
