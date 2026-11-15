-- Theme colors are read over the T3 connection instead of a separately paired grant, so the
-- stored presentation no longer names one. The colors, theme, environment and resolver pin are
-- kept unchanged; only the grant reference is removed.
UPDATE appearance_snapshot
SET presentation = json_remove(presentation, '$.grant')
WHERE json_type(presentation, '$.grant') IS NOT NULL
