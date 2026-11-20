import { expect, it } from "@effect/vitest";
import {
  authoringMcpClient,
  clonesMcpClient,
  mcpFlowToDuplicate,
  toolReply,
} from "./support/factory-mcp.ts";
import { assertOk, sampleAgentInput } from "./support/domain-setup.ts";

/** A listed definition's name and owning Project. */
type Owned = { readonly name: string; readonly projectId: string | null };

it("a partial-position save arranges the whole graph after creating a ready Flow at revision 1 without positions", async (c) => {
  // Arrange
  const { client } = await authoringMcpClient(c);
  const capabilities = toolReply(
    await client.callTool({ name: "factory_get_agent_capabilities", arguments: {} }),
  );
  const [provider] = capabilities.providers;
  const agent = toolReply(
    await client.callTool({
      name: "factory_create_agent",
      arguments: {
        ...sampleAgentInput("Coder"),
        execution: {
          environmentId: capabilities.environments[0].environmentId,
          providerInstanceId: provider.providerInstanceId,
          modelId: provider.models[0].id,
          modelOptions: [],
        },
      },
    }),
  );
  const graph = {
    flowInput: { targetBlockIds: ["flow-input"] },
    blocks: [
      {
        id: "flow-input",
        kind: "agent",
        name: "Coder",
        agentId: agent.id,
        hiddenExitIds: [],
        localExits: [],
      },
    ],
    connections: [],
  };
  const workspace = { mode: "worktree", base: { kind: "ref", ref: "origin/develop" } };

  const created = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Change", graph, workspace },
  });

  expect(created.isError).toBe(false);
  const flow = toolReply(created);
  expect(flow).toMatchObject({ revision: 1, workspace, readiness: { ready: true, issues: [] } });
  expect(flow.graph).toMatchObject(graph);
  expect(flow.graph.flowInput.position.x).toBeGreaterThanOrEqual(-10000);
  expect(flow.graph.flowInput.position.x).toBeLessThanOrEqual(10000);
  expect(flow.graph.flowInput.position.y).toBeGreaterThanOrEqual(-10000);
  expect(flow.graph.flowInput.position.y).toBeLessThanOrEqual(10000);
  expect(flow.graph.blocks[0].position.x).toBeGreaterThanOrEqual(-10000);
  expect(flow.graph.blocks[0].position.x).toBeLessThanOrEqual(10000);
  expect(flow.graph.blocks[0].position.y).toBeGreaterThanOrEqual(-10000);
  expect(flow.graph.blocks[0].position.y).toBeLessThanOrEqual(10000);
  expect(
    toolReply(
      await client.callTool({ name: "factory_check_flow", arguments: { flowId: flow.id } }),
    ),
  ).toStrictEqual({ ready: true, issues: [] });
  expect(provider.reporting.supported).toBe(true);
  expect(agent.settingsStatus).toStrictEqual({
    environment: { state: "available" },
    provider: { state: "available" },
    model: { state: "available" },
    options: [],
  });
  // Act
  const result = await client.callTool({
    name: "factory_save_flow",
    arguments: {
      flowId: flow.id,
      name: flow.name,
      expectedRevision: flow.revision,
      expectedProjectId: flow.projectId,
      graph: { ...graph, flowInput: { ...graph.flowInput, position: { x: -10000, y: 10000 } } },
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  const saved = toolReply(result);
  expect(saved).toMatchObject({ revision: 2, workspace, readiness: { ready: true, issues: [] } });
  expect(saved.graph).toStrictEqual(flow.graph);
  expect(
    toolReply(await client.callTool({ name: "factory_get_flow", arguments: { flowId: flow.id } })),
  ).toStrictEqual(saved);
});

it("an Agent save on a revision Studio has replaced is refused with a conflict and a next step", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const opened = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const studio = assertOk(
    await factory.updateAgent(opened.id, {
      ...sampleAgentInput("Coder"),
      prompt: "Studio's edit",
      expectedRevision: opened.revision,
      expectedProjectId: opened.projectId,
      projectOverrides: [],
    }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_save_agent",
    arguments: {
      ...sampleAgentInput("Coder"),
      agentId: opened.id,
      prompt: "The agent's edit",
      expectedRevision: opened.revision,
      expectedProjectId: opened.projectId,
      projectOverrides: [],
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "conflict",
    message: expect.any(String),
    issues: [{ code: "stale_revision", path: "expectedRevision", message: expect.any(String) }],
    next: "Read the Agent with factory_get_agent, reapply your change and save with its revision.",
  });
  expect(assertOk(await factory.getAgent(opened.id))).toMatchObject({
    revision: studio.revision,
    prompt: "Studio's edit",
  });
});

it("an Agent save choosing a provider without Factory reporting support is refused and keeps the revision", async (c) => {
  // Arrange
  const { factory, t3, client } = await authoringMcpClient(c);
  t3.projects.controlledProviders.push({
    ...t3.projects.controlledProviders[0]!,
    providerInstanceId: "future-main",
    driverKind: "future",
  });
  const saved = assertOk(await factory.createAgent(sampleAgentInput("Coder")));

  // Act
  const result = await client.callTool({
    name: "factory_save_agent",
    arguments: {
      ...sampleAgentInput("Coder"),
      agentId: saved.id,
      expectedRevision: saved.revision,
      expectedProjectId: saved.projectId,
      projectOverrides: [],
      execution: { ...saved.execution, providerInstanceId: "future-main" },
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "validation",
    message: expect.any(String),
    issues: [
      {
        code: "harness_unsupported",
        path: "execution.providerInstanceId",
        message: expect.any(String),
      },
    ],
    next: "Fix the listed issue paths and call the tool again.",
  });
  expect(assertOk(await factory.getAgent(saved.id))).toMatchObject({
    revision: saved.revision,
    execution: saved.execution,
  });
});

it("factory_create_agent with execution null creates an Agent that factory_get_agent reads without execution or settings status", async (c) => {
  // Arrange
  const { client } = await authoringMcpClient(c);

  // Act
  const result = await client.callTool({
    name: "factory_create_agent",
    arguments: { ...sampleAgentInput("Coder"), execution: null },
  });

  // Assert
  expect(result.isError).toBe(false);
  const created = toolReply(result);
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_agent", arguments: { agentId: created.id } }),
    ),
  ).toMatchObject({ id: created.id, revision: 1, execution: null, settingsStatus: null });
});

