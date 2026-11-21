import { expect, it } from "@effect/vitest";
import { ControlledT3 } from "./support/controlled-t3.ts";
import { reviewedCommit } from "./support/definition-import.ts";
import { assertOk, sampleAgentInput } from "./support/domain-setup.ts";
import { factoryHarness } from "./support/factory.ts";
import { controlledExecution, flowInput, humanStep } from "./support/scenarios.ts";
import { mockIngest } from "./support/telemetry.ts";

it("a committed Flow create sends only anonymous graph structure to the ingest endpoint", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const harness = await factoryHarness(context);
  const factory = await harness.open({ telemetry: { env: ingest.env } });

  // Act
  assertOk(
    await factory.createFlow({
      name: "Private Flow title",
      graph: {
        blocks: [humanStep("private-id", "Private block name")],
        connections: [],
        flowInput: flowInput(),
      },
    }),
  );
  await factory.close();

  // Assert
  expect(ingest.requests).toHaveLength(1);
  expect(ingest.requests[0]).toMatchObject({
    path: "/ingest/batch/",
    body: {
      batch: [
        { event: "app.started" },
        {
          event: "flow.created",
          properties: {
            scope: "global",
            blockCount: "2-5",
            blockTypes: ["finish", "human"],
            usesSubflows: false,
          },
        },
      ],
    },
  });
  expect(JSON.stringify(ingest.requests)).not.toMatch(
    /Private Flow title|Private block name|private-id/,
  );
});

async function connectedStudio(context: Parameters<typeof mockIngest>[0]) {
  const ingest = await mockIngest(context);
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  t3.connection.approve();
  t3.projects.catalog = [
    {
      projectId: "private-project",
      title: "Private Project title",
      workspaceRoot: "/private/workspace",
      available: true,
    },
  ];
  const factory = await harness.open({ t3, telemetry: { env: ingest.env } });
  assertOk(await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" }));
  assertOk(await factory.recheckConnection());
  const [project] = assertOk(await factory.recheckProjects()).projects;
  expect(project).toBeDefined();
  return { ingest, factory, t3, project: project! };
}

it("Flow saves, duplicates, owner changes and removals report the committed operation once", async (context) => {
  // Arrange
  const { ingest, factory, project } = await connectedStudio(context);
  const flow = assertOk(await factory.createFlow({ name: "Private Flow title" }));
  const graph = {
    blocks: [humanStep("private-id", "Private block name")],
    connections: [],
    flowInput: flowInput(),
  };
  const update = {
    name: flow.name,
    graph,
    expectedRevision: flow.revision,
    expectedProjectId: null,
  };

  // Act
  assertOk(await factory.updateFlow(flow.id, update));
  expect((await factory.updateFlow(flow.id, update)).ok).toBe(false);
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: project.id }));
  const duplicate = assertOk(
    await factory.duplicateFlow(flow.id, {
      projectId: plan.projectId,
      expectedRevision: plan.revision,
      agents: plan.agents,
    }),
  );
  assertOk(
    await factory.changeFlowOwner(duplicate.flow.id, {
      expectedProjectId: project.id,
      projectId: null,
    }),
  );
  assertOk(
    await factory.changeFlowOwner(duplicate.flow.id, { expectedProjectId: null, projectId: null }),
  );
  assertOk(await factory.removeFlow(duplicate.flow.id));
  assertOk(await factory.removeFlow(duplicate.flow.id));
  await factory.close();

  // Assert
  const graphProperties = {
    blockCount: "2-5",
    blockTypes: ["finish", "human"],
    usesSubflows: false,
  };
  expect(ingest.requests).toHaveLength(1);
  expect(ingest.requests[0]?.body).toMatchObject({
    batch: [
      { event: "app.started" },
      {
        event: "flow.created",
        properties: {
          scope: "global",
          blockCount: "1",
          blockTypes: ["finish"],
          usesSubflows: false,
        },
      },
      { event: "flow.saved", properties: { scope: "global", ...graphProperties } },
      { event: "flow.duplicated", properties: { scope: "project", ...graphProperties } },
      { event: "owner.changed", properties: { kind: "flow", direction: "to_global" } },
      { event: "flow.removed", properties: { scope: "global", ...graphProperties } },
    ],
  });
  expect(JSON.stringify(ingest.requests)).not.toMatch(
    /Private Flow title|Private block name|private-id|Private Project title|private-project|private\/workspace/,
  );
});

