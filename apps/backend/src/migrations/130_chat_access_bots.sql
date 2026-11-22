-- The Discord bot accounts Access lists separately from allowed users; empty on every existing
-- installation, so saved Access is untouched. Listing a bot grants nothing yet.
CREATE TABLE chat_access_bots (
  user_id TEXT PRIMARY KEY,
  position INTEGER NOT NULL
)
-- statement-breakpoint
-- Whether Discord reports the looked-up user as a bot; null while the ID is unknown or was not
-- looked up since this column exists.
ALTER TABLE chat_discord_names ADD COLUMN is_bot INTEGER CHECK (is_bot IN (0, 1))
