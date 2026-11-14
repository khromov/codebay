-- The model Claude Code actually ran with, from the stream's `init` event; the requested alias stays in `options`.
ALTER TABLE agent_runs ADD COLUMN model TEXT;
