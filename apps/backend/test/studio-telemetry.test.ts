import { expect, it } from "@effect/vitest";
import { ControlledT3 } from "./support/controlled-t3.ts";
import { reviewedCommit } from "./support/definition-import.ts";
import { assertOk, sampleAgentInput } from "./support/domain-setup.ts";
import { factoryHarness } from "./support/factory.ts";
import { controlledExecution, flowInput, humanStep } from "./support/scenarios.ts";
import { placingGraph, resave, savedFlow } from "./support/subflow.ts";
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

it("saving a Subflow placement reports its kind without exposing either Flow identity", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const child = await savedFlow(factory, { name: "Private child Flow" });
  const root = await savedFlow(factory, { name: "Private root Flow" });

  // Act
  assertOk(await resave(factory, root.id, placingGraph(child.id)));
  await factory.close();

  // Assert
  expect(ingest.events("flow.saved")).toMatchObject([
    { properties: { blockCount: "2-5", blockTypes: ["finish", "subflow"], usesSubflows: true } },
  ]);
  const payload = JSON.stringify(ingest.events("flow.saved"));
  expect(payload).not.toContain(child.id);
  expect(payload).not.toContain(root.id);
  expect(payload).not.toContain("Private");
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

it("saving a Flow emits its graph once when the repeated revision is stale", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const flow = assertOk(await factory.createFlow({ name: "Private Flow title" }));
  const update = {
    name: "Private edited",
    graph: flow.graph,
    expectedRevision: flow.revision,
    expectedProjectId: null,
  };

  // Act
  assertOk(await factory.updateFlow(flow.id, update));
  expect((await factory.updateFlow(flow.id, update)).ok).toBe(false);
  await factory.close();

  // Assert
  expect(ingest.events("flow.saved")).toMatchObject([
    {
      properties: { blockCount: "1", blockTypes: ["finish"], usesSubflows: false, scope: "global" },
    },
  ]);
  expect(JSON.stringify(ingest.events("flow.saved"))).not.toMatch(/Private|private|codex-main/);
});

it("duplicating a Flow reports the destination scope", async (context) => {
  // Arrange
  const { ingest, factory, project } = await connectedStudio(context);
  const flow = assertOk(await factory.createFlow({ name: "Private Flow title" }));
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: project.id }));

  // Act
  assertOk(
    await factory.duplicateFlow(flow.id, {
      projectId: plan.projectId,
      expectedRevision: plan.revision,
      agents: plan.agents,
    }),
  );
  await factory.close();

  // Assert
  expect(ingest.events("flow.duplicated")).toMatchObject([
    {
      properties: {
        blockCount: "1",
        blockTypes: ["finish"],
        usesSubflows: false,
        scope: "project",
      },
    },
  ]);
  expect(JSON.stringify(ingest.events("flow.duplicated"))).not.toMatch(
    /Private|private|codex-main/,
  );
});

it("moving a Flow to global scope emits one owner change across a repeated move", async (context) => {
  // Arrange
  const { ingest, factory, project } = await connectedStudio(context);
  const flow = assertOk(
    await factory.createFlow({ projectId: project.id, name: "Private Flow title" }),
  );

  // Act
  assertOk(
    await factory.changeFlowOwner(flow.id, { expectedProjectId: project.id, projectId: null }),
  );
  assertOk(await factory.changeFlowOwner(flow.id, { expectedProjectId: null, projectId: null }));
  await factory.close();

  // Assert
  expect(ingest.events("owner.changed")).toMatchObject([
    { properties: { kind: "flow", direction: "to_global" } },
  ]);
  expect(JSON.stringify(ingest.events("owner.changed"))).not.toMatch(/Private|private|codex-main/);
});

it("removing a Flow twice emits one removal", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const flow = assertOk(await factory.createFlow({ name: "Private Flow title" }));

  // Act
  assertOk(await factory.removeFlow(flow.id));
  assertOk(await factory.removeFlow(flow.id));
  await factory.close();

  // Assert
  expect(ingest.events("flow.removed")).toMatchObject([
    {
      properties: { blockCount: "1", blockTypes: ["finish"], usesSubflows: false, scope: "global" },
    },
  ]);
  expect(JSON.stringify(ingest.events("flow.removed"))).not.toMatch(/Private|private|codex-main/);
});

async function agentDraft(context: Parameters<typeof mockIngest>[0]) {
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
  return { ingest, factory, project, input, create };
}

it("creating an Agent reports only its built-in driver and presence of overrides", async (context) => {
  // Arrange
  const { ingest, factory, create } = await agentDraft(context);

  // Act
  assertOk(await factory.createAgent(create));
  expect((await factory.createAgent(create)).ok).toBe(false);
  await factory.close();

  // Assert
  expect(ingest.events("agent.created")).toMatchObject([
    { properties: { scope: "global", driverKind: "codex", hasProjectOverrides: true } },
  ]);
  expect(JSON.stringify(ingest.events("agent.created"))).not.toMatch(/Private|private|codex-main/);
});

