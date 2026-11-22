-- A typed requester-bound reply replaces the Confirm button. A review's last message carries the
-- confirmation phrase with this one-time code; replies to that message are matched by its ID.
ALTER TABLE chat_proposals RENAME COLUMN button_message_id TO confirmation_message_id
-- statement-breakpoint
-- 1 once the review's last message needs no further edit to show how the review was resolved.
ALTER TABLE chat_proposals RENAME COLUMN button_settled TO resolution_settled
-- statement-breakpoint
-- The review's one-time confirmation code; reviews presented with a button have none.
ALTER TABLE chat_proposals ADD COLUMN confirmation_code TEXT
-- statement-breakpoint
-- No dual path: a review still waiting for a button click expires now and nothing is confirmed by
-- a button again. Button messages are never edited into the typed contract's resolution text.
UPDATE chat_proposals SET resolution_settled=1,
  expires_at=CASE WHEN state='presented' AND expires_at>created_at THEN created_at ELSE expires_at END
