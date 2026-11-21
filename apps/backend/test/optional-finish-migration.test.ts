import { assert, expect, it } from "@effect/vitest";
import type { TestContext } from "vitest";
import { factoryHarness } from "./support/factory.ts";
import { loadMigrationData, restoreCapturedAdapter } from "./support/migration-data.ts";

interface Capture {
  readonly endingFlowId: string;
  readonly plainFlowId: string;
  readonly endingRunId: string;
  readonly plainRunId: string;
  readonly t3: Record<string, unknown>;
}

async function capturedRelease(c: TestContext) {
  const h = await factoryHarness(c);
  const capture = await loadMigrationData<Capture>(
    h.databasePath,
    "optional-finish-upgrade-data.json",
  );
  const t3 = await restoreCapturedAdapter(capture.t3, h.processHome);
  return { h, t3, capture };
}

const delivered = {
  id: "delivered",
  name: "Delivered",
  description: "",
  output: "optional",
  outputDescription: "URL of the PR opened",
};

it("upgrading v0.9.0 removes the empty Finish block from a Flow saved without endings and from the definitions its settled Run captured", async (c) => {
  // Arrange
  const { h, t3, capture } = await capturedRelease(c);

  // Act
  const factory = await h.open({ t3 });

  // Assert
  const flow = await factory.getFlow(capture.plainFlowId);
  assert(flow.ok);
  expect(flow.value.graph).not.toHaveProperty("finish");
  expect(flow.value.graph).toMatchObject({
    blocks: [{ id: "worker", kind: "agent" }],
    connections: [],
    flowInput: { targetBlockIds: ["worker"] },
  });
  expect(flow.value.readiness.ready).toBe(true);
  const run = await factory.getRun(capture.plainRunId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.result).toBeNull();
  expect(run.value.definitions.flow.graph).not.toHaveProperty("finish");
});

it("upgrading v0.9.0 keeps a configured Finish block, its ending wire and the result its Run reached", async (c) => {
  // Arrange
  const { h, t3, capture } = await capturedRelease(c);

  // Act
  const factory = await h.open({ t3 });

  // Assert
  const flow = await factory.getFlow(capture.endingFlowId);
  assert(flow.ok);
  expect(flow.value.graph.finish).toStrictEqual({
    position: { x: 1200, y: 0 },
    endings: [delivered],
  });
  expect(flow.value.graph.connections).toStrictEqual([
    {
      sourceBlockId: "worker",
      exitId: "done",
      targetBlockId: "finish",
      targetEndingId: "delivered",
    },
  ]);
  const run = await factory.getRun(capture.endingRunId);
  assert(run.ok);
  expect(run.value.result).toMatchObject({
    endingId: "delivered",
    endingName: "Delivered",
    output: "https://example.test/pull/7",
  });
  expect(run.value.definitions.flow.graph.finish?.endings).toStrictEqual([delivered]);
  expect(run.value.definitions.flow.graph.connections).toStrictEqual(flow.value.graph.connections);
});
