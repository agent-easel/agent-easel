import { assert, expect, it } from "@effect/vitest";
import { DEFINITION_REQUEST_LIMIT_BYTES, saveRequestBound } from "@t3-factory/domain-validation";
import { discoveredClones, assertOk, openFactoryWithApprovedT3 } from "./support/domain-setup.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";
import {
  agentFile,
  bundledFlow,
  factoryFailingInserts,
  exportedAgent,
  fileBody,
  flowFile,
  flowUnderCreateLimitBy,
  importedNestedFlow,
  nestedFlowFile,
  portableSubflow,
  widePortableComposition,
} from "./support/definition-import.ts";
import {
  agentBlock,
  continuationStep,
  controlledExecution,
  flowInput,
  humanStep,
} from "./support/scenarios.ts";
import { ending, resave, savedFlow, subflowBlock, toEnding } from "./support/subflow.ts";

it("import creates one new copy of every shared Flow and Agent under the chosen owner, preserving ending IDs", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  const { document, source } = await exportedDiamondWithRenamedEnding(factory);

  // Act
  const copied = assertOk(
    await factory.commitImport({
      requestId: "diamond-copy",
      document,
      selections: { "agent-1": controlledExecution() },
      projectId: first.id,
    }),
  );

  // Assert
  const [root, left, leaf, right] = copied.flows!;
  const importedRoot = assertOk(await factory.getFlow(root!.id));
  expect(copied.flowId).toBe(root!.id);
  expect(importedRoot).toMatchObject({
    projectId: first.id,
    revision: 1,
    graph: {
      flowInput: { targetBlockIds: ["left", "right"] },
      blocks: [{ flowId: left!.id }, { flowId: right!.id }],
      connections: [
        toEnding("left", "left-done", "root-done"),
        toEnding("right", "right-done", "root-done"),
      ],
    },
  });
  expect(importedRoot.readiness.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual(
    source.readiness.issues.map(({ code, path }) => ({ code, path })),
  );
  expect(importedRoot.readiness.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "ending_unconnected" })]),
  );
  expect(assertOk(await factory.getFlow(left!.id))).toMatchObject({
    projectId: first.id,
    revision: 1,
    graph: { blocks: [{ flowId: leaf!.id }] },
  });
  expect(assertOk(await factory.getFlow(right!.id))).toMatchObject({
    projectId: first.id,
    revision: 1,
    graph: { blocks: [{ flowId: leaf!.id }] },
  });
  expect(assertOk(await factory.getFlow(leaf!.id))).toMatchObject({
    projectId: first.id,
    revision: 1,
    graph: {
      finish: {
        endings: [
          { id: "done", name: "Renamed" },
          { id: "unwired", name: "Unwired" },
        ],
      },
      blocks: [{ agentId: copied.agents[0]!.id }],
    },
  });
  expect(assertOk(await factory.getAgent(copied.agents[0]!.id))).toMatchObject({
    projectId: first.id,
    revision: 1,
  });
});

it("replay after restart and Flow removal returns actual keys in file order and the non-first root identity", async (context) => {
  // Arrange
  const { harness, factory, request, result } = await importedNestedFlow(context);
  const first = result.flows![0]!;
  assertOk(await factory.removeFlow(first.id));
  await factory.close();
  const reopened = await harness.open({ t3: new ControlledT3() });

  // Act
  const replay = assertOk(await reopened.commitImport(request));

  // Assert
  expect(replay).toStrictEqual(result);
  expect(replay.flows?.map(({ key }) => key)).toStrictEqual(["early", "late", "release"]);
  expect(replay.flowId).toBe(replay.flows?.[2]?.id);
  expect(assertOk(await reopened.listFlows()).map(({ id }) => id)).not.toContain(first.id);
});

it("import rolls back all definitions when a v5 Flow receipt cannot be recorded", async (context) => {
  // Arrange
  const factory = await factoryFailingInserts(context, "definition_import_receipt_flows");

  // Act
  const result = await factory.commitImport({
    requestId: "nested",
    document: nestedFlowFile(),
    selections: { "agent-1": null },
  });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("internal");
  expect(assertOk(await factory.listAgents())).toStrictEqual([]);
  expect(assertOk(await factory.listFlows())).toStrictEqual([]);
});

