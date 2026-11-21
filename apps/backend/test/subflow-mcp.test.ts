import { assert, expect, it } from "@effect/vitest";
import { authoringMcpClient, clonesMcpClient, toolReply } from "./support/factory-mcp.ts";
import { assertOk, sampleAgentInput } from "./support/domain-setup.ts";
import { placingGraph, releaseGraph, reviewPanelGraph } from "./support/subflow.ts";

it("an MCP-saved Subflow reads back with the same nested readiness Studio shows", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const child = assertOk(
    await factory.createFlow({ name: "Review panel", graph: reviewPanelGraph("missing-agent") }),
  );

  // Act
  const created = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Release", graph: releaseGraph(coder.id, child.id) },
  });

  // Assert
  expect(created.isError).toBe(false);
  const flow = toolReply(created);
  expect(flow.graph.blocks[1]).toStrictEqual({
    id: "review",
    name: "Review",
    kind: "subflow",
    flowId: child.id,
    position: { x: 300, y: 0 },
  });
  expect(flow.readiness).toStrictEqual(assertOk(await factory.getFlow(flow.id)).readiness);
  expect(flow.readiness.issues.map((issue: { code: string }) => issue.code)).toStrictEqual([
    "agent_required",
    "exit_required",
    "agent_required",
    "exit_required",
  ]);
});

it("factory_check_flow pages the findings it omitted from its cursor", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const wide = assertOk(
    await factory.createFlow({ name: "Wide", graph: placingGraph(...Array<null>(22).fill(null)) }),
  );
  const checked = toolReply(
    await client.callTool({ name: "factory_check_flow", arguments: { flowId: wide.id } }),
  );
  assert(typeof checked.cursor === "string");

  // Act
  const page = await client.callTool({
    name: "factory_check_flow",
    arguments: { flowId: wide.id, cursor: checked.cursor },
  });

  // Assert
  expect(checked.omitted).toStrictEqual([{ code: "subflow_flow_required", count: 2 }]);
  expect(toolReply(page)).toStrictEqual(
    assertOk(await factory.listFlowFindings(wide.id, { cursor: checked.cursor })),
  );
  expect(toolReply(page).issues.map((issue: { path: string }) => issue.path)).toStrictEqual([
    "graph.blocks.20.flowId",
    "graph.blocks.21.flowId",
  ]);
});

it("a Flow created over MCP for one clone that places the other clone's Flow is refused with the placement issue and a next step to choose a placeable Flow", async (c) => {
  // Arrange
  const { factory, client, first, second } = await clonesMcpClient(c);
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const other = assertOk(
    await factory.createFlow({
      name: "Other review",
      projectId: second.id,
      graph: reviewPanelGraph(coder.id),
    }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Release", projectId: first.id, graph: releaseGraph(coder.id, other.id) },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "validation",
    message: expect.any(String),
    issues: [
      { code: "flow_scope_mismatch", path: "graph.blocks.1.flowId", message: expect.any(String) },
    ],
    next: "A Flow places only global Flows and Flows of its own owning Project. Choose Flows from factory_list_flows with the Flow's projectId, then call the tool again.",
  });
});
