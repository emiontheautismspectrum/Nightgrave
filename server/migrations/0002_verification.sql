-- Stage 7: replay verification. Each (date, player) row has a VERIFIED part (the existing columns, shown on the
-- board only when verified = 1) and one PENDING submission slot (p_* columns, never shown publicly).
ALTER TABLE entries ADD COLUMN verified INTEGER NOT NULL DEFAULT 1; -- rows from before this migration count as verified
ALTER TABLE entries ADD COLUMN p_seq INTEGER NOT NULL DEFAULT 0;   -- submission version (race-safe promotion)
ALTER TABLE entries ADD COLUMN p_score INTEGER;
ALTER TABLE entries ADD COLUMN p_name TEXT;
ALTER TABLE entries ADD COLUMN p_message TEXT;
ALTER TABLE entries ADD COLUMN p_hero TEXT;
ALTER TABLE entries ADD COLUMN p_duration INTEGER;
ALTER TABLE entries ADD COLUMN p_replay TEXT;
ALTER TABLE entries ADD COLUMN p_tuning TEXT;
ALTER TABLE entries ADD COLUMN p_client TEXT;
ALTER TABLE entries ADD COLUMN p_at INTEGER;
ALTER TABLE entries ADD COLUMN reject_reason TEXT;
CREATE INDEX IF NOT EXISTS entries_pending ON entries (p_at) WHERE p_replay IS NOT NULL;
