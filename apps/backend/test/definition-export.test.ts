import { assert, expect, it } from "@effect/vitest";
import {
  assertOk,
  discoveredClones,
  openFactoryWithApprovedT3,
  sampleAgentInput,
} from "./support/domain-setup.ts";
import { savedFlow, subflowBlock } from "./support/subflow.ts";
import { agentBlock, connection, flowInput } from "./support/scenarios.ts";

it("an exported Agent holds its latest saved revision and a model hint without environment, ids, revisions or timestamps", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent(sampleAgentInput("Coder"));
  assert(created.ok);
  const saved = await factory.updateAgent(created.value.id, {
    ...sampleAgentInput("Reviewer"),
    expectedRevision: created.value.revision,
    expectedProjectId: created.value.projectId,
    projectOverrides: [],
  });
  assert(saved.ok);

  // Act
  const exported = await factory.exportAgent(created.value.id);

  // Assert
  expect(exported).toStrictEqual({
    ok: true,
    value: {
      document: {
        format: "t3-factory/definitions",
        formatVersion: 5,
        kind: "agent",
        factoryVersion: "source",
        exportedAt: expect.any(String),
        agents: [
          {
            key: "agent-1",
            name: "Reviewer",
            prompt: saved.value.prompt,
            model: {
              driverKind: "codex",
              providerInstanceId: "codex-main",
              modelId: "gpt-6.1-sol",
              modelOptions: [{ id: "reasoning", value: "high" }],
            },
            exits: saved.value.exits,
          },
        ],
      },
      driverKindOmitted: [],
    },
  });
});

it("an Agent without a model exports with no model hint", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent({ ...sampleAgentInput(), execution: null });
  assert(created.ok);

  // Act
  const exported = await factory.exportAgent(created.value.id);

  // Assert
  assert(exported.ok);
  expect(exported.value.document.agents[0].model).toBeNull();
  expect(exported.value.driverKindOmitted).toStrictEqual([]);
});

it("an export without T3 capabilities keeps the model hint, omits only its driver kind and names the Agent", async (context) => {
  // Arrange
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent(sampleAgentInput("Coder"));
  assert(created.ok);
  t3.projects.capabilitiesAvailable = false;

  // Act
  const exported = await factory.exportAgent(created.value.id);

  // Assert
  assert(exported.ok);
  expect(exported.value.document.agents[0].model).toStrictEqual({
    providerInstanceId: "codex-main",
    modelId: "gpt-6.1-sol",
    modelOptions: [{ id: "reasoning", value: "high" }],
  });
  expect(exported.value.driverKindOmitted).toStrictEqual([{ key: "agent-1", name: "Coder" }]);
});

it("an exported Flow bundles a shared Agent once and gives a block without a saved Agent an explicit null key", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const created = assertOk(await factory.createFlow({ name: "Two passes" }));
  const first = agentBlock("first", "First pass", coder.id);
  const second = agentBlock("second", "Second pass", coder.id, { x: 240, y: 0 });
  const missing = agentBlock("missing", "Missing", "removed-agent", { x: 480, y: 0 });
  const graph = {
    flowInput: flowInput("first"),
    blocks: [first, second, missing],
    connections: [connection("first", "done", "second")],
  };
  const saved = assertOk(
    await factory.updateFlow(created.id, {
      name: created.name,
      expectedRevision: created.revision,
      expectedProjectId: created.projectId,
      workspace: created.workspace,
      graph,
    }),
  );
  const portable = ({ agentId: _agentId, ...block }: typeof first, agentKey: string | null) => ({
    ...block,
    agentKey,
  });

  // Act
  const exported = await factory.exportFlow(created.id);

  // Assert
  expect(exported).toStrictEqual({
    ok: true,
    value: {
      document: {
        format: "t3-factory/definitions",
        formatVersion: 5,
        kind: "flow",
        factoryVersion: "source",
        exportedAt: expect.any(String),
        rootFlowKey: "flow-1",
        flows: [
          {
            key: "flow-1",
            name: "Two passes",
            graph: {
              ...graph,
              finish: saved.graph.finish,
              blocks: [
                portable(first, "agent-1"),
                portable(second, "agent-1"),
                portable(missing, null),
              ],
            },
            workspace: created.workspace,
          },
        ],
        agents: [
          {
            key: "agent-1",
            name: "Coder",
            prompt: coder.prompt,
            model: {
              driverKind: "codex",
              providerInstanceId: "codex-main",
              modelId: "gpt-6.1-sol",
              modelOptions: [{ id: "reasoning", value: "high" }],
            },
            exits: coder.exits,
          },
        ],
      },
      driverKindOmitted: [],
    },
  });
});

it("a Flow of an unavailable Project exports with its Agent and no Project", async (context) => {
  // Arrange
  const { factory, t3, first } = await discoveredClones(context);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const flow = assertOk(
    await factory.createFlow({
      name: "Release",
      projectId: first.id,
      graph: {
        flowInput: flowInput("release"),
        blocks: [agentBlock("release", "Release", agent.id)],
        connections: [],
      },
    }),
  );
  t3.projects.catalog = [];
  assertOk(await factory.recheckProjects());

  // Act
  const exported = await factory.exportFlow(flow.id);

  // Assert
  assert(exported.ok);
  expect(exported.value.document.flows[0]?.name).toBe("Release");
  expect(exported.value.document.agents.map((entry) => entry.name)).toStrictEqual(["Releaser"]);
  expect(JSON.stringify(exported.value)).not.toContain(first.id);
});

it("export follows first-placement depth-first order and bundles a shared child once", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const leaf = await savedFlow(factory, { name: "Checks" });
  const left = await savedFlow(factory, {
    name: "Review",
    graph: {
      blocks: [subflowBlock("checks", "Left checks", leaf.id)],
      connections: [],
      flowInput: flowInput(),
    },
  });
  const right = await savedFlow(factory, {
    name: "Hotfix",
    graph: {
      blocks: [subflowBlock("checks", "Right checks", leaf.id)],
      connections: [],
      flowInput: flowInput(),
    },
  });
  const root = await savedFlow(factory, {
    name: "Release",
    graph: {
      blocks: [
        subflowBlock("review", "Review", left.id),
        subflowBlock("hotfix", "Hotfix", right.id),
      ],
      connections: [],
      flowInput: flowInput("review"),
    },
  });

  // Act
  const exported = assertOk(await factory.exportFlow(root.id));

  // Assert
  expect(exported.document).toMatchObject({
    formatVersion: 5,
    rootFlowKey: "flow-1",
    flows: [
      {
        key: "flow-1",
        name: "Release",
        graph: { blocks: [{ flowKey: "flow-2" }, { flowKey: "flow-4" }] },
      },
      { key: "flow-2", name: "Review", graph: { blocks: [{ flowKey: "flow-3" }] } },
      { key: "flow-3", name: "Checks" },
      { key: "flow-4", name: "Hotfix", graph: { blocks: [{ flowKey: "flow-3" }] } },
    ],
    agents: [],
  });
});
