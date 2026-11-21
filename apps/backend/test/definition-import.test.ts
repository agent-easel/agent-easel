import { assert, expect, it } from "@effect/vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowGraph, Result } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import { HttpServerResponse } from "effect/http";
import { loadConfiguration } from "../src/config.ts";
import { importBody, readRawBody } from "../src/http-support.ts";
import { startServer } from "../src/server.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import {
  agentFile,
  exportedAgent,
  factoryFailingInserts,
  factoryWithVersion1Receipt,
  fileBody,
  flowFile,
  flowUnderCreateLimitBy,
  fullLegacyFlowFile,
  importFullLegacyFlow,
  interruptedUpload,
  reviewedCommit,
  withReversedKeys,
} from "./support/definition-import.ts";
import {
  assertOk,
  discoveredClones,
  openFactoryWithApprovedT3,
  reviewerExits,
  sampleAgentInput,
} from "./support/domain-setup.ts";
import { factoryHarness } from "./support/factory.ts";
import {
  agentBlock,
  blockExit,
  conditionBlock,
  conditionRule,
  connection,
  continuationStep,
  controlledExecution,
  flowInput,
  humanStep,
  OTHERWISE,
  WAIT_OUTPUT,
  waitBlock,
} from "./support/scenarios.ts";

function remapAgentPlacements(
  blocks: FlowGraph["blocks"],
  imported: ReadonlyMap<string, string | undefined>,
) {
  return blocks.map((block) =>
    block.kind === "agent" && block.agentId !== null
      ? { ...block, agentId: imported.get(block.agentId) }
      : block,
  );
}

it("a file that is not JSON is rejected as not JSON and nothing is created", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(fileBody('{"format": "t3-factory/definitions",'));

  // Assert
  assert(!review.ok);
  expect(review.error.code).toBe("validation");
  expect(review.error.issues).toStrictEqual([
    { code: "not_json", path: "document", message: expect.any(String) },
  ]);
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("JSON without the Factory marker is rejected as not a Factory export", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent(), { format: "x" })));

  // Assert
  assert(!review.ok);
  expect(review.error.issues.map((issue) => issue.code)).toStrictEqual(["not_factory_export"]);
});

it("a newer format version is rejected before its definitions are read and asks to update Factory", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(
    fileBody(agentFile({ unreadable: true }, { formatVersion: 5 })),
  );

  // Assert
  assert(!review.ok);
  expect(review.error.issues).toStrictEqual([
    {
      code: "unsupported_format_version",
      path: "formatVersion",
      message:
        "This file uses format version 5, which this Factory cannot read. Update Factory to import it.",
    },
  ]);
});

it("a version-1 Flow file holding a Condition block is rejected at the block, as version 1 has no such kind", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const { flow, ...file } = flowFile({ formatVersion: 1 });
  const gate = conditionBlock("gate", "Escalate", [conditionRule("ask", "Ask a person", 3)]);
  const graph = { ...flow.graph, blocks: [...flow.graph.blocks, gate] };

  // Act
  const review = await factory.reviewImport(fileBody({ ...file, flow: { ...flow, graph } }));

  // Assert
  assert(!review.ok);
  expect(review.error.issues).toStrictEqual([
    {
      code: "invalid_block_kind",
      path: "flow.graph.blocks.2.kind",
      message: 'Block "Escalate": use an Agent, Human, Wait or Continuation block.',
    },
  ]);
});

it("an invalid definition is rejected at its field, naming the Agent without echoing its prompt", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const prompt = "secret instructions ".repeat(6_001);

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent({ prompt }))));

  // Assert
  assert(!review.ok);
  expect(review.error).toStrictEqual({
    code: "validation",
    message: 'Agent "Code reviewer": Enter a prompt up to 120,000 characters.',
    issues: [
      {
        code: "invalid_prompt",
        path: "agents.0.prompt",
        message: 'Agent "Code reviewer": Enter a prompt up to 120,000 characters.',
      },
    ],
  });
});

it("a file bundling more than 500 Agents is refused as over the limit", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const agents = Array.from({ length: 501 }, (_, index) => exportedAgent({ key: `a${index}` }));

  // Act
  const review = await factory.reviewImport(fileBody({ ...agentFile(), agents }));

  // Assert
  assert(!review.ok);
  expect(review.error.code).toBe("too_large");
  expect(review.error.issues.map((issue) => issue.code)).toStrictEqual(["too_many_agents"]);
});

