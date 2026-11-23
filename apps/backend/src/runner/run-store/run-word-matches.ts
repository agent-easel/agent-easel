import type * as SqlClient from "effect/sql/SqlClient";

export const runWordMatches = (sql: SqlClient.SqlClient, words: readonly string[]) =>
  words.map((word) => {
    const pattern = `%${word.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    return sql`(r.title || ' ' || p.title || ' ' || p.workspace_root || ' ' || f.name) LIKE ${pattern} ESCAPE '\\'`;
  });
