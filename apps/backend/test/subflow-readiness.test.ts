import { assert, expect, it } from "@effect/vitest";
import { continuationSources } from "@agent-easel/domain-validation";
import { assertOk } from "./support/domain-setup.ts";
import { agentBlock, connection, continuationStep, flowInput } from "./support/scenarios.ts";
import {
  composition,
  ending,
  heavyWriters,
  placingGraph,
  releaseGraph,
  resave,
  savedFlow,
  sortedClosureDefinitions,
  subflowBlock,
  toEnding,
} from "./support/subflow.ts";

it("a Flow placing a Flow that places it back reports the loop first and no budget", async (c) => {
  // Arrange
  const { factory, endingFlow, placing } = await composition(c);
  const inner = await endingFlow("Inner review", null);
  const outer = await placing("Outer", null, inner.id);

  // Act
  const looped = await resave(factory, inner.id, placingGraph(outer.id));

  // Assert
  assert(looped.ok);
  const reread = assertOk(await factory.getFlow(outer.id));
  expect(reread.readiness.issues).toStrictEqual([
    {
      code: "subflow_cycle",
      path: "graph.blocks.0",
      message:
        "Inner 0: Inner 0 places Outer, which already contains it (Outer → Inner review → Outer). Remove the reference to break the loop.",
      nested: {
        placements: [{ flowId: outer.id, blockId: "inner-0" }],
        flowId: inner.id,
        revision: 2,
        path: "graph.blocks.0.flowId",
      },
    },
  ]);
});

it("an unsaved draft placing its own Flow reports the loop at its Subflow", async (c) => {
  // Arrange
  const { factory, parent, coder, child } = await composition(c);
  const graph = releaseGraph(coder.id, child.id);

  // Act
  const checked = await factory.validateFlow(parent.id, {
    name: parent.name,
    expectedRevision: parent.revision,
    expectedProjectId: null,
    graph: {
      ...graph,
      blocks: [
        graph.blocks[0]!,
        subflowBlock("review", "Review", parent.id, { x: 300, y: 0 }),
        graph.blocks[2]!,
      ],
    },
  });

  // Assert
  assert(checked.ok);
  expect(checked.value.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["subflow_cycle", "graph.blocks.1.flowId"],
    ["subflow_exit_missing", "graph.connections.1"],
    ["subflow_exit_missing", "graph.connections.2"],
  ]);
});

it("a Flow placed twice reports its own finding once, at the shortest placement by block id", async (c) => {
  // Arrange
  const { factory, coder } = await composition(c);
  const broken = await savedFlow(factory, {
    name: "Broken review",
    graph: {
      flowInput: flowInput("work"),
      blocks: [agentBlock("work", "Work", "missing-agent"), agentBlock("check", "Check", coder.id)],
      connections: [toEnding("work", "done", "done"), toEnding("check", "done", "done")],
      finish: { position: { x: 400, y: 0 }, endings: [ending("done", "Done")] },
    },
  });

  // Act
  const parent = await savedFlow(factory, {
    name: "Twice",
    graph: {
      flowInput: flowInput("second", "first"),
      blocks: [
        subflowBlock("second", "Second pass", broken.id),
        subflowBlock("first", "First pass", broken.id, { x: 0, y: 200 }),
      ],
      connections: [],
    },
  });

  // Assert
  expect(parent.readiness.issues).toStrictEqual([
    {
      code: "agent_required",
      path: "graph.blocks.1",
      message: "First pass: Choose a saved Agent for Work.",
      nested: {
        placements: [{ flowId: parent.id, blockId: "first" }],
        flowId: broken.id,
        revision: 1,
        path: "graph.blocks.0.agentId",
      },
    },
    {
      code: "exit_required",
      path: "graph.blocks.1",
      message: "First pass: Add an exit to Work or its Agent.",
      nested: {
        placements: [{ flowId: parent.id, blockId: "first" }],
        flowId: broken.id,
        revision: 1,
        path: "graph.blocks.0",
      },
    },
    {
      code: "unreachable_block",
      path: "graph.blocks.1",
      message: "First pass: Connect a path from the Flow input to Check.",
      nested: {
        placements: [{ flowId: parent.id, blockId: "first" }],
        flowId: broken.id,
        revision: 1,
        path: "graph.blocks.1",
      },
    },
  ]);
});