it("factory_get_agent reports unknown settings and keeps the saved model while T3 capabilities are unavailable", async (c) => {
  // Arrange
  const { factory, t3, client } = await authoringMcpClient(c);
  const saved = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  t3.projects.capabilitiesAvailable = false;

  // Act
  const result = await client.callTool({
    name: "factory_get_agent",
    arguments: { agentId: saved.id },
  });

  // Assert
  expect(result.isError).toBe(false);
  const agent = toolReply(result);
  expect(agent.execution).toStrictEqual(saved.execution);
  expect(agent.settingsStatus).toMatchObject({
    environment: { state: "unknown" },
    provider: { state: "unknown" },
    model: { state: "unknown" },
  });
});

it("factory_save_agent with execution null saves the next revision without a model", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const saved = assertOk(await factory.createAgent(sampleAgentInput("Coder")));

  // Act
  const result = await client.callTool({
    name: "factory_save_agent",
    arguments: {
      ...sampleAgentInput("Coder"),
      agentId: saved.id,
      expectedRevision: saved.revision,
      expectedProjectId: saved.projectId,
      projectOverrides: [],
      execution: null,
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(assertOk(await factory.getAgent(saved.id))).toMatchObject({
    revision: saved.revision + 1,
    execution: null,
  });
});

it("factory_save_agent without the execution key is refused and keeps the model", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const saved = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const { execution: _execution, ...withoutExecution } = sampleAgentInput("Coder");

  // Act
  const result = await client.callTool({
    name: "factory_save_agent",
    arguments: {
      ...withoutExecution,
      agentId: saved.id,
      expectedRevision: saved.revision,
      expectedProjectId: saved.projectId,
      projectOverrides: [],
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "validation",
    issues: [{ code: "execution_required", path: "execution" }],
  });
  expect(assertOk(await factory.getAgent(saved.id))).toMatchObject({
    revision: saved.revision,
    execution: saved.execution,
  });
});

it.for([
  ["modelId", { code: "invalid_model", path: "execution.modelId" }],
  ["modelOptions", { code: "invalid_option", path: "execution.modelOptions" }],
] as const)(
  "factory_save_agent with an execution missing %s is refused and keeps the model and its options",
  async ([missing, issue], c) => {
    // Arrange
    const { factory, client } = await authoringMcpClient(c);
    const saved = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
    const { [missing]: _missing, ...partial } = sampleAgentInput("Coder").execution;

    // Act
    const result = await client.callTool({
      name: "factory_save_agent",
      arguments: {
        ...sampleAgentInput("Coder"),
        agentId: saved.id,
        expectedRevision: saved.revision,
        expectedProjectId: saved.projectId,
        projectOverrides: [],
        execution: partial,
      },
    });

    // Assert
    expect(result.isError).toBe(true);
    expect(toolReply(result)).toMatchObject({ code: "validation", issues: [issue] });
    expect(assertOk(await factory.getAgent(saved.id))).toMatchObject({
      revision: saved.revision,
      execution: saved.execution,
    });
  },
);

it("a stale Flow save whose graph is too large to arrange is refused as a conflict before any layout", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const opened = assertOk(await factory.createFlow({ name: "Long" }));
  const studio = assertOk(
    await factory.updateFlow(opened.id, {
      name: "Studio's edit",
      expectedRevision: opened.revision,
      expectedProjectId: opened.projectId,
      graph: opened.graph,
    }),
  );
  const ids = Array.from({ length: 80 }, (_, index) => `step-${index}`);

  // Act
  const result = await client.callTool({
    name: "factory_save_flow",
    arguments: {
      flowId: opened.id,
      name: "The agent's edit",
      expectedRevision: opened.revision,
      expectedProjectId: opened.projectId,
      graph: {
        flowInput: { targetBlockIds: [] },
        blocks: ids.map((id) => ({ id, kind: "human", name: id })),
        connections: ids.slice(1).map((id, index) => ({
          sourceBlockId: ids[index],
          exitId: "approve",
          targetBlockId: id,
        })),
      },
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "conflict",
    issues: [{ code: "stale_revision", path: "expectedRevision", message: expect.any(String) }],
    next: expect.any(String),
  });
  expect(assertOk(await factory.getFlow(opened.id))).toMatchObject({
    revision: studio.revision,
    name: "Studio's edit",
  });
});

it("an MCP-created Flow with an eight-day Wait saves with Studio's readiness gap and arranged positions", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const graph = {
    flowInput: { targetBlockIds: ["coder"] },
    blocks: [
      {
        id: "coder",
        kind: "agent",
        name: "Coder",
        agentId: agent.id,
        hiddenExitIds: [],
        localExits: [],
      },
      { id: "pause", kind: "wait", name: "Cool down", duration: { amount: 8, unit: "days" } },
    ],
    connections: [{ sourceBlockId: "coder", exitId: "done", targetBlockId: "pause" }],
  };

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Delayed review", graph },
  });

  // Assert
  expect(result.isError).toBe(false);
  const flow = toolReply(result);
  expect(flow.readiness.issues).toStrictEqual([
    {
      code: "wait_duration_range",
      path: "graph.blocks.1.duration",
      message: "Cool down must wait from 1 minute to 7 days.",
    },
  ]);
  expect(flow.graph.blocks[1]).toMatchObject({
    kind: "wait",
    duration: { amount: 8, unit: "days" },
    position: { x: expect.any(Number), y: expect.any(Number) },
  });
  expect(assertOk(await factory.getFlow(flow.id))).toStrictEqual(flow);
});

