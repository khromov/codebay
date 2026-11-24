-- Which agent CLI executed the run ('claude' or 'antigravity').
ALTER TABLE agent_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
