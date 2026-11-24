import { assert, expect, it } from "@effect/vitest";
import type { FlowEnding } from "@agent-easel/contracts";
import { authoringMcpClient, toolReply } from "./support/factory-mcp.ts";
import { assertOk, sampleAgentInput } from "./support/domain-setup.ts";
import { prepared } from "./support/prepared-runner.ts";
import { agentBlock, connection, flowInput } from "./support/scenarios.ts";

const delivered = {
  id: "delivered",
  name: "Delivered",
  description: "The change is merged.",
  output: "required",
  outputDescription: "URL of the PR opened",
} as const;
const gaveUp = {
  id: "gave-up",
  name: "Could not complete",
  description: "",
  output: "none",
  outputDescription: "",
} as const;

function finishGraph(agentId: string, endings: readonly object[], connections: readonly object[]) {
  return {
    flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["coder"] },
    blocks: [
      {
        id: "coder",
        kind: "agent",
        name: "Coder",
        agentId,
        hiddenExitIds: [],
        localExits: [],
        revisitInstruction: "",
        revisitContext: "keep",
        position: { x: 300, y: 0 },
      },
      { id: "review", kind: "human", name: "Review", position: { x: 600, y: 0 } },
    ],
    connections: [
      { sourceBlockId: "coder", exitId: "done", targetBlockId: "review" },
      ...connections,
    ],
    finish: { position: { x: 900, y: 0 }, endings },
  };
}

it("factory_create_flow stores the Finish block's endings and ending-targeted wires, and factory_get_flow returns them unchanged and ready", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const graph = finishGraph(
    agent.id,
    [delivered, gaveUp],
    [
      {
        sourceBlockId: "review",
        exitId: "approve",
        targetBlockId: "finish",
        targetEndingId: "delivered",
      },
      {
        sourceBlockId: "coder",
        exitId: "done",
        targetBlockId: "finish",
        targetEndingId: "gave-up",
      },
      {
        sourceBlockId: "review",
        exitId: "request-changes",
        targetBlockId: "finish",
        targetEndingId: "gave-up",
      },
    ],
  );

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Deliver", graph },
  });

  // Assert
  expect(result.isError).toBe(false);
  const created = toolReply(result);
  expect(created.graph).toStrictEqual(graph);
  expect(created.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_flow", arguments: { flowId: created.id } }),
    ),
  ).toStrictEqual(created);
});

it("factory_save_flow renaming an ending keeps its ID and wires, and factory_get_flow returns the saved revision", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const wire = {
    sourceBlockId: "review",
    exitId: "approve",
    targetBlockId: "finish",
    targetEndingId: "delivered",
  };
  const created = toolReply(
    await client.callTool({
      name: "factory_create_flow",
      arguments: { name: "Deliver", graph: finishGraph(agent.id, [delivered], [wire]) },
    }),
  );
  const renamed = finishGraph(agent.id, [{ ...delivered, name: "  Merged  " }], [wire]);

  // Act
  const result = await client.callTool({
    name: "factory_save_flow",
    arguments: {
      flowId: created.id,
      name: created.name,
      expectedRevision: created.revision,
      expectedProjectId: created.projectId,
      graph: renamed,
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  const saved = toolReply(result);
  expect(saved.revision).toBe(2);
  expect(saved.graph.finish.endings).toStrictEqual([{ ...delivered, name: "Merged" }]);
  expect(saved.graph.connections).toStrictEqual(renamed.connections);
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_flow", arguments: { flowId: created.id } }),
    ),
  ).toStrictEqual(saved);
});

