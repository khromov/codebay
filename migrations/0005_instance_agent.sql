ALTER TABLE instances
ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude'
CHECK (agent IN ('claude', 'codex'));
