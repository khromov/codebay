-- The last StructuredOutput payload the schema rejected, so a caller can salvage a run that exhausted its retries.
ALTER TABLE agent_runs ADD COLUMN rejected_structured_output TEXT;