it("a finding two Flows deep keeps its whole placement path", async (c) => {
  // Arrange
  const { factory, placing } = await composition(c);
  const leaf = await savedFlow(factory, {
    name: "Leaf",
    graph: placingGraph(null),
  });
  const middle = await placing("Middle", null, leaf.id);

  // Act
  const root = await placing("Root", null, middle.id);

  // Assert
  expect(root.readiness.issues).toStrictEqual([
    {
      code: "subflow_flow_required",
      path: "graph.blocks.0",
      message: "Inner 0 › Inner 0: Choose a saved Flow for Inner 0.",
      nested: {
        placements: [
          { flowId: root.id, blockId: "inner-0" },
          { flowId: middle.id, blockId: "inner-0" },
        ],
        flowId: leaf.id,
        revision: 1,
        path: "graph.blocks.0.flowId",
      },
    },
  ]);
});

it("readiness shows 20 findings per code and pages the rest from its cursor", async (c) => {
  // Arrange
  const { factory, placing, endingFlow } = await composition(c);
  const done = await endingFlow("Done check", null);
  const wide = await placing("Wide", null, done.id, ...Array<null>(24).fill(null));
  assert(wide.readiness.cursor);

  // Act
  const page = await factory.listFlowFindings(wide.id, { cursor: wide.readiness.cursor });

  // Assert
  expect(wide.readiness.issues).toHaveLength(20);
  expect(wide.readiness.omitted).toStrictEqual([{ code: "subflow_flow_required", count: 4 }]);
  assert(page.ok);
  expect(page.value).toStrictEqual({
    issues: [21, 22, 23, 24].map((i) => ({
      code: "subflow_flow_required",
      path: `graph.blocks.${i}.flowId`,
      message: `Choose a saved Flow for Inner ${i}.`,
    })),
  });
});

it("a findings cursor is refused once a placed Flow is saved again", async (c) => {
  // Arrange
  const { factory, placing, endingFlow, coder } = await composition(c);
  const done = await endingFlow("Done check", null);
  const wide = await placing("Wide", null, done.id, ...Array<null>(24).fill(null));
  assert(wide.readiness.cursor);
  assert(
    (
      await resave(factory, done.id, {
        ...done.graph,
        blocks: [agentBlock("work", "Reworked", coder.id)],
      })
    ).ok,
  );

  // Act
  const page = await factory.listFlowFindings(wide.id, { cursor: wide.readiness.cursor });

  // Assert
  assert(!page.ok);
  expect(page.error.issues.map((issue) => issue.code)).toStrictEqual(["stale_findings_cursor"]);
});

it("the closure stamp names each placed definition and changes when a draft adds a reference", async (c) => {
  // Arrange
  const { factory, parent, child, coder, reviewer, endingFlow } = await composition(c);
  const extra = await endingFlow("Extra check", null);
  const graph = parent.graph;

  // Act
  const checked = await factory.validateFlow(parent.id, {
    name: parent.name,
    expectedRevision: parent.revision,
    expectedProjectId: null,
    graph: {
      ...graph,
      blocks: [...graph.blocks, subflowBlock("extra", "Extra", extra.id, { x: 600, y: 300 })],
      connections: [
        ...graph.connections,
        { sourceBlockId: "notes", exitId: "done", targetBlockId: "extra" },
      ],
    },
  });

  // Assert
  expect(parent.readiness.closure?.definitions).toStrictEqual(
    sortedClosureDefinitions([
      { kind: "agent", id: coder.id, revision: 1, projectId: null },
      { kind: "agent", id: reviewer.id, revision: 1, projectId: null },
      { kind: "flow", id: parent.id, revision: 1, projectId: null },
      { kind: "flow", id: child.id, revision: 1, projectId: null },
    ]),
  );
  assert(checked.ok);
  expect(checked.value.ready).toBe(true);
  expect(checked.value.closure?.stamp).not.toBe(parent.readiness.closure?.stamp);
  expect(checked.value.closure?.definitions).toContainEqual({
    kind: "flow",
    id: extra.id,
    revision: 1,
    projectId: null,
  });
});