it("a Flow whose create request fits 2 MB but whose later save would not is refused as over the limit", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  // The create request is 100 bytes under the limit; a save adds `"expectedRevision":…` and an
  // `"expectedProjectId":…` that may name a Project id of up to 256 characters.
  const flow = flowUnderCreateLimitBy(100);

  // Act
  const review = await factory.reviewImport(fileBody({ ...flowFile(), agents: [], flow }));

  // Assert
  assert(!review.ok);
  expect(review.error.code).toBe("too_large");
  expect(review.error.issues).toStrictEqual([
    expect.objectContaining({ code: "definition_too_large", path: "flow" }),
  ]);
});

it("an import upload that breaks off under the size limit is answered as unreadable, not too large", async () => {
  // Arrange
  const request = interruptedUpload();

  // Act
  const read = await Effect.runPromise(readRawBody(request, importBody));

  // Assert
  assert(read.kind === "invalid");
  const response = HttpServerResponse.toWeb(read.response);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: { issues: [expect.objectContaining({ code: "document_unreadable", path: "document" })] },
  });
});

it("an import request over 16 MiB is refused with HTTP 413", async (c) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), "t3-factory-server-"));
  c.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const config = await loadConfiguration({ FACTORY_HOME: directory, FACTORY_PORT: "0" });
  const server = await startServer(config, { uiDirectory: null });
  c.onTestFinished(() => server.close());

  // Act
  const response = await fetch(`http://127.0.0.1:${server.address.port}/api/imports/review`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: " ".repeat(16_777_217),
  });

  // Assert
  expect(response.status).toBe(413);
  const body = (await response.json()) as Result<unknown>;
  assert(!body.ok);
  expect(body.error.code).toBe("too_large");
});

it("reviewing a file shows its instruction inventory and proposes the single catalog model offering its hint, writing nothing", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const review = await factory.reviewImport(fileBody(agentFile()));

  // Assert
  assert(review.ok);
  expect(review.value).toMatchObject({
    kind: "agent",
    agents: [
      {
        key: "agent-1",
        name: "Code reviewer",
        promptLength: exportedAgent().prompt.length,
        exitCount: 2,
        hint: exportedAgent().model,
        match: { status: "matched" },
        proposed: controlledExecution(),
        droppedOptions: [],
      },
    ],
    capabilities: { state: "ready" },
  });
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("the provider instance named in the hint wins over another instance offering the model", async (context) => {
  // Arrange
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  t3.projects.controlledProviders.push({
    ...t3.projects.controlledProviders[0]!,
    providerInstanceId: "codex-elsewhere",
  });

  // Act
  const review = await factory.reviewImport(fileBody(agentFile()));

  // Assert
  assert(review.ok);
  expect(review.value.agents[0]).toMatchObject({
    match: { status: "matched" },
    proposed: controlledExecution(undefined, { providerInstanceId: "codex-elsewhere" }),
  });
});

it("several matching instances without the hint's name leave the Agent ambiguous, naming them", async (context) => {
  // Arrange
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  t3.projects.controlledProviders.push({
    ...t3.projects.controlledProviders[0]!,
    providerInstanceId: "codex-work",
  });

  // Act
  const review = await factory.reviewImport(fileBody(agentFile()));

  // Assert
  assert(review.ok);
  expect(review.value.agents[0]).toMatchObject({
    match: { status: "ambiguous", candidates: ["codex-main", "codex-work"] },
    proposed: null,
  });
});

it("an instance of another driver kind is never matched, even with the hint's instance name", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const model = {
    ...exportedAgent().model!,
    driverKind: "claudeAgent",
    providerInstanceId: "codex-main",
  };

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent({ model }))));

  // Assert
  assert(review.ok);
  expect(review.value.agents[0]).toMatchObject({ match: { status: "unmatched" }, proposed: null });
});

it("a hint without a driver kind does not fall back to the single instance offering its model", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const { driverKind: _omitted, ...model } = exportedAgent().model!;

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent({ model }))));

  // Assert
  assert(review.ok);
  expect(review.value.agents[0]).toMatchObject({ match: { status: "unmatched" }, proposed: null });
});