it.for([
  [
    "dangling",
    [bundledFlow("root", "Root", portableSubflow("child", "Child", "missing"))],
    "unknown_flow_key",
    "flows.0.graph.blocks.0.flowKey",
  ],
  [
    "orphan",
    [
      bundledFlow("root", "Root"),
      bundledFlow("other", "Other", portableSubflow("self", "Itself", "other")),
    ],
    "unreachable_flow",
    "flows.1",
  ],
  [
    "misplaced",
    [
      bundledFlow("root", "Root", {
        ...humanStep("approval", "Approval"),
        flowKey: null,
      } as ReturnType<typeof humanStep>),
    ],
    "unknown_field",
    "flows.0.graph.blocks.0.flowKey",
  ],
] as const)(
  "import rejects a %s Flow reference without writing anything",
  async ([_case, flows, code, path], context) => {
    // Arrange
    const { factory } = await openFactoryWithApprovedT3(context);
    const document = {
      ...agentFile(),
      kind: "flow",
      formatVersion: 5,
      agents: [],
      rootFlowKey: "root",
      flows,
    };

    // Act
    const result = await factory.commitImport({ requestId: "invalid", document, selections: {} });

    // Assert
    assert(!result.ok);
    expect(result.error.issues).toMatchObject([{ code, path }]);
    expect(assertOk(await factory.listFlows())).toStrictEqual([]);
    expect(assertOk(await factory.listAgents())).toStrictEqual([]);
  },
);

it("the version 4 reader rejects a Subflow block even when it carries a null key", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const file = flowFile({ formatVersion: 4 });
  const document = {
    ...file,
    flow: {
      ...file.flow,
      graph: {
        ...file.flow.graph,
        blocks: [portableSubflow("inner", "Inner", null)],
      },
    },
  };

  // Act
  const result = await factory.commitImport({
    requestId: "v4",
    document,
    selections: { "agent-1": null },
  });

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toMatchObject([
    { code: "invalid_block_kind", path: "flow.graph.blocks.0.kind" },
  ]);
  expect(assertOk(await factory.listAgents())).toStrictEqual([]);
  expect(assertOk(await factory.listFlows())).toStrictEqual([]);
});

it("500 bundled Flows import in one commit", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const document = widePortableComposition(500);

  // Act
  const copied = assertOk(
    await factory.commitImport({ requestId: "wide", document, selections: {} }),
  );

  // Assert
  expect(copied.flows).toHaveLength(500);
  expect(assertOk(await factory.listFlows())).toHaveLength(500);
});

it("501 bundled Flows are refused before fields or graph validation", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const document = { ...widePortableComposition(501), unknownField: true };

  // Act
  const imported = await factory.commitImport({ requestId: "wide", document, selections: {} });

  // Assert
  assert(!imported.ok);
  expect(imported.error).toMatchObject({
    code: "too_large",
    issues: [{ code: "too_many_flows", path: "flows" }],
  });
  expect(assertOk(await factory.listFlows())).toStrictEqual([]);
});

it("a closure with exactly 500 Flows exports completely", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const root = await saveWideComposition(factory, 500);

  // Act
  const { document } = assertOk(await factory.exportFlow(root.id));

  // Assert
  expect(document.flows).toHaveLength(500);
  expect(document.flows.at(-1)).toMatchObject({ key: "flow-500", name: "Stage 499" });
});

it("a closure with 501 Flows refuses export with the limit and first offender", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const root = await saveWideComposition(factory, 501);

  // Act
  const result = await factory.exportFlow(root.id);

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "too_large",
    issues: [{ code: "too_many_flows", message: expect.stringContaining('Flow "Stage 500"') }],
  });
});

it("review reports an invalid Flow before the per-save size of another valid definition", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const document = widePortableComposition(2);
  const [root, child] = document.flows;
  const wide = flowUnderCreateLimitBy(100);
  const oversized = { ...child!, name: wide.name, graph: { ...child!.graph, ...wide.graph } };
  const bad = { ...document, flows: [{ ...root!, name: "" }, oversized] };

  // Act
  const result = await factory.reviewImport(fileBody(bad));

  // Assert
  assert(!result.ok);
  expect(result.error.issues[0]?.path).toBe("flows.0.name");
});