it("an MCP-created Flow whose Condition rules ascend saves with Studio's readiness gap at the rule row and arranged positions", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const graph = {
    flowInput: { targetBlockIds: ["coder"] },
    blocks: [
      {
        id: "coder",
        kind: "agent",
        name: "Coder",
        agentId: agent.id,
        hiddenExitIds: [],
        localExits: [],
      },
      {
        id: "gate",
        kind: "condition",
        name: "Escalate",
        rules: [
          { id: "ask", name: "Ask a person", fromArrival: 3 },
          { id: "end", name: "End branch", fromArrival: 5 },
        ],
        otherwise: { id: "otherwise" },
      },
    ],
    connections: [
      { sourceBlockId: "coder", exitId: "done", targetBlockId: "gate" },
      { sourceBlockId: "gate", exitId: "ask", targetBlockId: "coder" },
      { sourceBlockId: "gate", exitId: "end", targetBlockId: "coder" },
      { sourceBlockId: "gate", exitId: "otherwise", targetBlockId: "coder" },
    ],
  };

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: { name: "Escalating review", graph },
  });

  // Assert
  expect(result.isError).toBe(false);
  const flow = toolReply(result);
  expect(flow.readiness.issues).toStrictEqual([
    {
      code: "condition_rule_shadowed",
      path: "graph.blocks.1.rules.1.fromArrival",
      message:
        'Escalate: rule 2 "End branch" is never selected: an earlier rule already matches from arrival 3. Order rules from the highest arrival number down.',
    },
  ]);
  expect(flow.graph.blocks[1]).toMatchObject({
    kind: "condition",
    otherwise: { id: "otherwise" },
    position: { x: expect.any(Number), y: expect.any(Number) },
  });
  expect(assertOk(await factory.getFlow(flow.id))).toStrictEqual(flow);
});

