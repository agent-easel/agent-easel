-- Every settlement records why it ended the Run: `manual` for the user's confirmed Settle, `finish`
-- for the stop-and-settle a Flow starts when a Run reaches an ending. A Run Factory settles
-- automatically has no stop attempt and records its reason on the `run-settled` event, which
-- already names `automatic` or `manual`. Every confirmed settlement recorded before this
-- migration was the user's, so it keeps its history and becomes `manual`.
ALTER TABLE run_settlements ADD COLUMN reason TEXT NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual', 'finish'))