type Factory = Awaited<ReturnType<typeof openFactoryWithApprovedT3>>["factory"];

async function exportedDiamondWithRenamedEnding(factory: Factory) {
  const reviewer = assertOk(
    await factory.createAgent({
      name: "Reviewer",
      prompt: "Review",
      execution: controlledExecution(),
      exits: [{ id: "done", name: "Done", description: "", messageRequired: false }],
    }),
  );
  const leaf = await savedFlow(factory, {
    name: "Checks",
    graph: {
      blocks: [agentBlock("check", "Check", reviewer.id)],
      flowInput: flowInput("check"),
      connections: [toEnding("check", "done", "done")],
      finish: {
        position: { x: 800, y: 0 },
        endings: [ending("done", "Done"), ending("unwired", "Unwired")],
      },
    },
  });
  const left = await savedFlow(factory, {
    name: "Review",
    graph: endingPlacement("check", leaf.id, "done", "left-done"),
  });
  const right = await savedFlow(factory, {
    name: "Review",
    graph: endingPlacement("check", leaf.id, "done", "right-done"),
  });
  const root = await savedFlow(factory, {
    name: "Release",
    graph: {
      ...endingPlacement("left", left.id, "left-done", "root-done"),
      flowInput: flowInput("left", "right"),
      blocks: [subflowBlock("left", "Left", left.id), subflowBlock("right", "Right", right.id)],
      connections: [
        toEnding("left", "left-done", "root-done"),
        toEnding("right", "right-done", "root-done"),
      ],
    },
  });
  assertOk(
    await resave(factory, leaf.id, {
      ...leaf.graph,
      finish: {
        ...leaf.graph.finish,
        endings: [ending("done", "Renamed"), ending("unwired", "Unwired")],
      },
    }),
  );
  return {
    ...assertOk(await factory.exportFlow(root.id)),
    source: assertOk(await factory.getFlow(root.id)),
  };
}

function endingPlacement(id: string, source: string, exitId: string, target: string) {
  return {
    blocks: [subflowBlock(id, "Review", source)],
    flowInput: flowInput(id),
    connections: [toEnding(id, exitId, target)],
    finish: { position: { x: 800, y: 0 }, endings: [ending(target, "Done")] },
  };
}

async function saveWideComposition(factory: Factory, count: number) {
  const children = [];
  for (let index = 1; index < count; index++)
    children.push(await savedFlow(factory, { name: `Stage ${index}` }));
  const root = await savedFlow(factory, { name: "Release" });
  const placements = children.slice(0, 499);
  const overflow = children[499];
  if (overflow) {
    const last = placements.at(-1)!;
    assertOk(
      await resave(factory, last.id, {
        ...last.graph,
        blocks: [subflowBlock("overflow", "Overflow", overflow.id)],
      }),
    );
  }
  return assertOk(
    await resave(factory, root.id, {
      ...root.graph,
      blocks: placements.map(({ id, name }, index) => subflowBlock(`stage-${index}`, name, id)),
    }),
  );
}

it("draft import keeps a removed child ending, a null reference and a missing reachable ending", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const { document } = await exportedBrokenDraft(factory);

  // Act
  const copy = assertOk(
    await factory.commitImport({ requestId: "broken-draft", document, selections: {} }),
  );

  // Assert
  const imported = assertOk(await factory.getFlow(copy.flowId!));
  expect(imported.graph.connections).toStrictEqual([toEnding("child", "old", "complete")]);
  expect(imported.graph.blocks).toMatchObject([
    { flowId: copy.flows?.[1]?.id },
    { flowId: null },
    { flowId: null },
  ]);
  expect(imported.readiness.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "subflow_exit_missing" }),
      expect.objectContaining({ code: "subflow_flow_required", path: "graph.blocks.1.flowId" }),
      expect.objectContaining({ code: "subflow_flow_required", path: "graph.blocks.2.flowId" }),
      expect.objectContaining({ code: "subflow_ending_required", path: "graph.blocks.0.flowId" }),
    ]),
  );
  const child = assertOk(await factory.getFlow(copy.flows![1]!.id));
  expect(child.graph.finish?.endings).toMatchObject([{ id: "replacement", name: "Done" }]);
  expect(child.graph.blocks).toMatchObject([{ kind: "agent", agentId: null }]);
});

