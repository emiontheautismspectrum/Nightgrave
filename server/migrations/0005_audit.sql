-- Security and operations audit (additive only; safe to apply while the old Worker runs, and the new Worker keeps
-- working before it is applied: every audit write is best effort).
-- The audit log holds NO personal data: never tokens, IPs, request bodies, names, messages or player ids.
--   admin actions:   action 'admin_delete' / 'admin_clear_message', entry_id, result 'ok'
--   verifier:        action 'verify', entry_id, result 'accepted' or 'rejected:<reason code>'
--   failed tokens:   action 'auth_fail_verify' / 'auth_fail_admin', at = the start of the hour (ms), entry_id NULL,
--                    result = the number of failed attempts in that hour (ONE row per hour and kind, an UPSERT counter)
-- Kept 90 days (the daily cron prunes it).
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  entry_id INTEGER,
  result TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
-- the hourly failed-token counters: one row per (kind, hour)
CREATE UNIQUE INDEX IF NOT EXISTS audit_auth_fail ON audit (action, at) WHERE entry_id IS NULL;
-- (No new index on ratelimit: every index adds one more written row to each rate-limit UPSERT, which costs more of the
-- free D1 write quota than the daily cleanup's scan of at most one day of windows costs in reads.)
