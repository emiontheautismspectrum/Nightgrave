-- Hard daily board. One row per (date, player): the player's best run of that UTC day.
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT,
  score INTEGER NOT NULL,
  hero TEXT NOT NULL,
  duration_ticks INTEGER NOT NULL,
  replay TEXT NOT NULL,
  -- when this score was achieved (ms since epoch): ties are won by the earlier submission
  achieved_at INTEGER NOT NULL,
  UNIQUE (date, player_id)
);
CREATE INDEX IF NOT EXISTS entries_board ON entries (date, score DESC, achieved_at ASC, id ASC);

-- Fixed-window rate limits: key = "<kind>:<hash>", window = window start (ms).
CREATE TABLE IF NOT EXISTS ratelimit (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);