it("Agent authoring reports scope, built-in driver and override presence without execution labels", async (context) => {
  // Arrange
  const { ingest, factory, t3, project } = await connectedStudio(context);
  const input = {
    ...sampleAgentInput("Private Agent title"),
    prompt: "Private Agent prompt",
    execution: controlledExecution(t3.connection.environmentId, {
      modelId: "private-model",
      modelOptions: [],
    }),
  };
  const requestId = assertOk(await factory.reserveAgentCreate());
  const create = {
    ...input,
    requestId,
    projectOverrides: [{ projectId: project.id, execution: input.execution }],
  };

  // Act
  const agent = assertOk(await factory.createAgent(create));
  expect((await factory.createAgent(create)).ok).toBe(false);
  assertOk(
    await factory.updateAgent(agent.id, {
      ...input,
      expectedRevision: agent.revision,
      expectedProjectId: null,
      projectOverrides: [],
    }),
  );
  assertOk(
    await factory.changeAgentOwner(agent.id, { expectedProjectId: null, projectId: project.id }),
  );
  const provider = t3.projects.controlledProviders[0]!;
  t3.projects.controlledProviders[0] = { ...provider, driverKind: "private-custom-driver" };
  assertOk(await factory.removeAgent(agent.id));
  assertOk(await factory.removeAgent(agent.id));
  await factory.close();

  // Assert
  expect(ingest.requests).toHaveLength(1);
  expect(ingest.requests[0]?.body).toMatchObject({
    batch: [
      { event: "app.started" },
      {
        event: "agent.created",
        properties: { scope: "global", driverKind: "codex", hasProjectOverrides: true },
      },
      {
        event: "agent.saved",
        properties: { scope: "global", driverKind: "codex", hasProjectOverrides: false },
      },
      { event: "owner.changed", properties: { kind: "agent", direction: "to_project" } },
      { event: "agent.removed", properties: { scope: "project", hasProjectOverrides: false } },
    ],
  });
  expect(JSON.stringify(ingest.requests)).not.toMatch(
    /Private Agent title|Private Agent prompt|private-model|codex-main|private-custom-driver|Private Project title/,
  );
});

it("portable definitions report their kind on export and on each new import receipt", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Private exported Agent")));
  const flow = assertOk(await factory.createFlow({ name: "Private exported Flow" }));

  // Act
  const agentExport = assertOk(await factory.exportAgent(agent.id));
  const flowExport = assertOk(await factory.exportFlow(flow.id));
  const agentImport = reviewedCommit("private-import-id", agent.execution!, agentExport.document);
  const flowImport = {
    requestId: "private-flow-import-id",
    document: flowExport.document,
    selections: {},
  };
  const [first, retried] = await Promise.all([
    factory.commitImport(agentImport),
    factory.commitImport(agentImport),
  ]);
  expect(assertOk(retried)).toEqual(assertOk(first));
  assertOk(await factory.commitImport(flowImport));
  assertOk(await factory.commitImport(flowImport));
  await factory.close();

  // Assert
  expect(ingest.requests).toHaveLength(1);
  expect(ingest.requests[0]?.body).toMatchObject({
    batch: [
      { event: "app.started" },
      { event: "agent.created" },
      { event: "flow.created" },
      { event: "definition.exported", properties: { kind: "agent" } },
      { event: "definition.exported", properties: { kind: "flow" } },
      { event: "definition.imported", properties: { kind: "agent" } },
      { event: "definition.imported", properties: { kind: "flow" } },
    ],
  });
  expect(JSON.stringify(ingest.requests)).not.toMatch(
    /Private exported|private-import-id|private-flow-import-id|Improve the empty search state/,
  );
});