it("with the catalog not ready nothing is matched", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });
  const model = { ...exportedAgent().model!, providerInstanceId: "codex-main" };

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent({ model }))));

  // Assert
  assert(review.ok);
  expect(review.value.agents[0]).toMatchObject({ match: { status: "unmatched" }, proposed: null });
});

it("a match keeps the hint options its model accepts and lists the dropped rest", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const model = {
    ...exportedAgent().model!,
    modelOptions: [
      { id: "reasoning", value: "high" },
      { id: "verbosity", value: "low" },
    ],
  };

  // Act
  const review = await factory.reviewImport(fileBody(agentFile(exportedAgent({ model }))));

  // Assert
  assert(review.ok);
  expect(review.value.agents[0]).toMatchObject({
    proposed: controlledExecution(undefined, {
      modelOptions: [{ id: "reasoning", value: "high" }],
    }),
    droppedOptions: [{ id: "verbosity", value: "low" }],
  });
});

it("a commit without a target creates a new global Agent at revision 1 with its exact name and exactly the reviewed selection", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const execution = controlledExecution(undefined, {
    modelOptions: [{ id: "reasoning", value: "low" }],
  });

  // Act
  const committed = await factory.commitImport(reviewedCommit("import-1", execution));

  // Assert
  assert(committed.ok);
  const [created] = committed.value.agents;
  expect(created?.key).toBe("agent-1");
  expect(assertOk(await factory.getAgent(created!.id))).toMatchObject({
    projectId: null,
    name: "Code reviewer",
    prompt: exportedAgent().prompt,
    revision: 1,
    execution,
    exits: exportedAgent().exits,
  });
});

it("a Flow file committed into a Project creates the Flow and a new Agent owned by it, even beside a same-named Agent", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  const existing = assertOk(await factory.createAgent(sampleAgentInput("Code reviewer", first.id)));

  // Act
  const committed = await factory.commitImport({
    requestId: "import-flow",
    document: flowFile(),
    selections: { "agent-1": controlledExecution() },
    projectId: first.id,
  });

  // Assert
  assert(committed.ok);
  const [imported] = committed.value.agents;
  expect(imported!.id).not.toBe(existing.id);
  expect(assertOk(await factory.getAgent(imported!.id)).projectId).toBe(first.id);
  const flow = assertOk(await factory.getFlow(committed.value.flowId!));
  expect(flow).toMatchObject({ projectId: first.id, readiness: { ready: true } });
});

