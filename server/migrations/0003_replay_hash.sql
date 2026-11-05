-- Stage 7 review: the same replay can be verified only once per date (no copying a shared run under another player).
ALTER TABLE entries ADD COLUMN replay_sha TEXT;
CREATE INDEX IF NOT EXISTS entries_replay_sha ON entries (date, replay_sha) WHERE verified = 1;