it("blank, duplicate and unwired endings save as a draft whose readiness names each ending row, arranged with Finish rightmost", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const positioned = finishGraph(
    agent.id,
    [
      { ...delivered, name: " " },
      { ...gaveUp, id: "first", name: "Done" },
      { ...gaveUp, id: "second", name: "Done" },
    ],
    [
      {
        sourceBlockId: "review",
        exitId: "approve",
        targetBlockId: "finish",
        targetEndingId: "delivered",
      },
      {
        sourceBlockId: "review",
        exitId: "request-changes",
        targetBlockId: "finish",
        targetEndingId: "first",
      },
    ],
  );
  const { position: _position, ...finish } = positioned.finish;
  const graph = { ...positioned, finish };

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Deliver", graph },
  });

  // Assert
  expect(result.isError).toBe(false);
  const created = toolReply(result);
  expect(created.graph.connections).toStrictEqual(graph.connections);
  const rightmostBlock = Math.max(
    ...created.graph.blocks.map((block: { position: { x: number } }) => block.position.x),
  );
  expect(created.graph.finish.position.x).toBeGreaterThan(rightmostBlock);
  expect(created.graph.finish.endings.map((ending: { name: string }) => ending.name)).toStrictEqual(
    ["", "Done", "Done"],
  );
  expect(created.readiness.issues).toStrictEqual([
    {
      code: "ending_name_required",
      path: "graph.finish.endings.0.name",
      message: "Finish: ending 1 needs a name.",
    },
    {
      code: "ending_name_duplicate",
      path: "graph.finish.endings.2.name",
      message: 'Finish: ending 3 "Done" has the same name as another ending. Rename it.',
    },
    {
      code: "ending_unconnected",
      path: "graph.finish.endings.2",
      message: 'Finish: ending 3 "Done": connect an exit or output to this ending.',
    },
  ]);
});

it("a Flow saved without finish has no Finish block, so the author removes one by omitting it", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const { finish: _finish, ...plain } = finishGraph(agent.id, [], []);
  const created = toolReply(
    await client.callTool({
      name: "factory_create_flow",
      arguments: { name: "Deliver", graph: finishGraph(agent.id, [delivered], []) },
    }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_save_flow",
    arguments: {
      flowId: created.id,
      name: created.name,
      expectedRevision: created.revision,
      expectedProjectId: created.projectId,
      graph: plain,
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result).graph).toStrictEqual(plain);
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_flow", arguments: { flowId: created.id } }),
    ).graph,
  ).toStrictEqual(plain);
});

it("a Flow without endings is ready, and a Flow input wire to Finish is refused without saving", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const graph = finishGraph(agent.id, [delivered], []);
  const ready = toolReply(
    await client.callTool({
      name: "factory_create_flow",
      arguments: { name: "No endings", graph: finishGraph(agent.id, [], []) },
    }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: {
      name: "Ends at once",
      graph: { ...graph, flowInput: { ...graph.flowInput, targetBlockIds: ["coder", "finish"] } },
    },
  });

  // Assert
  expect(ready.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(result.isError).toBe(true);
  expect(toolReply(result).issues).toStrictEqual([
    {
      code: "flow_input_finish",
      path: "graph.flowInput.targetBlockIds.1",
      message: "The Flow input cannot connect to Finish: a Run cannot end before any work happens.",
    },
  ]);
  expect(assertOk(await factory.listFlows()).map((flow) => flow.name)).toStrictEqual([
    "No endings",
  ]);
});

it("a Flow save after Start leaves the Run on the endings it captured", async (c) => {
  // Arrange
  const { f, flow, agent, input } = await prepared(c);
  const graph = (ending: FlowEnding) => ({
    flowInput: flowInput("worker"),
    blocks: [agentBlock("worker", "Entry worker", agent.id)],
    connections: [{ ...connection("worker", "done", "finish"), targetEndingId: ending.id }],
    finish: { endings: [ending] },
  });
  const first = await f.updateFlow(flow.id, {
    name: flow.name,
    expectedRevision: flow.revision,
    expectedProjectId: flow.projectId,
    workspace: flow.workspace,
    graph: graph(delivered),
  });
  assert(first.ok);
  const started = await f.startRun(input);
  assert(started.ok);

  // Act
  const saved = await f.updateFlow(flow.id, {
    name: flow.name,
    expectedRevision: first.value.revision,
    expectedProjectId: first.value.projectId,
    workspace: flow.workspace,
    graph: graph({ ...gaveUp, id: "other" }),
  });

  // Assert
  assert(saved.ok);
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.definitions.flow.graph.finish?.endings).toStrictEqual([delivered]);
  expect(run.value.definitions.flow.graph.connections).toStrictEqual(first.value.graph.connections);
});