it("a commit into an unavailable Project is refused and creates nothing", async (context) => {
  // Arrange
  const { factory, t3, second } = await discoveredClones(context);
  t3.projects.catalog = t3.projects.catalog.filter(
    (project) => project.projectId !== second.projectId,
  );
  assertOk(await factory.recheckProjects());

  // Act
  const committed = await factory.commitImport({ ...reviewedCommit(), projectId: second.id });

  // Assert
  assert(!committed.ok);
  expect(committed.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_project-unavailable", path: "projectId" },
  ]);
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("with T3 disconnected a commit still saves the reviewed selection", async (context) => {
  // Arrange
  const factory = await (await factoryHarness(context)).open({ t3: new ControlledT3() });

  // Act
  const committed = await factory.commitImport(reviewedCommit());

  // Assert
  assert(committed.ok);
  expect(assertOk(await factory.getAgent(committed.value.agents[0]!.id)).execution).toStrictEqual(
    controlledExecution(),
  );
});

it("a selection whose provider has no Factory reporting rejects the whole commit and names the Agent", async (context) => {
  // Arrange
  const { factory, t3 } = await openFactoryWithApprovedT3(context);
  t3.projects.controlledProviders.push({
    ...t3.projects.controlledProviders[0]!,
    providerInstanceId: "future-main",
    driverKind: "future",
  });
  const execution = controlledExecution(undefined, { providerInstanceId: "future-main" });

  // Act
  const committed = await factory.commitImport(reviewedCommit("import-1", execution));

  // Assert
  assert(!committed.ok);
  expect(committed.error.issues).toStrictEqual([
    {
      code: "harness_unsupported",
      path: "selections.agent-1.providerInstanceId",
      message: expect.stringMatching(/^Agent "Code reviewer": /),
    },
  ]);
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("a commit that fails after creating its Agent rolls back and leaves no Agent", async (context) => {
  // Arrange
  const factory = await factoryFailingInserts(context, "definition_import_receipts");

  // Act
  const committed = await factory.commitImport(reviewedCommit());

  // Assert
  assert(!committed.ok);
  expect(committed.error.code).toBe("internal");
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("a committed Flow file arrives as exported with its Agents' keys replaced by the new Agents", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const reviewer = assertOk(
    await factory.createAgent({ ...sampleAgentInput("Reviewer"), exits: reviewerExits }),
  );
  const created = assertOk(await factory.createFlow({ name: "Reviewed change" }));
  const escalate = blockExit("escalate", "escalate", "A person decides.");
  const saved = assertOk(
    await factory.updateFlow(created.id, {
      name: created.name,
      expectedRevision: created.revision,
      expectedProjectId: created.projectId,
      workspace: { mode: "worktree", base: { kind: "ref", ref: "release/2.0" } },
      graph: {
        flowInput: flowInput(["coder"], { x: 10, y: 20 }),
        blocks: [
          agentBlock("coder", "Coder", coder.id, { x: 200, y: 20 }),
          agentBlock(
            "review",
            "Code review",
            reviewer.id,
            { x: 420, y: 20 },
            ["pass"],
            [escalate],
            "Check only the requested fixes.",
          ),
          humanStep("decide", "Decide", { x: 640, y: 20 }),
          waitBlock("cool-off", "Cool off", { amount: 2, unit: "hours" }, { x: 860, y: 20 }),
          continuationStep("polish", "Polish", "Polish the wording.", { x: 1080, y: 20 }),
          { ...agentBlock("unset", "Unset", "", { x: 200, y: 240 }), agentId: null },
          conditionBlock(
            "gate",
            "Escalate",
            [conditionRule("ask", "Ask a person", 3), conditionRule("later", "", null)],
            { x: 640, y: 240 },
          ),
        ],
        connections: [
          connection("coder", "done", "review"),
          connection("review", "fail", "gate"),
          connection("gate", OTHERWISE, "coder"),
          connection("gate", "ask", "decide"),
          connection("review", "escalate", "decide"),
          connection("decide", "approve", "cool-off"),
          connection("cool-off", WAIT_OUTPUT, "polish"),
        ],
      },
    }),
  );
  const { document } = assertOk(await factory.exportFlow(created.id));
  expect(document.formatVersion).toBe(4);

  // Act
  const committed = assertOk(
    await factory.commitImport({
      requestId: "import-flow",
      document,
      selections: { "agent-1": controlledExecution(), "agent-2": null },
    }),
  );

  // Assert
  const ids = new Map(committed.agents.map(({ key, id }) => [key, id]));
  const imported = new Map([
    [coder.id, ids.get("agent-1")],
    [reviewer.id, ids.get("agent-2")],
  ]);
  const flow = assertOk(await factory.getFlow(committed.flowId!));
  expect(flow).toMatchObject({
    name: "Reviewed change",
    revision: 1,
    workspace: saved.workspace,
    graph: {
      ...saved.graph,
      blocks: remapAgentPlacements(saved.graph.blocks, imported),
    },
  });
});

it("a Flow commit that fails after creating its Agents rolls back and leaves no Agent or Flow", async (context) => {
  // Arrange
  const factory = await factoryFailingInserts(context, "flow_revision_connections");

  // Act
  const committed = await factory.commitImport({
    requestId: "import-flow",
    document: flowFile(),
    selections: { "agent-1": controlledExecution() },
  });

  // Assert
  assert(!committed.ok);
  expect(committed.error.code).toBe("internal");
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
  expect(await factory.listFlows()).toStrictEqual({ ok: true, value: [] });
});

it("retrying a commit with the same request id and content returns the original result without a copy", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const first = assertOk(await factory.commitImport(reviewedCommit()));

  // Act
  const retried = await factory.commitImport(reviewedCommit());

  // Assert
  expect(retried).toStrictEqual({ ok: true, value: first });
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("a full-size version-1 Flow still imports with its ordinary finish block and wires and no Finish block", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const file = fullLegacyFlowFile(1);

  // Act
  const committed = await factory.commitImport({
    requestId: "import-flow",
    document: file,
    selections: { "agent-1": controlledExecution() },
  });

  // Assert
  assert(committed.ok);
  const flow = assertOk(await factory.getFlow(committed.value.flowId!));
  expect(flow).toMatchObject({
    name: file.flow.name,
    revision: 1,
    workspace: file.flow.workspace,
    graph: {
      flowInput: file.flow.graph.flowInput,
      connections: file.flow.graph.connections,
    },
  });
  expect(flow.graph).not.toHaveProperty("finish");
  expect(flow.graph.blocks).toHaveLength(500);
  expect(flow.graph.blocks[0]).toMatchObject({
    id: "finish",
    kind: "agent",
    agentId: committed.value.agents[0]!.id,
    revisitContext: "keep",
  });
});

it("a version-2 Flow file without revisitContext imports with keep revisitContext", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const file = flowFile({ formatVersion: 2 });

  // Act
  const committed = await factory.commitImport({
    requestId: "import-flow-v2",
    document: file,
    selections: { "agent-1": controlledExecution() },
  });

  // Assert
  assert(committed.ok);
  const flow = assertOk(await factory.getFlow(committed.value.flowId!));
  expect(flow.graph.blocks[0]).toMatchObject({ id: "review", revisitContext: "keep" });
});

it("a version-4 Flow file preserves fresh revisitContext on import", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const base = flowFile({ formatVersion: 4 });
  const file = {
    ...base,
    flow: {
      ...base.flow,
      graph: {
        ...base.flow.graph,
        blocks: [
          { ...base.flow.graph.blocks[0]!, revisitContext: "fresh" as const },
          base.flow.graph.blocks[1]!,
        ],
      },
    },
  };

  // Act
  const committed = await factory.commitImport({
    requestId: "import-flow-v4-fresh",
    document: file,
    selections: { "agent-1": controlledExecution() },
  });

  // Assert
  assert(committed.ok);
  const flow = assertOk(await factory.getFlow(committed.value.flowId!));
  expect(flow.graph.blocks[0]).toMatchObject({ id: "review", revisitContext: "fresh" });
});

it("a full-size version-2 Flow imports without a Finish block", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const file = fullLegacyFlowFile();

  // Act
  const committed = assertOk(
    await factory.commitImport({
      requestId: "import-flow",
      document: file,
      selections: { "agent-1": controlledExecution() },
    }),
  );

  // Assert
  const flow = assertOk(await factory.getFlow(committed.flowId!));
  expect(flow.graph.blocks).toHaveLength(500);
  expect(flow.graph).not.toHaveProperty("finish");
});

it("renaming a Flow at the former block limit keeps its entire graph", async (context) => {
  // Arrange
  const { factory, flow } = await importFullLegacyFlow(context);

  // Act
  const saved = await factory.updateFlow(flow.id, {
    name: "Renamed full-size Flow",
    expectedRevision: flow.revision,
    expectedProjectId: flow.projectId,
    graph: flow.graph,
  });

  // Assert
  expect(saved).toMatchObject({
    ok: true,
    value: { name: "Renamed full-size Flow", revision: 2 },
  });
  expect(assertOk(await factory.getFlow(flow.id)).graph).toStrictEqual(flow.graph);
});

it("a full-size Flow without a Finish can be exported and reimported as version 4", async (context) => {
  // Arrange
  const { factory, flow } = await importFullLegacyFlow(context);
  const { document } = assertOk(await factory.exportFlow(flow.id));
  const agentBlock = flow.graph.blocks[0];
  assert(agentBlock?.kind === "agent" && agentBlock.agentId);

  // Act
  const copied = await factory.commitImport(reviewedCommit("import-v4", undefined, document));

  // Assert
  assert(copied.ok);
  expect(document.formatVersion).toBe(4);
  const restored = assertOk(await factory.getFlow(copied.value.flowId!));
  const placedAgents = new Map([[agentBlock.agentId, copied.value.agents[0]!.id]]);
  expect(restored.graph).toStrictEqual({
    ...flow.graph,
    blocks: remapAgentPlacements(flow.graph.blocks, placedAgents),
  });
});

const emptyFinish = { position: { x: 960, y: 0 }, endings: [] };

const finishWithEnding = {
  position: { x: 960, y: 0 },
  endings: [{ id: "done", name: "Done", description: "", output: "none", outputDescription: "" }],
} as const;

it("a version-3 import counts a Finish with endings toward the block limit", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const legacy = fullLegacyFlowFile();
  const document = {
    ...legacy,
    formatVersion: 3,
    flow: {
      ...legacy.flow,
      graph: {
        ...legacy.flow.graph,
        finish: finishWithEnding,
      },
    },
  };

  // Act
  const copy = await factory.commitImport(reviewedCommit("import-v3", undefined, document));

  // Assert
  assert(!copy.ok);
  expect(copy.error.issues).toMatchObject([{ code: "graph_too_large", path: "flow.graph" }]);
  expect(assertOk(await factory.listFlows())).toStrictEqual([]);
});