it("saving an Agent reports the committed override state", async (context) => {
  // Arrange
  const { ingest, factory, input, create } = await agentDraft(context);
  const agent = assertOk(await factory.createAgent(create));

  // Act
  assertOk(
    await factory.updateAgent(agent.id, {
      ...input,
      expectedRevision: agent.revision,
      expectedProjectId: null,
      projectOverrides: [],
    }),
  );
  await factory.close();

  // Assert
  expect(ingest.events("agent.saved")).toMatchObject([
    { properties: { scope: "global", driverKind: "codex", hasProjectOverrides: false } },
  ]);
  expect(JSON.stringify(ingest.events("agent.saved"))).not.toMatch(/Private|private|codex-main/);
});

it("moving an Agent into a Project reports only the owner change direction", async (context) => {
  // Arrange
  const { ingest, factory, project, create } = await agentDraft(context);
  const agent = assertOk(await factory.createAgent({ ...create, projectOverrides: [] }));

  // Act
  assertOk(
    await factory.changeAgentOwner(agent.id, { expectedProjectId: null, projectId: project.id }),
  );
  await factory.close();

  // Assert
  expect(ingest.events("owner.changed")).toMatchObject([
    { properties: { kind: "agent", direction: "to_project" } },
  ]);
  expect(JSON.stringify(ingest.events("owner.changed"))).not.toMatch(/Private|private|codex-main/);
});

it("removing an Agent twice emits a single removal with the known driver", async (context) => {
  // Arrange
  const { ingest, factory, create } = await agentDraft(context);
  const agent = assertOk(await factory.createAgent(create));

  // Act
  assertOk(await factory.removeAgent(agent.id));
  assertOk(await factory.removeAgent(agent.id));
  await factory.close();

  // Assert
  expect(ingest.events("agent.removed")).toMatchObject([
    { properties: { scope: "global", driverKind: "codex", hasProjectOverrides: true } },
  ]);
  expect(JSON.stringify(ingest.events("agent.removed"))).not.toMatch(/Private|private|codex-main/);
});

it("exporting an Agent reports its kind", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const item = assertOk(await factory.createAgent(sampleAgentInput("Private exported Agent")));

  // Act
  assertOk(await factory.exportAgent(item.id));
  await factory.close();

  // Assert
  expect(ingest.events("definition.exported")).toMatchObject([{ properties: { kind: "agent" } }]);
  expect(JSON.stringify(ingest.events("definition.exported"))).not.toMatch(
    /Private|private|codex-main/,
  );
});

it("retrying an Agent import reports its kind once", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const item = assertOk(await factory.createAgent(sampleAgentInput("Private exported Agent")));
  const { document } = assertOk(await factory.exportAgent(item.id));
  const input = reviewedCommit("private-import-id", item.execution!, document);

  // Act
  const [first, retry] = await Promise.all([
    factory.commitImport(input),
    factory.commitImport(input),
  ]);
  expect(assertOk(retry)).toEqual(assertOk(first));
  await factory.close();

  // Assert
  expect(ingest.events("definition.imported")).toMatchObject([{ properties: { kind: "agent" } }]);
  expect(JSON.stringify(ingest.events("definition.imported"))).not.toMatch(
    /Private|private|codex-main/,
  );
});

it("exporting a Flow reports its kind", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const item = assertOk(await factory.createFlow({ name: "Private exported Flow" }));

  // Act
  assertOk(await factory.exportFlow(item.id));
  await factory.close();

  // Assert
  expect(ingest.events("definition.exported")).toMatchObject([{ properties: { kind: "flow" } }]);
  expect(JSON.stringify(ingest.events("definition.exported"))).not.toMatch(
    /Private|private|codex-main/,
  );
});

it("concurrent retries of a composed Flow import report its kind once", async (context) => {
  // Arrange
  const { ingest, factory } = await connectedStudio(context);
  const child = await savedFlow(factory, { name: "Private child Flow" });
  const item = await savedFlow(factory, {
    name: "Private exported Flow",
    graph: placingGraph(child.id),
  });
  const { document } = assertOk(await factory.exportFlow(item.id));
  const input = { requestId: "private-flow-import-id", document, selections: {} };

  // Act
  const [first, retry] = await Promise.all([
    factory.commitImport(input),
    factory.commitImport(input),
  ]);
  await factory.close();

  // Assert
  const imported = assertOk(first);
  expect(assertOk(retry)).toStrictEqual(imported);
  expect(imported.flows).toHaveLength(2);
  expect(imported.flowId).toBe(imported.flows?.[0]?.id);
  expect(ingest.events("definition.imported")).toMatchObject([{ properties: { kind: "flow" } }]);
  expect(JSON.stringify(ingest.events("definition.imported"))).not.toMatch(
    /Private|private|codex-main/,
  );
});
