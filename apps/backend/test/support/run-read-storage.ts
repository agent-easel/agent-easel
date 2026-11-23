import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as Effect from "effect/Effect";
import { BeginTransaction } from "effect/sql/SqlClient";
import { CurrentTransformer } from "effect/sql/Statement";

export function commitBeforeRead(
  databasePath: string,
  statementPrefix: string,
  update: string,
  ...parameters: SQLInputValue[]
) {
  let committed = false;
  return {
    committed: () => committed,
    during: <A, E, R>(read: Effect.Effect<A, E, R>) =>
      read.pipe(
        Effect.provideService(BeginTransaction, "BEGIN"),
        Effect.provideService(CurrentTransformer, (statement) =>
          Effect.sync(() => {
            if (!committed && statement.compile()[0].startsWith(statementPrefix)) {
              using writer = new DatabaseSync(databasePath);
              committed = writer.prepare(update).run(...parameters).changes === 1;
            }
            return statement;
          }),
        ),
      ),
  };
}