it("version-3 export refuses a 500-block Flow with an ending while preserving the saved graph", async (context) => {
  // Arrange
  const { factory, flow } = await importFullLegacyFlow(context);
  const saved = assertOk(
    await factory.updateFlow(flow.id, {
      name: flow.name,
      expectedRevision: flow.revision,
      expectedProjectId: flow.projectId,
      graph: { ...flow.graph, finish: finishWithEnding },
    }),
  );

  // Act
  const exported = await factory.exportFlow(flow.id);

  // Assert
  assert(!exported.ok);
  expect(exported.error.issues).toMatchObject([{ code: "graph_too_large", path: "flow.graph" }]);
  expect(assertOk(await factory.getFlow(flow.id)).graph).toStrictEqual(saved.graph);
});

it("newly authored Flows must count an added Finish block toward the block limit", async (context) => {
  // Arrange
  const { factory, flow } = await importFullLegacyFlow(context);

  // Act
  const created = await factory.createFlow({
    name: "Too many blocks",
    graph: { ...flow.graph, finish: emptyFinish },
  });

  // Assert
  assert(!created.ok);
  expect(created.error.issues).toMatchObject([{ code: "graph_too_large", path: "graph" }]);
  expect(assertOk(await factory.listFlows())).toHaveLength(1);
});

