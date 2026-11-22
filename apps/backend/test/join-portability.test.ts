import { assert, expect, it } from "@effect/vitest";
import { fileBody, flowFile } from "./support/definition-import.ts";
import { assertOk, openFactoryWithApprovedT3, sampleAgentInput } from "./support/domain-setup.ts";
import {
  agentBlock,
  connection,
  controlledExecution,
  flowInput,
  humanStep,
  joinBlock,
  JOIN_OUTPUT,
} from "./support/scenarios.ts";

it("a Flow with a Join exports at format version 7 and imports as a copy with its Join, sources and output wire", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const created = assertOk(await factory.createFlow({ name: "Parallel review" }));
  const saved = assertOk(
    await factory.updateFlow(created.id, {
      name: created.name,
      expectedRevision: created.revision,
      expectedProjectId: created.projectId,
      workspace: created.workspace,
      graph: {
        flowInput: flowInput(["coder"], { x: 0, y: 0 }),
        blocks: [
          agentBlock("coder", "Coder", coder.id, { x: 200, y: 0 }),
          humanStep("review", "Review", { x: 400, y: 0 }),
          joinBlock("merge", "Merge reviews", { x: 600, y: 0 }),
        ],
        connections: [
          connection("coder", "done", "review"),
          connection("coder", "done", "merge"),
          connection("review", "approve", "merge"),
          connection("review", "request-changes", "merge"),
          connection("merge", JOIN_OUTPUT, "coder"),
        ],
      },
    }),
  );
  const { document } = assertOk(await factory.exportFlow(created.id));
  expect(document.formatVersion).toBe(7);

  // Act
  const committed = await factory.commitImport({
    requestId: "import-join",
    document,
    selections: { "agent-1": controlledExecution() },
  });

  // Assert
  assert(committed.ok);
  const copy = assertOk(await factory.getFlow(committed.value.flowId!));
  expect(copy.graph.blocks[2]).toStrictEqual(saved.graph.blocks[2]);
  expect(copy.graph.connections).toStrictEqual(saved.graph.connections);
  expect(copy.readiness).toStrictEqual({ ready: true, issues: [] });
});

it("a version-6 Flow file holding a Join block is rejected at the block, as version 6 has no such kind", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const { flow, ...file } = flowFile({ formatVersion: 6 });
  const graph = { ...flow.graph, blocks: [...flow.graph.blocks, joinBlock("merge", "Merge")] };

  // Act
  const review = await factory.reviewImport(
    fileBody({ ...file, rootFlowKey: "root", flows: [{ ...flow, key: "root", graph }] }),
  );

  // Assert
  assert(!review.ok);
  expect(review.error.issues).toStrictEqual([
    {
      code: "invalid_block_kind",
      path: "flows.0.graph.blocks.2.kind",
      message:
        'Block "Merge": use an Agent, Human, Wait, Continuation, Condition or Subflow block.',
    },
  ]);
});
