-- Display name a repo's codebay.json gives a forwarded port; NULL for unnamed and user-added ones.
ALTER TABLE port_forwards ADD COLUMN label TEXT;

-- Container ports already seeded from the project's own files. The seed now runs on every provision,
-- so without this a port the user removed by hand would come back on the next restart.
-- NULL pre-dates the column and is read as "whatever this instance already forwards".
ALTER TABLE instances ADD COLUMN seeded_ports TEXT;
