import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { Result, RunDetail } from "@t3-factory/contracts";
import { runSearch, type RunIdentity } from "./chat-control/run-search.ts";

export interface RunReadSource {
  readonly identity: RunIdentity;
  readonly detail: RunDetail;
  readonly notInT3: boolean;
}

export const runReadSource =
  (sql: SqlClient.SqlClient, getRun: (id: string) => Effect.Effect<Result<RunDetail>, unknown>) =>
  (reference: { id: string } | { number: number }) =>
    Effect.gen(function* (): Effect.fn.Return<Result<RunReadSource | null>, unknown> {
      const projects = yield* sql<{
        id: string;
        availability: string;
      }>`SELECT id,availability FROM projects`;
      const identity = yield* runSearch(sql).reference(
        projects.map((project) => project.id),
        reference,
      );
      if (!identity) return { ok: true, value: null };
      const detail = yield* getRun(identity.id);
      if (!detail.ok) return detail;
      const project = projects.find((candidate) => candidate.id === identity.project.id)!;
      return {
        ok: true,
        value: {
          identity,
          detail: detail.value,
          notInT3: project.availability !== "available",
        },
      };
    });
