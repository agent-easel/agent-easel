import { assert, expect, it } from "@effect/vitest";
import type { FlowDraft, RunDefinitions } from "@t3-factory/contracts";
import { factoryHarness } from "./support/factory.ts";
import { loadMigrationData } from "./support/migration-data.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";

type Capture = {
  readonly flowId: string;
  readonly removedFlowId: string;
  readonly runId: string;
  readonly flow: Pick<FlowDraft, "name" | "revision" | "graph" | "workspace">;
  readonly captured: RunDefinitions["flow"];
};

it("upgrading the Flow revision block table keeps every saved and captured revision of every block kind unchanged and keeps the removed Flow removed", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  const capture = await loadMigrationData<Capture>(
    h.databasePath,
    "subflow-baseline-upgrade-data.json",
  );

  // Act
  const factory = await h.open({ t3: new ControlledT3() });

  // Assert
  const flow = await factory.getFlow(capture.flowId);
  assert(flow.ok);
  expect(flow.value).toMatchObject(capture.flow);
  expect(flow.value.graph).toStrictEqual(capture.flow.graph);
  expect(flow.value.readiness.issues.map((issue) => issue.code)).toStrictEqual(["flow_input_wait"]);
  const run = await factory.getRun(capture.runId);
  assert(run.ok);
  expect(run.value.definitions.flow).toStrictEqual(capture.captured);
  expect(await factory.getFlow(capture.removedFlowId)).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
});