it("saving a newly authored Flow with a Finish block cannot exceed the block limit by adding one block", async (context) => {
  // Arrange
  const {
    factory,
    flow: { graph },
  } = await importFullLegacyFlow(context);
  const created = assertOk(
    await factory.createFlow({
      name: "At the authoring limit",
      graph: { ...graph, blocks: graph.blocks.slice(0, -1), finish: emptyFinish },
    }),
  );

  // Act
  const saved = await factory.updateFlow(created.id, {
    name: created.name,
    expectedRevision: created.revision,
    expectedProjectId: created.projectId,
    graph: { ...graph, finish: emptyFinish },
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues).toMatchObject([{ code: "graph_too_large", path: "graph" }]);
  expect(assertOk(await factory.getFlow(created.id)).revision).toBe(created.revision);
});

it("a version-2 Flow file holding a Finish block is rejected at it, as version 2 has none", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const { flow, ...file } = flowFile();
  const graph = { ...flow.graph, finish: { position: { x: 700, y: 0 }, endings: [] } };

  // Act
  const review = await factory.reviewImport(fileBody({ ...file, flow: { ...flow, graph } }));

  // Assert
  assert(!review.ok);
  expect(review.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "unknown_field", path: "flow.graph.finish" },
  ]);
});

it("a committed version-3 Flow file distinguishes an ordinary finish target from a Finish ending", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const coder = assertOk(await factory.createAgent(sampleAgentInput("Coder")));
  const created = assertOk(await factory.createFlow({ name: "Deliver" }));
  const delivered = {
    id: "delivered",
    name: "Delivered",
    description: "The change is merged.",
    output: "required",
    outputDescription: "URL of the PR opened",
  } as const;
  const gaveUp = { ...delivered, id: "gave-up", name: "Gave up", output: "none" } as const;
  const wire = (exitId: string, targetEndingId: string) => ({
    sourceBlockId: "coder",
    exitId,
    targetBlockId: "finish",
    targetEndingId,
  });
  const saved = assertOk(
    await factory.updateFlow(created.id, {
      name: created.name,
      expectedRevision: created.revision,
      expectedProjectId: created.projectId,
      workspace: created.workspace,
      graph: {
        flowInput: flowInput("coder"),
        blocks: [
          agentBlock("coder", "Coder", coder.id, { x: 200, y: 20 }),
          humanStep("finish", "Review", { x: 400, y: 20 }),
        ],
        connections: [connection("coder", "done", "finish"), wire("done", "delivered")],
        finish: { position: { x: 600, y: 20 }, endings: [delivered, gaveUp] },
      },
    }),
  );
  const { document } = assertOk(await factory.exportFlow(created.id));
  const reread = await factory.reviewImport(fileBody(document));
  expect(reread.ok).toBe(true);

  // Act
  const committed = assertOk(
    await factory.commitImport({
      requestId: "import-flow",
      document,
      selections: { "agent-1": controlledExecution() },
    }),
  );

  // Assert
  const flow = assertOk(await factory.getFlow(committed.flowId!));
  expect(flow.graph.finish).toStrictEqual(saved.graph.finish);
  expect(flow.graph.connections).toStrictEqual([
    connection("coder", "done", "finish"),
    wire("done", "delivered"),
  ]);
});

