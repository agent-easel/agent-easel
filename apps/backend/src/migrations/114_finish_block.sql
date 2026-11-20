-- Finish block: every Flow revision has exactly one Finish block with its ordered endings, and a
-- connection may enter one ending instead of a block. Existing revisions gain an empty Finish
-- block one layer gap (80) right of the rightmost Flow input (200 wide) or block (240 wide), level
-- with the Flow input and within the canvas limit, as the shared layout's default placement does.
-- No wire changes. The connection table is rebuilt under its immutability guard because SQLite
-- cannot make a column nullable or add a foreign key in place.
CREATE TABLE flow_revision_finish (
  flow_revision_id TEXT PRIMARY KEY NOT NULL REFERENCES flow_revisions(id),
  x REAL NOT NULL,
  y REAL NOT NULL
)
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_finish_update BEFORE UPDATE ON flow_revision_finish BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_finish_delete BEFORE DELETE ON flow_revision_finish BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
INSERT INTO flow_revision_finish (flow_revision_id, x, y)
SELECT r.id,
  min(10000, max(r.input_x + 200,
    COALESCE((SELECT max(b.x + 240) FROM flow_revision_blocks b WHERE b.flow_revision_id = r.id),
      r.input_x + 200)) + 80),
  r.input_y
FROM flow_revisions r ORDER BY r.rowid
-- statement-breakpoint
-- The Finish block's endings in order. Wires enter by `ending_id`, so a rename keeps them. Names
-- are stored trimmed and may be blank or repeated only in a draft, where readiness reports them.
CREATE TABLE flow_revision_endings (
  flow_revision_id TEXT NOT NULL REFERENCES flow_revision_finish(flow_revision_id),
  ending_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  output TEXT NOT NULL CHECK (output IN ('none', 'optional', 'required')),
  output_description TEXT NOT NULL,
  PRIMARY KEY (flow_revision_id, ending_id),
  UNIQUE (flow_revision_id, ordinal)
)
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_ending_update BEFORE UPDATE ON flow_revision_endings BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_ending_delete BEFORE DELETE ON flow_revision_endings BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
DROP TRIGGER immutable_flow_revision_connection_update
-- statement-breakpoint
DROP TRIGGER immutable_flow_revision_connection_delete
-- statement-breakpoint
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
-- A connection enters exactly one of a block (`target_block_id`) or a Finish ending
-- (`target_ending_id`); the API names the Finish block by its fixed id "finish".
CREATE TABLE flow_revision_connections_with_endings (
  flow_revision_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  source_block_id TEXT NOT NULL,
  exit_id TEXT NOT NULL,
  target_block_id TEXT,
  target_ending_id TEXT,
  CHECK ((target_block_id IS NULL) <> (target_ending_id IS NULL)),
  PRIMARY KEY (flow_revision_id, ordinal),
  UNIQUE (flow_revision_id, source_block_id, exit_id, target_block_id),
  UNIQUE (flow_revision_id, source_block_id, exit_id, target_ending_id),
  FOREIGN KEY (flow_revision_id, source_block_id)
    REFERENCES flow_revision_blocks(flow_revision_id, block_id),
  FOREIGN KEY (flow_revision_id, target_block_id)
    REFERENCES flow_revision_blocks(flow_revision_id, block_id),
  FOREIGN KEY (flow_revision_id, target_ending_id)
    REFERENCES flow_revision_endings(flow_revision_id, ending_id)
)
-- statement-breakpoint
INSERT INTO flow_revision_connections_with_endings (flow_revision_id, ordinal, source_block_id, exit_id, target_block_id)
SELECT flow_revision_id, ordinal, source_block_id, exit_id, target_block_id
FROM flow_revision_connections ORDER BY rowid
-- statement-breakpoint
DROP TABLE flow_revision_connections
-- statement-breakpoint
ALTER TABLE flow_revision_connections_with_endings RENAME TO flow_revision_connections
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_connection_update BEFORE UPDATE ON flow_revision_connections BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_connection_delete BEFORE DELETE ON flow_revision_connections BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