it("moving a placed Flow's owner changes the parent's closure stamp", async (c) => {
  // Arrange
  const { factory, first, endingFlow, placing } = await composition(c);
  const shared = await endingFlow("Shared review", null);
  const parent = await placing("Project parent", first.id, shared.id);

  // Act
  const moved = await factory.changeFlowOwner(shared.id, {
    expectedProjectId: null,
    projectId: first.id,
  });

  // Assert
  assert(moved.ok);
  const reread = assertOk(await factory.getFlow(parent.id));
  expect(reread.readiness.closure?.stamp).not.toBe(parent.readiness.closure?.stamp);
  expect(reread.readiness.closure?.definitions).toContainEqual({
    kind: "flow",
    id: shared.id,
    revision: 1,
    projectId: first.id,
  });
});

it("a nine-level shared diamond counts every expanded block per path and stops at 2,557 blocks with reconciled subtotals", async (c) => {
  // Arrange
  const { diamond } = await composition(c);

  // Act
  const levels = await diamond(9);

  // Assert
  const root = levels[9]!;
  const finding = root.readiness.issues.find(
    (issue) => issue.code === "subflow_expanded_blocks_exceeded",
  );
  expect(root.readiness.issues.map((issue) => issue.code)).toStrictEqual([
    "subflow_expanded_blocks_exceeded",
  ]);
  expect(finding?.message).toBe(
    "This composition expands to 2,557 blocks, over the limit of 2,000. Largest: Level 0 (Inner 0 › Inner 0 › … › Inner 0 › Inner 0), 1,024.",
  );
  expect(finding?.budget).toMatchObject({
    measure: "expandedBlocks",
    total: "2557",
    limit: "2000",
    unique: { flows: 10, agents: 1 },
    subtotals: { flow: { root: "3", direct: "6", deeper: "2548" } },
  });
  const ranked = finding?.budget?.contributors[0];
  expect(ranked?.omitted).toBe(0);
  expect(
    ranked?.ranked.map((row) => [row.name, row.amount, row.multiplicity, row.path.length]),
  ).toStrictEqual([
    ["Level 0", "1024", "512", 9],
    ["Level 1", "768", "256", 8],
    ["Level 2", "384", "128", 7],
    ["Level 3", "192", "64", 6],
    ["Level 4", "96", "32", 5],
    ["Level 5", "48", "16", 4],
    ["Level 6", "24", "8", 3],
    ["Level 7", "12", "4", 2],
    ["Level 8", "6", "2", 1],
    ["Level 9", "3", "1", 0],
  ]);
  expect(levels[8]!.readiness.ready).toBe(true);
});

it("a twelve-level shared diamond also exceeds 10,000 expanded connections, counted per path", async (c) => {
  // Arrange
  const { diamond } = await composition(c);

  // Act
  const levels = await diamond(12);

  // Assert
  const issues = levels[12]!.readiness.issues;
  expect(issues.map((issue) => [issue.code, issue.budget?.total])).toStrictEqual([
    ["subflow_expanded_blocks_exceeded", "20477"],
    ["subflow_expanded_connections_exceeded", "12286"],
  ]);
  expect(issues[1]?.budget?.subtotals).toStrictEqual({
    flow: { root: "2", direct: "4", deeper: "12280" },
  });
});

it("Agents whose multibyte prompts total over 64 MiB of canonical bytes exceed the capture budget, each revision counted once", async (c) => {
  // Arrange
  const { factory, endingFlow } = await composition(c);
  const done = await endingFlow("Done check", null);
  const prompt = "€".repeat(120_000);
  const writers = await heavyWriters(factory, prompt);

  // Act
  const heavy = await savedFlow(factory, {
    name: "Heavy",
    graph: {
      flowInput: flowInput(["check", "again", ...writers.map((_, i) => `writer-${i}`)], {
        x: 0,
        y: 0,
      }),
      blocks: [
        subflowBlock("check", "Check", done.id),
        ...writers.map((agent, i) => agentBlock(`writer-${i}`, agent.name, agent.id)),
        agentBlock("again", "Lead again", writers[0]!.id),
      ],
      connections: [],
    },
  });

  // Assert
  const finding = heavy.readiness.issues.find(
    (issue) => issue.code === "subflow_capture_bytes_exceeded",
  );
  const budget = finding?.budget;
  assert(budget);
  expect(BigInt(budget.total)).toBeGreaterThan(67_108_864n);
  expect(budget.unique).toStrictEqual({ flows: 2, agents: 191 });
  const { flow, agent } = budget.subtotals;
  const { name, workspace, graph } = heavy;
  expect(flow?.root).toBe(String(Buffer.byteLength(JSON.stringify({ name, workspace, graph }))));
  const sum = [flow!.root, flow!.direct, flow!.deeper, agent!.root, agent!.direct, agent!.deeper]
    .map(BigInt)
    .reduce((a, b) => a + b);
  expect(sum.toString()).toBe(budget.total);
  expect(flow!.deeper).toBe("0");
  expect(agent).toMatchObject({ deeper: "0" });
  const agentRanks = budget.contributors.find((group) => group.kind === "agent");
  expect(agentRanks?.ranked).toHaveLength(10);
  expect(agentRanks?.omitted).toBe(181);
  expect(agentRanks?.ranked[0]).toMatchObject({
    name: "Lead writer",
    multiplicity: "2",
    path: [{ flowId: heavy.id, blockId: "again" }],
  });
});

