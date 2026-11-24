import type { TestContext } from "@effect/vitest";
import type { RunDetail } from "@agent-easel/contracts";
import { assertOk } from "./domain-setup.ts";
import { queuedJoinMessageLost } from "./join-storage.ts";
import { prepared } from "./prepared-runner.ts";
import {
  agentBlock,
  blockWorkerLaunched,
  connection,
  flowInput,
  humanStep,
  joinBlock,
  launchedWorkers,
  observeFor,
  reportRejected,
  resultReported,
  type ScenarioWorld,
} from "./scenarios.ts";
import {
  ending,
  placingGraph,
  reviewPanelGraph,
  savedFlow,
  subflowBlock,
  toEnding,
} from "./subflow.ts";

const templateBlock = (run: RunDetail, templateBlockId: string) =>
  run.blocks.find((block) => block.templateBlockId === templateBlockId)!.blockId;

const placementTotal = (world: ScenarioWorld, runId: string, total: number) =>
  observeFor(`${total} invocations`, world, runId, (run) => run.subflows?.[0]?.total === total);

export async function queuedReviewPanel(c: TestContext) {
  const fixture = await prepared(c);
  const { f, input, agent, world } = fixture;
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const base = placingGraph(child.id);
  const parent = await savedFlow(f, {
    name: "Queue",
    graph: {
      ...base,
      flowInput: flowInput("first", "second", "third"),
      blocks: [
        ...base.blocks,
        agentBlock("first", "First", agent.id),
        agentBlock("second", "Second", agent.id),
        agentBlock("third", "Third", agent.id),
      ],
      connections: [
        connection("first", "done", "inner-0"),
        connection("second", "done", "inner-0"),
        connection("third", "done", "inner-0"),
        toEnding("inner-0", "needs-changes", "done"),
      ],
    },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [first, second, third],
  } = await launchedWorkers(world, started.id);
  await resultReported(world, first!, { message: "One" });
  const active = await observeFor(
    "first invocation active",
    world,
    started.id,
    (run) =>
      run.subflows?.[0]?.defaultInvocation?.blocks.filter((block) => block.threadId).length === 2,
  );
  await resultReported(world, second!, { message: "Two" });
  await placementTotal(world, started.id, 2);
  await resultReported(world, third!, { message: "Three" });
  await placementTotal(world, started.id, 3);
  return {
    ...fixture,
    runId: started.id,
    reviewers: [templateBlock(active, "security"), templateBlock(active, "style")],
  };
}

async function startedReviewPanel(c: TestContext) {
  const fixture = await prepared(c);
  const { f, input, agent, world } = fixture;
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const { workers } = await launchedWorkers(world, started.id);
  return { ...fixture, runId: started.id, workers };
}

export async function returnedReviewPanel(c: TestContext) {
  const panel = await startedReviewPanel(c);
  const {
    t3,
    world,
    runId,
    workers: [security],
  } = panel;
  t3.threads.stopsEndThreads();
  await resultReported(world, security!, { message: "Reviewed" });
  await observeFor(
    "invocation returned",
    world,
    runId,
    (run) => run.subflows?.[0]?.defaultInvocation?.state === "returned",
  );
  return panel;
}

export async function reviewPanelWithFailedStop(c: TestContext) {
  const panel = await startedReviewPanel(c);
  const {
    t3,
    world,
    runId,
    workers: [security],
  } = panel;
  t3.contract.support.stop = false;
  await resultReported(world, security!);
  await observeFor("invocation Stop problem", world, runId, (run) =>
    run.attention.some((matter) => matter.kind === "subflow-stop-unresolved"),
  );
  return panel;
}

export async function elevenPlacementsWithNested(c: TestContext) {
  const fixture = await prepared(c);
  const { f, input, agent, world } = fixture;
  const leaf = await savedFlow(f, {
    name: "Leaf",
    graph: {
      flowInput: flowInput("work"),
      blocks: [agentBlock("work", "Leaf work", agent.id)],
      connections: [toEnding("work", "done", "done")],
      finish: { position: { x: 400, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const middle = await savedFlow(f, {
    name: "Middle",
    graph: {
      flowInput: flowInput("nested"),
      blocks: [subflowBlock("nested", "Nested leaf", leaf.id)],
      connections: [toEnding("nested", "done", "done")],
      finish: { position: { x: 400, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const root = await savedFlow(f, {
    name: "Many placements",
    graph: placingGraph(middle.id, ...Array.from({ length: 10 }, () => leaf.id)),
  });
  const started = assertOk(await f.startRun({ ...input, flowId: root.id }));
  const {
    workers: [work],
  } = await launchedWorkers(world, started.id);
  return { ...fixture, runId: started.id, work: work! };
}

export async function sameNamedBlocksWithProblems(c: TestContext) {
  const fixture = await prepared(c);
  const { f, input, agent, world } = fixture;
  const finish = { position: { x: 600, y: 0 }, endings: [ending("done", "Done")] };
  const leaf = await savedFlow(f, {
    name: "Leaf",
    graph: {
      flowInput: flowInput("leaf-worker"),
      blocks: [agentBlock("leaf-worker", "Reviewer", agent.id)],
      connections: [toEnding("leaf-worker", "done", "done")],
      finish,
    },
  });
  const middle = await savedFlow(f, {
    name: "Middle",
    graph: {
      flowInput: flowInput("nested"),
      blocks: [subflowBlock("nested", "Nested review", leaf.id)],
      connections: [toEnding("nested", "done", "done")],
      finish,
    },
  });
  const ids = ["root-a", "root-b", "place-a", "place-b"];
  const root = await savedFlow(f, {
    name: "Parallel review",
    graph: {
      flowInput: flowInput(...ids),
      blocks: [
        agentBlock("root-a", "Reviewer", agent.id),
        agentBlock("root-b", "Reviewer", agent.id),
        subflowBlock("place-a", "Review", middle.id),
        subflowBlock("place-b", "Review", middle.id),
      ],
      connections: ids.map((id) => toEnding(id, "done", "done")),
      finish,
    },
  });
  const { id: runId } = assertOk(await f.startRun({ ...input, flowId: root.id }));
  await observeFor(
    "all four reviewers activated",
    world,
    runId,
    (run) => run.activations.length === 4,
  );
  const { workers } = await launchedWorkers(world, runId);
  for (const worker of workers) await reportRejected(world, worker);
  return { ...fixture, runId, reportingIds: workers.map((worker) => worker.blockId) };
}

export async function joinProblemInEarlierInvocation(c: TestContext) {
  const fixture = await prepared(c);
  const { f, h, t3, input, agent, world } = fixture;
  const child = await savedFlow(f, {
    name: "Joined review",
    graph: {
      flowInput: flowInput("a", "b", "c"),
      blocks: [
        agentBlock("a", "Reviewer A", agent.id, { x: 200, y: 0 }),
        agentBlock("b", "Reviewer B", agent.id, { x: 200, y: 200 }),
        agentBlock("c", "Reviewer C", agent.id, { x: 200, y: 400 }),
        joinBlock("merge", "Merge", { x: 500, y: 100 }),
        humanStep("review", "Confirm", { x: 800, y: 100 }),
      ],
      connections: [
        connection("a", "done", "merge"),
        connection("b", "done", "merge"),
        connection("merge", "output", "review"),
        toEnding("c", "done", "done"),
        toEnding("review", "approve", "done"),
      ],
      finish: { position: { x: 1000, y: 100 }, endings: [ending("done", "Done")] },
    },
  });
  const parent = await savedFlow(f, {
    name: "Two reviews",
    graph: {
      flowInput: flowInput("first", "second"),
      blocks: [
        agentBlock("first", "First", agent.id),
        agentBlock("second", "Second", agent.id),
        subflowBlock("inner-0", "Inner 0", child.id, { x: 300, y: 0 }),
      ],
      connections: [
        connection("first", "done", "inner-0"),
        connection("second", "done", "inner-0"),
        toEnding("inner-0", "done", "done"),
      ],
      finish: { position: { x: 600, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const runId = started.id;
  const {
    workers: [first, second],
  } = await launchedWorkers(world, runId);
  await resultReported(world, first!);
  const invocation = await observeFor(
    "first invocation active",
    world,
    runId,
    (run) =>
      run.subflows?.[0]?.defaultInvocation?.blocks.filter((block) => block.threadId).length === 3,
  );
  const merge = templateBlock(invocation, "merge");
  await resultReported(
    world,
    await blockWorkerLaunched(world, runId, templateBlock(invocation, "a")),
  );
  await observeFor("one Join arrival", world, runId, (run) =>
    run.joins.some((join) => join.arrived === 1),
  );
  queuedJoinMessageLost(h.databasePath);
  await resultReported(
    world,
    await blockWorkerLaunched(world, runId, templateBlock(invocation, "b")),
  );
  await observeFor("Join integrity Problem", world, runId, (run) =>
    run.attention.some((matter) => matter.kind === "join-integrity"),
  );
  await resultReported(world, second!);
  await placementTotal(world, runId, 2);
  t3.threads.stopsEndThreads();
  await resultReported(
    world,
    await blockWorkerLaunched(world, runId, templateBlock(invocation, "c")),
  );
  await observeFor(
    "second invocation is the default",
    world,
    runId,
    (run) => run.subflows?.[0]?.defaultInvocation?.number === 2,
  );
  return { ...fixture, runId, merge };
}