function revisitGraph(agentId: string, revisitInstruction: string) {
  return {
    flowInput: { targetBlockIds: ["review"] },
    blocks: [
      {
        id: "review",
        kind: "agent" as const,
        name: "Review",
        agentId,
        hiddenExitIds: [],
        localExits: [],
        revisitInstruction,
      },
    ],
    connections: [],
  };
}

it("factory_create_flow stores an Agent block's trimmed Revisit instruction and factory_get_flow returns it without a readiness issue", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Reviewer")));

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: {
      name: "Review once",
      graph: revisitGraph(agent.id, "  Check every finding again.  "),
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  const created = toolReply(result);
  expect(created.graph.blocks[0].revisitInstruction).toBe("Check every finding again.");
  expect(created.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_flow", arguments: { flowId: created.id } }),
    ),
  ).toStrictEqual(created);
});

it("factory_save_flow replaces an Agent block's Revisit instruction and factory_get_flow returns it without a readiness issue", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Reviewer")));
  const created = assertOk(
    await factory.createFlow({
      name: "Review once",
      graph: revisitGraph(agent.id, "Check every finding again."),
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
      graph: revisitGraph(agent.id, "Verify the fixes and the newly affected scope."),
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  const saved = toolReply(result);
  expect(saved.graph.blocks[0].revisitInstruction).toBe(
    "Verify the fixes and the newly affected scope.",
  );
  expect(saved.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_flow", arguments: { flowId: created.id } }),
    ),
  ).toStrictEqual(saved);
  expect(
    toolReply(
      await client.callTool({ name: "factory_check_flow", arguments: { flowId: created.id } }),
    ),
  ).toStrictEqual({ ready: true, issues: [] });
});

it("factory_check_flow reports a block whose Agent Needs a model as not ready", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(
    await factory.createAgent({ ...sampleAgentInput("Reviewer"), execution: null }),
  );
  const flow = assertOk(
    await factory.createFlow({ name: "Review", graph: revisitGraph(agent.id, "") }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_check_flow",
    arguments: { flowId: flow.id },
  });

  // Assert
  expect(toolReply(result)).toStrictEqual({
    ready: false,
    issues: [
      {
        code: "agent_model_required",
        path: "graph.blocks.0.agentId",
        message: "Review: Reviewer needs a model.",
      },
    ],
  });
});