it("a second import gives a root cycle independent identities", async (context) => {
  // Arrange
  const { factory, request, result } = await importedNestedFlow(context);
  const file = assertOk(await factory.exportFlow(result.flowId!)).document;

  // Act
  const second = assertOk(
    await factory.commitImport({ ...request, requestId: "second", document: file }),
  );

  // Assert
  const [root, left, right] = second.flows!;
  expect(second.flows?.map(({ id }) => id)).not.toEqual(
    expect.arrayContaining(result.flows!.map(({ id }) => id)),
  );
  expect(second.agents[0]?.id).not.toBe(result.agents[0]?.id);
  expect(assertOk(await factory.getFlow(root!.id))).toMatchObject({
    graph: { blocks: [{ flowId: left!.id }, { flowId: right!.id }] },
    readiness: {
      issues: expect.arrayContaining([expect.objectContaining({ code: "subflow_cycle" })]),
    },
  });
  expect(assertOk(await factory.getFlow(left!.id)).graph.blocks).toMatchObject([
    { agentId: second.agents[0]?.id },
    { flowId: root!.id },
  ]);
});

async function exportedBrokenDraft(factory: Factory) {
  const child = await savedFlow(factory, {
    name: "Checks",
    graph: {
      blocks: [{ ...agentBlock("unset", "Unset Agent", "unused"), agentId: null }],
      flowInput: flowInput(),
      connections: [],
      finish: { position: { x: 800, y: 0 }, endings: [ending("old", "Done")] },
    },
  });
  const removed = await savedFlow(factory, { name: "Discarded" });
  const root = await savedFlow(factory, {
    name: "Release",
    graph: {
      ...endingPlacement("child", child.id, "old", "complete"),
      blocks: [
        subflowBlock("child", "Checks", child.id),
        subflowBlock("unset", "Unset", null),
        subflowBlock("removed", "Removed", removed.id),
      ],
    },
  });
  assertOk(
    await resave(factory, child.id, {
      ...child.graph,
      finish: { ...child.graph.finish!, endings: [ending("replacement", "Done")] },
    }),
  );
  assertOk(await factory.removeFlow(removed.id));
  return assertOk(await factory.exportFlow(root.id));
}

it("an Agent count refusal precedes Flow count and shape errors in a v5 bundle", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const document = {
    ...widePortableComposition(501),
    agents: Array.from({ length: 501 }, (_, index) => exportedAgent({ key: `agent-${index}` })),
    missingRootShape: true,
  };

  // Act
  const result = await factory.reviewImport(fileBody(document));

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "too_large",
    issues: [{ code: "too_many_agents", path: "agents" }],
  });
});

it("a bundled Flow must fit its save budget after a short key becomes a fresh ID", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const document = shortKeyNearSaveLimit();

  // Act
  const result = await factory.reviewImport(fileBody(document));

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "too_large",
    issues: [
      {
        code: "definition_too_large",
        path: "flows.0",
        message: expect.stringContaining("Release"),
      },
    ],
  });
});

function shortKeyNearSaveLimit() {
  const document = widePortableComposition(2);
  const child = bundledFlow("a", "Child");
  const { key, ...body } = bundledFlow(
    "release",
    "Release",
    portableSubflow("child", "Child", child.key),
    ...Array.from({ length: 16 }, (_, index) =>
      continuationStep(`step-${index}`, `Step ${index}`, "x".repeat(120_000)),
    ),
    continuationStep("last", "Last", ""),
  );
  const bytes = Buffer.byteLength(JSON.stringify(saveRequestBound(body)));
  const prompt = "x".repeat(DEFINITION_REQUEST_LIMIT_BYTES - bytes - 10);
  const graph = {
    ...body.graph,
    blocks: [...body.graph.blocks.slice(0, -1), continuationStep("last", "Last", prompt)],
  };
  return { ...document, flows: [{ ...body, key, graph }, child] };
}
