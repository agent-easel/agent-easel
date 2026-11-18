-- The latest access test: what each allowed channel's post did, the messages that carry it and
-- which allowed users answered. Existing installations start with no test sent.
CREATE TABLE chat_access_test_channels (
  channel_id TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('posted', 'cant-post', 'unknown-channel')),
  sent_at TEXT NOT NULL
)
-- statement-breakpoint
CREATE TABLE chat_access_test_messages (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL
)
-- statement-breakpoint
CREATE TABLE chat_access_test_users (
  user_id TEXT PRIMARY KEY,
  -- Null while the user has not answered the latest test.
  reached_at TEXT
)