it("removing an unused Agent replies with its id and the Agent then reads as not found", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));

  // Act
  const result = await client.callTool({
    name: "factory_remove_agent",
    arguments: { agentId: agent.id },
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toStrictEqual({ agentId: agent.id, removed: true });
  expect(
    toolReply(
      await client.callTool({ name: "factory_get_agent", arguments: { agentId: agent.id } }),
    ),
  ).toMatchObject({ code: "not_found" });
});

it("removing an Agent two current Flows place is refused with one issue per Flow and keeps the Agent", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const placing = (name: string) =>
    factory.createFlow({
      name,
      graph: {
        flowInput: { targetBlockIds: ["coder"] },
        blocks: [
          {
            id: "coder",
            kind: "agent",
            name: "Coder",
            agentId: agent.id,
            hiddenExitIds: [],
            localExits: [],
          },
        ],
        connections: [],
      },
    });
  const review = assertOk(await placing("Review"));
  const change = assertOk(await placing("Change"));

  // Act
  const result = await client.callTool({
    name: "factory_remove_agent",
    arguments: { agentId: agent.id },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "conflict",
    message: expect.any(String),
    issues: [
      {
        code: "agent_in_use",
        path: "agentId",
        message: `Flow "Change" (${change.id}) places this Agent.`,
      },
      {
        code: "agent_in_use",
        path: "agentId",
        message: `Flow "Review" (${review.id}) places this Agent.`,
      },
    ],
    next: "Nothing was removed. Ask the user before editing or removing the Flows that place this Agent, unless they already authorized those exact changes; never rewrite Flows on your own.",
  });
  expect(assertOk(await factory.getAgent(agent.id))).toMatchObject({ revision: agent.revision });
});

it("removing a Flow replies with its id and the Flow then reads as not found", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const flow = assertOk(await factory.createFlow({ name: "Change" }));

  // Act
  const result = await client.callTool({
    name: "factory_remove_flow",
    arguments: { flowId: flow.id },
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toStrictEqual({ flowId: flow.id, removed: true });
  expect(
    toolReply(await client.callTool({ name: "factory_get_flow", arguments: { flowId: flow.id } })),
  ).toMatchObject({ code: "not_found" });
});

it("removing a Flow that Studio already removed succeeds again", async (c) => {
  // Arrange
  const { factory, client } = await authoringMcpClient(c);
  const flow = assertOk(await factory.createFlow({ name: "Change" }));
  assertOk(await factory.removeFlow(flow.id));

  // Act
  const result = await client.callTool({
    name: "factory_remove_flow",
    arguments: { flowId: flow.id },
  });

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toStrictEqual({ flowId: flow.id, removed: true });
});

it("a removal without an id is a validation error at the id path", async (c) => {
  // Arrange
  const { client } = await authoringMcpClient(c);

  // Act
  const result = await client.callTool({ name: "factory_remove_agent", arguments: {} });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "validation",
    message: expect.any(String),
    issues: [{ code: "invalid_id", path: "agentId", message: expect.any(String) }],
    next: "Fix the listed issue paths and call the tool again.",
  });
});