it("a Continuation stops at a Subflow and does not inherit an earlier parent Agent, while nested Continuation issues carry their path", async (c) => {
  // Arrange
  const { factory, coder, endingFlow } = await composition(c);
  const brokenChild = await endingFlow("Broken child", null, {
    flowInput: flowInput("work"),
    blocks: [
      agentBlock("work", "Work", coder.id),
      continuationStep("follow-up", "Follow up", "", { x: 300, y: 0 }),
    ],
    connections: [connection("work", "done", "follow-up"), toEnding("follow-up", "output", "done")],
    finish: { position: { x: 600, y: 0 }, endings: [ending("done", "Done")] },
  });
  const parentGraph = {
    flowInput: flowInput("lead"),
    blocks: [
      agentBlock("lead", "Lead", coder.id),
      subflowBlock("review", "Review", brokenChild.id, { x: 300, y: 0 }),
      continuationStep("after", "After review", "Summarize the review.", { x: 600, y: 0 }),
    ],
    connections: [
      connection("lead", "done", "review"),
      connection("review", "done", "after"),
      toEnding("after", "output", "done"),
    ],
    finish: { position: { x: 900, y: 0 }, endings: [ending("done", "Done")] },
  };

  // Act
  const parent = await savedFlow(factory, { name: "Parent continuation", graph: parentGraph });
  const sources = continuationSources(parentGraph, "after");

  // Assert
  expect(sources).toStrictEqual(["review"]);
  expect(parent.readiness.ready).toBe(false);
  expect(parent.readiness.issues).toContainEqual(
    expect.objectContaining({
      code: "continuation_prompt_required",
      nested: expect.objectContaining({
        flowId: brokenChild.id,
        path: "graph.blocks.1.prompt",
        placements: [{ flowId: parent.id, blockId: "review" }],
      }),
    }),
  );
});

it("a missing Agent reference in a composition suppresses budget calculation until resolved", async (c) => {
  // Arrange
  const { factory, diamond } = await composition(c);
  const levels = await diamond(9);
  const leaf = levels[0]!;

  // Act
  assertOk(
    await resave(factory, leaf.id, {
      flowInput: flowInput("work"),
      blocks: [agentBlock("work", "Work", "missing-agent")],
      connections: [toEnding("work", "done", "done")],
      finish: { position: { x: 400, y: 0 }, endings: [ending("done", "Done")] },
    }),
  );
  const root = assertOk(await factory.getFlow(levels[9]!.id));

  // Assert
  expect(root.readiness.ready).toBe(false);
  expect(root.readiness.issues.map((issue) => issue.code)).toStrictEqual([
    "agent_required",
    "exit_required",
  ]);
});

it("unsaved draft validation measures composition budgets as saved", async (c) => {
  // Arrange
  const { factory, diamond, placing } = await composition(c);
  const levels = await diamond(8);
  const root = await placing("Root", null, levels[8]!.id);

  // Act
  const checked = await factory.validateFlow(root.id, {
    name: root.name,
    expectedRevision: root.revision,
    expectedProjectId: null,
    graph: placingGraph(levels[8]!.id, levels[8]!.id),
  });

  // Assert
  assert(checked.ok);
  expect(checked.value.ready).toBe(false);
  expect(checked.value.issues.map((issue) => issue.code)).toStrictEqual([
    "subflow_expanded_blocks_exceeded",
  ]);
});
