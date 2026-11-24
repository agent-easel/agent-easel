import { expect, it } from "@effect/vitest";
import type { ConditionArrivalPage } from "@agent-easel/contracts";
import { assertOk } from "./support/domain-setup.ts";
import { factoryHarness } from "./support/factory.ts";
import { loadMigrationData, restoreCapturedAdapter } from "./support/migration-data.ts";

type Capture = {
  waitingId: string;
  workerBlockId: string;
  occurrenceId: string;
  condition: ConditionArrivalPage;
  uncertainId: string;
  uncertainKey: string;
  uncertainBlockId: string;
  t3: Record<string, unknown>;
};

it("upgrades numbered Condition history and outstanding root work without changing Block or launch keys", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const capture = await loadMigrationData<Capture>(
    h.databasePath,
    "run-scope-baseline-upgrade-data.json",
  );
  const t3 = await restoreCapturedAdapter(capture.t3, h.processHome);

  // Act
  const f = await h.open({ t3 });

  // Assert
  const history = assertOk(await f.listConditionArrivals(capture.waitingId, "gate", "", ""));
  expect(history).toStrictEqual(capture.condition);
  const pending = assertOk(await f.getRun(capture.waitingId));
  expect(pending.humanOccurrences).toMatchObject([
    { id: capture.occurrenceId, blockId: "review", state: "pending" },
  ]);
  expect(await f.runtime.block({ arguments: { blockId: capture.workerBlockId } })).toMatchObject({
    code: "BLOCK",
  });
  const recovered = assertOk(await f.getRun(capture.uncertainId));
  expect(recovered.intents).toContainEqual(
    expect.objectContaining({
      requestKey: capture.uncertainKey,
      kind: "launch",
      state: "acknowledged",
    }),
  );
  expect(await f.runtime.block({ arguments: { blockId: capture.uncertainBlockId } })).toMatchObject(
    { code: "BLOCK" },
  );
  expect(t3.threads.launchCalls).toBe(0);
});
