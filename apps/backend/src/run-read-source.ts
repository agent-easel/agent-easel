import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type {
  Result,
  RunDetail,
  RunNavigationEntry,
  SubflowInvocationPath,
} from "@t3-factory/contracts";
import { runSearch, type RunIdentity } from "./chat-control/run-search.ts";
import type { RunListExtras } from "./runner/run-store/navigation.ts";

export interface RunListSource extends RunListExtras {
  readonly navigation: readonly RunNavigationEntry[];
}

export const runListSource = (
  navigation: Effect.Effect<Result<readonly RunNavigationEntry[]>, unknown>,
  extras: Effect.Effect<Result<RunListExtras>, unknown>,
): Effect.Effect<Result<RunListSource>, unknown> =>
  Effect.gen(function* () {
    const rows = yield* navigation;
    if (!rows.ok) return rows;
    const supplemental = yield* extras;
    if (!supplemental.ok) return supplemental;
    return { ok: true, value: { navigation: rows.value, ...supplemental.value } };
  });

export interface RunReadSource {
  readonly identity: RunIdentity;
  readonly detail: RunDetail;
  readonly notInT3: boolean;
  readonly otherInvocationPaths: ReadonlyMap<string, SubflowInvocationPath>;
}

export const runReadSource =
  (
    sql: SqlClient.SqlClient,
    getRun: (id: string) => Effect.Effect<Result<RunDetail>, unknown>,
    getSubflowInvocation: (
      runId: string,
      invocationId: string,
    ) => Effect.Effect<Result<SubflowInvocationPath>, unknown>,
  ) =>
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
      const defaults = new Set(
        detail.value.subflows?.map((placement) => placement.defaultInvocation?.id),
      );
      const otherInvocationPaths = new Map<string, SubflowInvocationPath>();
      for (const { invocationId, settledAt } of detail.value.attention) {
        if (settledAt !== null || invocationId === undefined || defaults.has(invocationId))
          continue;
        if (otherInvocationPaths.has(invocationId)) continue;
        const path = yield* getSubflowInvocation(identity.id, invocationId);
        if (!path.ok) return path;
        otherInvocationPaths.set(invocationId, path.value);
      }
      const project = projects.find((candidate) => candidate.id === identity.project.id)!;
      return {
        ok: true,
        value: {
          identity,
          detail: detail.value,
          notInT3: project.availability !== "available",
          otherInvocationPaths,
        },
      };
    });
