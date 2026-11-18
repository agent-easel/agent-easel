-- The display names Discord reports, so Settings can show the bot and allowed IDs by name. Existing
-- installations keep their rows; every name is null or absent until the next ready session.
ALTER TABLE chat_control_state ADD COLUMN bot_name TEXT
-- statement-breakpoint
ALTER TABLE chat_discord_connection ADD COLUMN check_bot_name TEXT
-- statement-breakpoint
CREATE TABLE chat_discord_names (
  kind TEXT NOT NULL CHECK (kind IN ('user', 'channel')),
  discord_id TEXT NOT NULL,
  -- Null when Discord does not know the ID.
  name TEXT,
  PRIMARY KEY (kind, discord_id)
)