it("retrying a full-size version-2 Flow commit with fields reordered returns the original result", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const selections = { "agent-1": controlledExecution() };
  const first = assertOk(
    await factory.commitImport({
      requestId: "import-flow",
      document: fullLegacyFlowFile(),
      selections,
    }),
  );

  // Act
  const retried = await factory.commitImport({
    requestId: "import-flow",
    document: withReversedKeys(fullLegacyFlowFile()),
    selections,
  });

  // Assert
  expect(retried).toStrictEqual({ ok: true, value: first });
  expect(assertOk(await factory.listFlows())).toHaveLength(1);
});

it("retrying an import into a Project that became unavailable replays the original result", async (context) => {
  // Arrange
  const { factory, t3, first } = await discoveredClones(context);
  const commit = { ...reviewedCommit(), projectId: first.id };
  const accepted = assertOk(await factory.commitImport(commit));
  t3.projects.catalog = [];
  assertOk(await factory.recheckProjects());

  // Act
  const retried = await factory.commitImport(commit);

  // Assert
  expect(retried).toStrictEqual({ ok: true, value: accepted });
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("a commit reusing a request id with another target conflicts and creates nothing", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  assertOk(await factory.commitImport(reviewedCommit()));

  // Act
  const moved = await factory.commitImport({ ...reviewedCommit(), projectId: first.id });

  // Assert
  assert(!moved.ok);
  expect(moved.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "import_request_conflict", path: "requestId" },
  ]);
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("a commit reusing a request id with different selections conflicts and creates nothing", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  assertOk(await factory.commitImport(reviewedCommit()));

  // Act
  const changed = await factory.commitImport({
    ...reviewedCommit(),
    selections: { "agent-1": null },
  });

  // Assert
  assert(!changed.ok);
  expect(changed.error.code).toBe("conflict");
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("after restart and removal of the imported Agent a retried commit replays its receipt without T3 and recreates nothing", async (context) => {
  // Arrange
  const harness = await factoryHarness(context);
  const factory = await harness.open({ t3: new ControlledT3() });
  const first = assertOk(await factory.commitImport(reviewedCommit()));
  assertOk(await factory.removeAgent(first.agents[0]!.id));
  await factory.close();
  const reopened = await harness.open({ t3: new ControlledT3() });

  // Act
  const retried = await reopened.commitImport(reviewedCommit());

  // Assert
  expect(retried).toStrictEqual({ ok: true, value: first });
  expect(await reopened.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("after upgrading, a retried commit of a version-1 file replays the receipt the earlier release recorded", async (context) => {
  // Arrange
  const { factory, agentId } = await factoryWithVersion1Receipt(context);
  const document = agentFile(exportedAgent(), { formatVersion: 1 });

  // Act
  const retried = await factory.commitImport(reviewedCommit("import-1", undefined, document));

  // Assert
  expect(retried).toStrictEqual({
    ok: true,
    value: { agents: [{ key: "agent-1", id: agentId }], flowId: null },
  });
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});

it("after upgrading, a retried commit of an earlier release's import into a Project conflicts, as that import was global", async (context) => {
  // Arrange
  const { factory } = await factoryWithVersion1Receipt(context);
  const document = agentFile(exportedAgent(), { formatVersion: 1 });

  // Act
  const retried = await factory.commitImport({
    ...reviewedCommit("import-1", undefined, document),
    projectId: "project-of-a-later-choice",
  });

  // Assert
  assert(!retried.ok);
  expect(retried.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "import_request_conflict", path: "requestId" },
  ]);
  expect(assertOk(await factory.listAgents())).toHaveLength(1);
});
