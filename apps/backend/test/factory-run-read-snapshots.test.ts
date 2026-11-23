import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { preparedService } from "./support/prepared-runner.ts";
import { commitBeforeRead } from "./support/run-read-storage.ts";
import { joinProblemInEarlierInvocation } from "./support/run-read-subflows.ts";

it.effect("a rename during Run listing cannot match a title the listing does not show", (c) =>
  Effect.gen(function* () {
    // Arrange
    const { factory, input, h } = yield* preparedService(c);
    const run = yield* factory.startRun({ ...input, title: "Before rename" });
    assert(run.ok);
    const rename = commitBeforeRead(
      h.databasePath,
      "SELECT r.id,r.number,r.title,r.created_at",
      "UPDATE runs SET title = ? WHERE id = ?",
      "After rename",
      run.value.id,
    );

    // Act
    const listing = yield* rename.during(factory.listRunReadSnapshot(["after"]));

    // Assert
    assert(listing.ok);
    expect(rename.committed()).toBe(true);
    expect(listing.value.navigation).toMatchObject([{ title: "Before rename" }]);
    expect(listing.value.startedAt.has(run.value.id)).toBe(false);
  }),
);

it.effect("settling a Run during a read preserves the lifecycle of the returned detail", (c) =>
  Effect.gen(function* () {
    // Arrange
    const { factory, input, h } = yield* preparedService(c);
    const run = yield* factory.startRun(input);
    assert(run.ok);
    const settle = commitBeforeRead(
      h.databasePath,
      "SELECT r.*,t.project_id,t.title AS task_title",
      "UPDATE runs SET settled_at = ?, gate_open = 0 WHERE id = ?",
      "2026-01-01T00:00:00.000Z",
      run.value.id,
    );

    // Act
    const snapshot = yield* settle.during(factory.readRunByReference({ id: run.value.id }));

    // Assert
    assert(snapshot.ok && snapshot.value);
    expect(settle.committed()).toBe(true);
    expect(snapshot.value.identity.state).toBe("active");
    expect(snapshot.value.detail.lifecycle).toBe("active");
    expect(snapshot.value.detail.gateOpen).toBe(true);
  }),
);

it.effect(
  "a read keeps a pending Problem and its non-default invocation on the same snapshot",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const { f, h, t3, github, runId } = yield* Effect.promise(() =>
        joinProblemInEarlierInvocation(c),
      );
      const before = yield* Effect.promise(() => f.getRun(runId));
      assert(before.ok);
      const invocationId = before.value.attention.find(
        (matter) => matter.kind === "join-integrity",
      )?.invocationId;
      assert(invocationId);
      const prior = yield* Effect.promise(() => f.getSubflowInvocation(runId, invocationId));
      assert(prior.ok);
      yield* Effect.promise(() => f.close());
      const factory = yield* h.service({ t3, github, connectionRetryMs: 60_000 });
      const update = commitBeforeRead(
        h.databasePath,
        "WITH RECURSIVE path AS (",
        "UPDATE subflow_invocations SET completed_at = ? WHERE id = ?",
        "2026-12-01T00:00:00.000Z",
        invocationId,
      );

      // Act
      const snapshot = yield* update.during(factory.readRunByReference({ id: runId }));

      // Assert
      assert(snapshot.ok && snapshot.value);
      expect(update.committed()).toBe(true);
      expect(snapshot.value.detail.attention).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "join-integrity", invocationId, settledAt: null }),
        ]),
      );
      expect(snapshot.value.otherInvocationPaths.get(invocationId)?.invocation.completedAt).toBe(
        prior.value.invocation.completedAt,
      );
    }),
);