it("Agents and Flows created for a Project list with the global ones for that Project, never for the other clone, and each names its owning Project", async (c) => {
  // Arrange
  const { client, first, second } = await clonesMcpClient(c);
  const create = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  await create("factory_create_agent", { ...sampleAgentInput("Coder"), projectId: null });
  await create("factory_create_agent", sampleAgentInput("Releaser", first.id));
  await create("factory_create_agent", sampleAgentInput("Porter", second.id));
  await create("factory_create_flow", { name: "Review", projectId: null });
  await create("factory_create_flow", { name: "Release", projectId: first.id });
  await create("factory_create_flow", { name: "Port", projectId: second.id });
  const listed = async (name: string, args: Record<string, unknown>) =>
    (toolReply(await client.callTool({ name, arguments: args })) as Owned[])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((definition) => [definition.name, definition.projectId]);

  // Act
  const forFirst = {
    agents: await listed("factory_list_agents", { projectId: first.id }),
    flows: await listed("factory_list_flows", { projectId: first.id }),
  };
  const all = {
    agents: await listed("factory_list_agents", {}),
    flows: await listed("factory_list_flows", {}),
  };

  // Assert
  expect(forFirst).toStrictEqual({
    agents: [
      ["Coder", null],
      ["Releaser", first.id],
    ],
    flows: [
      ["Release", first.id],
      ["Review", null],
    ],
  });
  expect(all).toStrictEqual({
    agents: [
      ["Coder", null],
      ["Porter", second.id],
      ["Releaser", first.id],
    ],
    flows: [
      ["Port", second.id],
      ["Release", first.id],
      ["Review", null],
    ],
  });
});

it("a Flow created for one clone that places the other clone's Agent is refused with the placement issue and a next step to choose a placeable Agent", async (c) => {
  // Arrange
  const { factory, client, first, second } = await clonesMcpClient(c);
  const other = assertOk(await factory.createAgent(sampleAgentInput("Porter", second.id)));

  // Act
  const result = await client.callTool({
    name: "factory_create_flow",
    arguments: {
      name: "Release",
      projectId: first.id,
      graph: {
        flowInput: { targetBlockIds: ["port"] },
        blocks: [
          {
            id: "port",
            kind: "agent",
            name: "Port",
            agentId: other.id,
            hiddenExitIds: [],
            localExits: [],
          },
        ],
        connections: [],
      },
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "validation",
    message: expect.any(String),
    issues: [
      { code: "agent_scope_mismatch", path: "graph.blocks.0.agentId", message: expect.any(String) },
    ],
    next: "A Flow places only global Agents and Agents of its own owning Project. Choose Agents from factory_list_agents with the Flow's projectId, then call the tool again.",
  });
  expect(assertOk(await factory.listFlows())).toStrictEqual([]);
});

it("changing owners moves an Agent into a Project without a revision, and a Flow change from an owner it no longer has is refused with a next step to reread it", async (c) => {
  // Arrange
  const { factory, client, first, second } = await clonesMcpClient(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const flow = assertOk(await factory.createFlow({ name: "Release" }));
  assertOk(
    await factory.changeFlowOwner(flow.id, { expectedProjectId: null, projectId: first.id }),
  );

  // Act
  const moved = await client.callTool({
    name: "factory_change_agent_owner",
    arguments: { agentId: agent.id, expectedProjectId: null, projectId: first.id },
  });
  const stale = await client.callTool({
    name: "factory_change_flow_owner",
    arguments: { flowId: flow.id, expectedProjectId: null, projectId: second.id },
  });

  // Assert
  expect(moved.isError).toBe(false);
  expect(toolReply(moved)).toMatchObject({ id: agent.id, projectId: first.id, revision: 1 });
  expect(stale.isError).toBe(true);
  expect(toolReply(stale)).toStrictEqual({
    code: "conflict",
    message: expect.any(String),
    issues: [{ code: "stale_owner", path: "expectedProjectId", message: expect.any(String) }],
    next: "Nothing changed. Read the definition again with factory_get_flow or factory_get_agent, confirm its current projectId with the user and call the tool again with it as expectedProjectId.",
  });
  expect(assertOk(await factory.getFlow(flow.id)).projectId).toBe(first.id);
});

it("a Flow owner change its placed Project Agent blocks names that Agent and points to Duplicate instead", async (c) => {
  // Arrange
  const { factory, client, first, second } = await clonesMcpClient(c);
  const releaser = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const flow = assertOk(
    await factory.createFlow({
      name: "Release",
      projectId: first.id,
      graph: {
        flowInput: { targetBlockIds: ["release"] },
        blocks: [
          {
            id: "release",
            kind: "agent",
            name: "Release",
            agentId: releaser.id,
            hiddenExitIds: [],
            localExits: [],
          },
        ],
        connections: [],
      },
    }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_change_flow_owner",
    arguments: { flowId: flow.id, expectedProjectId: first.id, projectId: second.id },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "conflict",
    message: expect.any(String),
    issues: [
      {
        code: "owner_change_blocked",
        path: "projectId",
        message: `This Flow places Agent "Releaser" (${releaser.id}), which the new owner may not place.`,
      },
    ],
    next: "Nothing changed. Ask the user whether to change the definitions the issues name, or to copy into the target with factory_preview_flow_duplicate and factory_duplicate_flow or factory_duplicate_agent instead; never rewrite definitions on your own.",
  });
  expect(assertOk(await factory.getFlow(flow.id)).projectId).toBe(first.id);
});

it("a previewed Flow Duplicate into the other clone commits a new Flow there with a copy of each Agent the plan copies", async (c) => {
  // Arrange
  const { factory, client, releaser, flow, second } = await mcpFlowToDuplicate(c);
  const preview = await client.callTool({
    name: "factory_preview_flow_duplicate",
    arguments: { flowId: flow.id, projectId: second.id },
  });
  expect(preview.isError).toBe(false);
  const plan = toolReply(preview);

  // Act
  const result = await client.callTool({
    name: "factory_duplicate_flow",
    arguments: {
      flowId: flow.id,
      projectId: plan.projectId,
      expectedRevision: plan.revision,
      agents: plan.agents,
    },
  });

  // Assert
  expect(result.isError).toBe(false);
  const duplicate = toolReply(result);
  expect(duplicate.flow).toMatchObject({ name: "Release copy", projectId: second.id, revision: 1 });
  expect(duplicate.copies).toStrictEqual([
    { sourceAgentId: releaser.id, agentId: expect.any(String) },
  ]);
  expect(assertOk(await factory.listFlows())).toHaveLength(2);
});

it("a Flow Duplicate commit of a plan that predates a placed Agent's save is refused with a next step to preview again", async (c) => {
  // Arrange
  const { factory, client, coder, flow, second } = await mcpFlowToDuplicate(c);
  const preview = await client.callTool({
    name: "factory_preview_flow_duplicate",
    arguments: { flowId: flow.id, projectId: second.id },
  });
  expect(preview.isError).toBe(false);
  const plan = toolReply(preview);
  assertOk(
    await factory.updateAgent(coder.id, {
      ...sampleAgentInput("Coder v2"),
      expectedRevision: coder.revision,
      expectedProjectId: coder.projectId,
      projectOverrides: [],
    }),
  );

  // Act
  const result = await client.callTool({
    name: "factory_duplicate_flow",
    arguments: {
      flowId: flow.id,
      projectId: plan.projectId,
      expectedRevision: plan.revision,
      agents: plan.agents,
    },
  });

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toStrictEqual({
    code: "conflict",
    message: expect.any(String),
    issues: [{ code: "stale_duplicate_plan", path: "agents", message: expect.any(String) }],
    next: "Nothing was created. Preview the Duplicate again with factory_preview_flow_duplicate, review the new plan with the user and commit it.",
  });
  expect(assertOk(await factory.listFlows())).toHaveLength(1);
});

it("an Agent duplicated into the other clone is a new Agent there at revision 1 with its settings status", async (c) => {
  // Arrange
  const { client, releaser, second } = await mcpFlowToDuplicate(c);

  // Act
  const result = await client.callTool({
    name: "factory_duplicate_agent",
    arguments: { agentId: releaser.id, projectId: second.id },
  });

  // Assert
  expect(result.isError).toBe(false);
  const copy = toolReply(result);
  expect(copy).toMatchObject({
    name: "Releaser copy",
    projectId: second.id,
    revision: 1,
    prompt: releaser.prompt,
    settingsStatus: expect.any(Object),
  });
  expect(copy.id).not.toBe(releaser.id);
});
