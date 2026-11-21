import { expect, it } from "@effect/vitest";
import { assertOk } from "./support/domain-setup.ts";
import { promptAnswered, promptSent } from "./support/continuation.ts";
import {
  agentBlock,
  blockExit,
  blockWorkerLaunched,
  allTurnsEnd,
  connection,
  continuationStep,
  conditionBlock,
  conditionRule,
  humanStep,
  flowInput,
  launchedWorkers,
  waitBlock,
  observeFor,
  resultHeld,
  resultReported,
} from "./support/scenarios.ts";
import { imageRequest, screenshots } from "./support/run-images.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { prepared, preparedServer } from "./support/prepared-runner.ts";
import {
  ending,
  composition,
  heavyWriters,
  resave,
  placingGraph,
  reviewPanelGraph,
  savedFlow,
  toEnding,
} from "./support/subflow.ts";

it("starts a saved child on the same Run and replays Start after the child is removed", async (c) => {
  // Arrange
  const { f, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const request = { ...input, flowId: parent.id };

  // Act
  const started = assertOk(await f.startRun(request));
  assertOk(await f.reconcileRuns());
  assertOk(await f.removeFlow(child.id));
  const replayed = assertOk(await f.startRun(request));

  // Assert
  expect(replayed.id).toBe(started.id);
  expect(replayed.definitions.subflows?.map((flow) => flow.id)).toEqual([child.id]);
  expect(
    replayed.blocks.find((block) => block.name === "Security reviewer")?.threadId,
  ).toBeTruthy();
});

it("holds the winning child ending until the other worker is verified stopped", async (c) => {
  // Arrange
  const { f, h, t3, world, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [first, second],
  } = await launchedWorkers(world, started.id);
  await resultReported(world, first!, { message: "Reviewed" });
  allTurnsEnd(world, first!, "completed");
  assertOk(await f.reconcileRuns());
  const stopping = assertOk(await f.getRun(started.id));

  // Act
  await f.close();
  allTurnsEnd(world, second!, "interrupted");
  const reopened = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  expect(stopping.result).toBeNull();
  expect(t3.threads.threadStops.map((stop) => stop.threadId)).toEqual([second!.threadId]);
  const finished = assertOk(await reopened.getRun(started.id));
  expect(finished.result).toMatchObject({
    endingId: "done",
    output: "Reviewed",
    origin: { threadId: first!.threadId },
  });
});

it("keeps a history cursor on the same window while a third arrival joins a serial Subflow queue", async (c) => {
  // Arrange
  const { f, t3, mcp, world, input, agent } = await preparedServer(c);
  const client = await factoryMcpClient(c, f);
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
  await observeFor(
    "first invocation active",
    world,
    started.id,
    (run) =>
      run.subflows?.[0]?.defaultInvocation?.blocks.filter((block) => block.threadId).length === 2,
  );
  await resultReported(world, second!, { message: "Two" });
  await observeFor(
    "second invocation queued",
    world,
    started.id,
    (run) => run.subflows?.[0]?.total === 2,
  );
  const page = assertOk(await f.listSubflowInvocations(started.id, "inner-0", "1", ""));
  const launches = t3.threads.launches.size;

  // Act
  await resultHeld(world, third!, { message: "Three" });
  await resultReported(world, third!, { message: "Three" });
  const after = await observeFor(
    "third distinct invocation queued",
    world,
    started.id,
    (run) => run.subflows?.[0]?.total === 3,
  );
  const next = assertOk(
    await f.listSubflowInvocations(started.id, "inner-0", "1", page.nextCursor!),
  );

  // Assert
  expect(t3.threads.launches.size).toBe(launches);
  expect(page).toMatchObject({
    highWater: 2,
    invocations: [{ number: 2, state: "queued", input: "Two" }],
  });
  expect(next).toMatchObject({
    highWater: 2,
    nextCursor: null,
    invocations: [{ number: 1, state: "active", input: "One" }],
  });
  expect(after.subflows?.[0]).toMatchObject({
    total: 3,
    queued: 2,
    defaultInvocation: { id: next.invocations[0]!.id },
  });
  const tool = await client.callTool({
    name: "factory_get_subflow_invocations",
    arguments: {
      blockId: third!.blockId,
      placementBlockId: "inner-0",
      limit: 1,
      cursor: page.nextCursor,
    },
  });
  expect(toolReply(tool)).toEqual({ code: "SUBFLOW_INVOCATIONS", ...next });
  const runTool = await client.callTool({
    name: "factory_get_run",
    arguments: { blockId: third!.blockId },
  });
  expect(toolReply(runTool).subflows).toEqual(after.subflows);
  const url = new URL("/api/runs/" + started.id + "/subflows/inner-0/invocations", mcp);
  url.searchParams.set("limit", "1");
  url.searchParams.set("cursor", page.nextCursor!);
  expect(await (await fetch(url)).json()).toEqual({ ok: true, value: next });
});

it("a closed inner Block report is informational and the same thread can report the parent Continuation", async (c) => {
  // Arrange
  const { f, t3, world, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const graph = placingGraph(child.id);
  const parent = await savedFlow(f, {
    name: "Release",
    graph: {
      ...graph,
      blocks: [
        ...graph.blocks,
        waitBlock("wait", "Pause", { amount: 1, unit: "minutes" }, { x: 200, y: 0 }),
        conditionBlock("gate", "Gate", [], { x: 350, y: 0 }),
        continuationStep("spec", "Summarize", "Summarize the review.", { x: 500, y: 0 }),
      ],
      connections: [
        connection("inner-0", "approved", "wait"),
        connection("wait", "output", "gate"),
        connection("gate", "otherwise", "spec"),
        toEnding("spec", "output", "done"),
      ],
    },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [first],
  } = await launchedWorkers(world, started.id);
  t3.threads.stopsEndThreads();
  await resultReported(world, first!, { message: "Reviewed" });
  const held = await observeFor("child return held at Wait", world, started.id, (run) =>
    run.waitArrivals.some((arrival) => arrival.state === "pending"),
  );
  assertOk(await f.continueWaitArrival(held.waitArrivals[0]!.id));
  const prompt = await promptSent(world, first!);

  // Act
  const late = await f.runtime.submit({
    arguments: { blockId: first!.blockId, to: "finished", exit: "done", message: "Late" },
  });
  await promptAnswered(world, first!, prompt, "Ready to publish.");
  const finished = await observeFor(
    "parent ending reached",
    world,
    started.id,
    (run) => run.result?.endingId === "done",
  );

  // Assert
  expect(late.code).toBe("INVOCATION_CLOSED");
  expect(prompt.message).toContain("Subflow returned Approved:\nReviewed");
  expect(held.waitArrivals[0]?.message).toBe("Reviewed");
  expect(finished.intents.find((intent) => intent.blockId === "spec")).toMatchObject({
    origin: { threadId: first!.threadId },
    subflowReturn: { endingId: "approved", endingName: "Approved" },
  });
  expect(finished.events).toContainEqual(
    expect.objectContaining({ kind: "subflow-report-ignored", blockId: first!.flowBlockId }),
  );
  expect(finished.result).toMatchObject({
    output: "Ready to publish.",
    sourceBlockId: "spec",
    origin: { threadId: first!.threadId },
  });
  expect(finished.subflows?.[0]?.defaultInvocation?.ending).toMatchObject({
    output: "Reviewed",
    delivery: "released",
    origin: { threadId: first!.threadId },
  });
});

it("rejects a changed nested revision at Start acceptance before creating a Run or worker", async (c) => {
  // Arrange
  const { f, git, t3, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Worktree review",
    workspace: { mode: "worktree", base: { kind: "default" } },
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const resolve = git.resolveBaseRef.bind(git);
  git.resolveBaseRef = async (...args) => {
    assertOk(
      await resave(f, child.id, { ...child.graph, flowInput: flowInput("style", "security") }),
    );
    return resolve(...args);
  };

  // Act
  const started = await f.startRun({ ...input, flowId: parent.id });

  // Assert
  expect(started).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(assertOk(await f.listRunNavigation())).toEqual([]);
  expect(t3.threads.launches.size).toBe(0);
});

it("starts an entry-only worktree chain with the saved first Agent and all original Start images", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const { f, t3, agent, world } = setup;
  const leaf = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const middle = await savedFlow(f, {
    name: "Panel",
    graph: { ...placingGraph(leaf.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const parent = await savedFlow(f, {
    name: "Worktree review",
    workspace: { mode: "worktree", base: { kind: "default" } },
    graph: placingGraph(middle.id),
  });
  const request = { ...(await imageRequest(setup)), flowId: parent.id };

  // Act
  const started = assertOk(await f.startRun(request));
  await observeFor(
    "both nested workers share the bound worktree",
    world,
    started.id,
    (run) =>
      run.workspace.mode === "worktree" &&
      run.workspace.state === "bound" &&
      run.blocks.filter((block) => block.threadId).length === 2,
  );
  const {
    run,
    workers: [first],
  } = await launchedWorkers(world, started.id);
  const originalImage = await f.runtime.image({
    arguments: { blockId: first!.blockId, imageId: "red" },
  });

  // Assert
  expect(run.workspace).toMatchObject({
    mode: "worktree",
    state: "bound",
    creatorBlockId: first!.flowBlockId,
    creatorPlacementPath: ["inner-0", "inner-0", "security"],
  });
  const launches = [...t3.threads.launches.values()].map(({ payload }) => payload);
  expect(launches.map((payload) => payload.workspaceStrategy.type)).toEqual([
    "worktree",
    "existing_worktree",
  ]);
  expect(launches.map((payload) => payload.attachments?.length)).toEqual([3, 3]);
  expect(launches.map((payload) => payload.message)).toEqual([
    expect.stringContaining("Fix the header shown in [Image 1: screenshot.png].\nKeep the footer."),
    expect.stringContaining("Fix the header shown in [Image 1: screenshot.png].\nKeep the footer."),
  ]);
  expect(originalImage).toMatchObject({ code: "IMAGE", data: screenshots.red.data });
});

it("simultaneous copies of a captured Flow use independent Condition counters and worker provenance", async (c) => {
  // Arrange
  const { f, input, agent, world } = await prepared(c);
  const leaf = await savedFlow(f, {
    name: "Scoped Condition",
    graph: {
      flowInput: flowInput("work"),
      blocks: [
        agentBlock("work", "Review", agent.id),
        conditionBlock("gate", "Gate", [conditionRule("second", "Second review", 2)], {
          x: 300,
          y: 0,
        }),
        humanStep("review", "Confirm review", { x: 600, y: 0 }),
      ],
      connections: [
        connection("work", "done", "gate"),
        connection("gate", "second", "review"),
        connection("gate", "otherwise", "review"),
        toEnding("review", "approve", "done"),
      ],
      finish: { position: { x: 800, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const graph = placingGraph(leaf.id, leaf.id);
  const parent = await savedFlow(f, {
    name: "Parallel copies",
    graph: {
      ...graph,
      flowInput: flowInput("inner-0", "inner-1"),
      connections: [toEnding("inner-0", "done", "done"), toEnding("inner-1", "done", "done")],
    },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [left, right],
  } = await launchedWorkers(world, started.id);

  // Act
  await resultReported(world, left!, { message: "Left review" });
  await resultReported(world, right!, { message: "Right review" });
  const run = await observeFor(
    "both review decisions waiting",
    world,
    started.id,
    (detail) =>
      detail.humanOccurrences.filter((occurrence) => occurrence.state === "pending").length === 2,
  );
  const [first, second] = run.conditions;
  const firstPage = assertOk(await f.listConditionArrivals(run.id, first!.blockId, "", ""));
  const secondPage = assertOk(await f.listConditionArrivals(run.id, second!.blockId, "", ""));

  // Assert
  expect(run.definitions.subflows?.map((flow) => flow.id)).toEqual([leaf.id]);
  expect(first?.blockId).not.toBe(second?.blockId);
  expect(firstPage.arrivals).toMatchObject([
    { arrivalNumber: 1, outputId: "otherwise", origin: { threadId: left!.threadId } },
  ]);
  expect(secondPage.arrivals).toMatchObject([
    { arrivalNumber: 1, outputId: "otherwise", origin: { threadId: right!.threadId } },
  ]);
  expect(
    run.attention.filter((matter) => matter.kind === "human").map((matter) => matter.invocationId),
  ).toEqual(
    expect.arrayContaining(run.subflows!.map((placement) => placement.defaultInvocation!.id)),
  );
});

it("pages a finished invocation's Condition after a newer invocation receives an arrival", async (c) => {
  // Arrange
  const { f, mcp, input, agent, world } = await preparedServer(c);
  const child = await savedFlow(f, {
    name: "Count two reviews",
    graph: {
      flowInput: flowInput("review-a", "review-b"),
      blocks: [
        agentBlock("review-a", "Review A", agent.id),
        agentBlock("review-b", "Review B", agent.id),
        conditionBlock("gate", "Review count", [conditionRule("complete", "Complete", 2)]),
        humanStep("hold", "Hold first review"),
      ],
      connections: [
        connection("review-a", "done", "gate"),
        connection("review-b", "done", "gate"),
        connection("gate", "otherwise", "hold"),
        toEnding("gate", "complete", "done"),
      ],
      finish: { position: { x: 800, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const base = placingGraph(child.id);
  const parent = await savedFlow(f, {
    name: "Serial reviews",
    graph: {
      ...base,
      flowInput: flowInput("first", "second"),
      finish: { ...base.finish!, endings: [] },
      blocks: [
        ...base.blocks,
        agentBlock("first", "First", agent.id),
        agentBlock("second", "Second", agent.id),
      ],
      connections: [
        connection("first", "done", "inner-0"),
        connection("second", "done", "inner-0"),
      ],
    },
  });
  const run = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const first = await blockWorkerLaunched(world, run.id, "first");
  const second = await blockWorkerLaunched(world, run.id, "second");
  await resultReported(world, first, { message: "First invocation" });
  const older = await observeFor(
    "observe the first invocation",
    world,
    run.id,
    (detail) => detail.subflows?.[0]?.defaultInvocation?.number === 1,
  );
  const oldGate = older.blocks.find((block) => block.templateBlockId === "gate")!.blockId;
  const oldReviewA = older.blocks.find((block) => block.templateBlockId === "review-a")!.blockId;
  const oldReviewB = older.blocks.find((block) => block.templateBlockId === "review-b")!.blockId;
  await resultReported(world, await blockWorkerLaunched(world, run.id, oldReviewA), {
    message: "Old first review",
  });
  await observeFor("number the first old arrival", world, run.id, (detail) =>
    detail.conditions.some((summary) => summary.blockId === oldGate && summary.arrivals === 1),
  );
  const oldSecond = await blockWorkerLaunched(world, run.id, oldReviewB);
  await resultReported(world, second, { message: "Second invocation" });
  await resultReported(world, oldSecond, { message: "Old second review" });
  const current = await observeFor(
    "advance the default to invocation two",
    world,
    run.id,
    (detail) => detail.subflows?.[0]?.defaultInvocation?.number === 2,
  );
  const newGate = current.blocks.find((block) => block.templateBlockId === "gate")!.blockId;
  const newReview = current.blocks.find((block) => block.templateBlockId === "review-a")!.blockId;
  const cached = assertOk(await f.listConditionArrivals(run.id, oldGate, "1", ""));
  await resultReported(world, await blockWorkerLaunched(world, run.id, newReview), {
    message: "New review",
  });
  await observeFor("number a live arrival in invocation two", world, run.id, (detail) =>
    detail.conditions.some((summary) => summary.blockId === newGate && summary.arrivals === 1),
  );
  const url = new URL(`/api/runs/${run.id}/conditions/${oldGate}/arrivals`, mcp);
  url.searchParams.set("limit", "1");
  url.searchParams.set("cursor", cached.nextCursor!);

  // Act
  const page = await fetch(url);

  // Assert
  expect(newGate).not.toBe(oldGate);
  expect(page.status).toBe(200);
  expect(await page.json()).toMatchObject({
    ok: true,
    value: {
      highWater: 2,
      nextCursor: null,
      arrivals: [
        { arrivalNumber: 2, outputId: "complete", origin: { threadId: oldSecond.threadId } },
      ],
    },
  });
});

it("advances a quiet invocation as Nothing returned without waking its parent recipient", async (c) => {
  // Arrange
  const { f, input, agent, world } = await prepared(c);
  const child = await savedFlow(f, {
    name: "Optional review",
    graph: {
      flowInput: flowInput("work"),
      blocks: [
        agentBlock(
          "work",
          "Work",
          agent.id,
          { x: 200, y: 0 },
          [],
          [blockExit("skip", "Skip", "Finish without a return")],
        ),
      ],
      connections: [toEnding("work", "done", "done")],
      finish: { position: { x: 400, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const parent = await savedFlow(f, { name: "Review", graph: placingGraph(child.id) });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [worker],
  } = await launchedWorkers(world, started.id);

  // Act
  await resultReported(world, worker!, { exit: "Skip" });
  const run = await observeFor(
    "quiet invocation",
    world,
    started.id,
    (detail) => detail.subflows?.[0]?.defaultInvocation?.state === "nothing-returned",
  );

  // Assert
  expect(run.result).toBeNull();
  expect(run.subflows?.[0]?.defaultInvocation).toMatchObject({
    ending: null,
    state: "nothing-returned",
  });
  expect(run.intents.filter((intent) => intent.targetEndingId === "done")).toEqual([]);
});

it("retains an accepted child ending with cancelled delivery when Archive cuts off its Stop", async (c) => {
  // Arrange
  const { f, t3, world, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [first, second],
  } = await launchedWorkers(world, started.id);
  await resultReported(world, first!, { message: "Reviewed" });
  await observeFor(
    "Stop acknowledged and still held",
    world,
    started.id,
    (run) => run.subflows?.[0]?.defaultInvocation?.stops[0]?.outcome === "acknowledged",
  );

  // Act
  const archived = assertOk(await f.archiveRun(started.id));
  await f.close();

  // Assert
  expect(archived.result).toBeNull();
  expect(archived.subflows?.[0]?.defaultInvocation).toMatchObject({
    state: "cancelled",
    ending: { endingId: "approved", output: "Reviewed", delivery: "cancelled", recipients: [] },
  });
  expect(t3.threads.threadStops.filter((stop) => stop.threadId === second!.threadId)).toHaveLength(
    1,
  );
});

it("an unresolved child Stop stays held until an authorized Retry verifies the worker", async (c) => {
  // Arrange
  const { f, t3, world, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [first, second],
  } = await launchedWorkers(world, started.id);
  t3.contract.support.stop = false;
  await resultReported(world, first!, { message: "Reviewed" });
  const unresolved = await observeFor("invocation Stop problem", world, started.id, (run) =>
    run.attention.some((matter) => matter.kind === "subflow-stop-unresolved"),
  );
  const invocation = unresolved.subflows?.[0]?.defaultInvocation;
  t3.contract.support.stop = true;
  t3.threads.stopsEndThreads();
  assertOk(await f.reconcileRuns());
  expect(t3.threads.threadStops).toEqual([]);

  // Act
  assertOk(await f.retrySubflowStop(started.id, invocation!.id));
  const finished = await observeFor(
    "return after authorized Retry",
    world,
    started.id,
    (run) => run.result?.endingId === "done",
  );

  // Assert
  expect(t3.threads.threadStops.map((stop) => stop.threadId)).toEqual([second!.threadId]);
  expect(
    unresolved.attention.filter((matter) => matter.kind === "subflow-stop-unresolved"),
  ).toMatchObject([{ invocationId: invocation!.id, settledAt: null }]);
  expect(finished.subflows?.[0]?.defaultInvocation).toMatchObject({
    state: "returned",
    ending: { delivery: "released" },
    stops: [{ attempt: 2, outcome: "acknowledged" }],
  });
});

it("refuses an over-budget shared diamond through public Start", async (c) => {
  // Arrange
  const { factory, first, diamond, t3 } = await composition(c);
  const root = (await diamond(9))[9]!;

  // Act
  const started = await factory.startRun({
    requestId: "diamond-budget",
    projectId: first.id,
    flowId: root.id,
    title: "Review",
    createdAt: "2026-11-07T08:00:00.000Z",
    input: "Review the change.",
  });

  // Assert
  expect(started).toMatchObject({
    ok: false,
    error: {
      issues: [
        expect.objectContaining({
          code: "subflow_expanded_blocks_exceeded",
          budget: expect.objectContaining({ total: "2557" }),
        }),
      ],
    },
  });
  expect(assertOk(await factory.listRunNavigation())).toEqual([]);
  expect(t3.threads.launches.size).toBe(0);
});

it("retains the standalone Start contract beyond the composition capture budget", async (c) => {
  // Arrange
  const { f, input, agent } = await prepared(c);
  const writers = await heavyWriters(f, "€".repeat(119_000));
  const downstream = writers.map((writer, i) => agentBlock("writer-" + i, writer.name, writer.id));
  const flow = await savedFlow(f, {
    name: "Standalone release",
    graph: {
      flowInput: flowInput("entry"),
      blocks: [agentBlock("entry", "Entry", agent.id), ...downstream],
      connections: downstream.map((block) => connection("entry", "done", block.id)),
    },
  });

  // Act
  const started = await f.startRun({ ...input, flowId: flow.id });

  // Assert
  const run = assertOk(started);
  expect(run.definitions.agents).toHaveLength(191);
  expect(
    run.definitions.agents.reduce(
      (bytes, captured) => bytes + Buffer.byteLength(captured.prompt),
      0,
    ),
  ).toBeGreaterThan(64 * 1024 * 1024);
});

it.for([
  {
    output: "none",
    message: "Secret draft from the reviewer",
    retained: null,
    outputMissing: false,
  },
  { output: "required", message: "", retained: "", outputMissing: true },
] as const)(
  "returns one empty arrival when the child ending output is $output",
  async ({ output, message, retained, outputMissing }, c) => {
    // Arrange
    const { f, input, agent, world } = await prepared(c);
    const child = await savedFlow(f, {
      name: "Output mode",
      graph: {
        flowInput: flowInput("work"),
        blocks: [agentBlock("work", "Review", agent.id)],
        connections: [toEnding("work", "done", "done")],
        finish: { position: { x: 500, y: 0 }, endings: [ending("done", "Done", output)] },
      },
    });
    const parent = await savedFlow(f, { name: "Complete", graph: placingGraph(child.id) });
    const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
    const {
      workers: [worker],
    } = await launchedWorkers(world, started.id);

    // Act
    await resultReported(world, worker!, { message });
    const run = await observeFor(
      "parent receives empty output",
      world,
      started.id,
      (detail) => detail.result !== null,
    );

    // Assert
    expect(run.result).toMatchObject({ output: "", outputMissing: false });
    expect(run.subflows?.[0]?.defaultInvocation?.ending).toMatchObject({
      output: retained,
      outputMissing,
      recipients: [{ targetEndingId: "done", disposition: "acknowledged" }],
    });
    expect(run.attention.filter((matter) => !matter.settledAt)).toEqual([]);
  },
);

it("holds an invocation over an uncertain Continuation send and recovers its original key after restart", async (c) => {
  // Arrange
  const { f, h, t3, input, agent, world } = await prepared(c);
  const child = await savedFlow(f, {
    name: "Continued review",
    graph: {
      flowInput: flowInput("work"),
      blocks: [
        agentBlock("work", "Review", agent.id),
        continuationStep("spec", "Summarize", "Summarize the review.", { x: 300, y: 0 }),
      ],
      connections: [connection("work", "done", "spec"), toEnding("spec", "output", "done")],
      finish: { position: { x: 500, y: 0 }, endings: [ending("done", "Done")] },
    },
  });
  const parent = await savedFlow(f, { name: "Complete", graph: placingGraph(child.id) });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [worker],
  } = await launchedWorkers(world, started.id);
  t3.threads.loseSendReply = true;
  await resultReported(world, worker!, { message: "Reviewed." });
  const held = await observeFor("Continuation send is uncertain", world, started.id, (run) =>
    run.intents.some((intent) => intent.kind === "send" && intent.state === "uncertain"),
  );
  const pending = held.intents.find((intent) => intent.kind === "send")!;
  await f.close();
  t3.threads.loseSendReply = false;

  // Act
  const reopened = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  expect(held.subflows?.[0]?.defaultInvocation).toMatchObject({ state: "active", ending: null });
  const restored = assertOk(await reopened.getRun(started.id));
  expect(restored.intents).toContainEqual(
    expect.objectContaining({
      id: pending.id,
      requestKey: pending.requestKey,
      kind: "send",
      state: "acknowledged",
    }),
  );
  expect([...t3.threads.sends.keys()]).toEqual([pending.requestKey]);
});

it("keeps the accepted child ending held while another worker's launch is unbound", async (c) => {
  // Arrange
  const { f, t3, world, input, agent } = await prepared(c);
  const child = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(child.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  t3.threads.discoverAvailable = false;
  t3.threads.beforeLaunch = async (payload) => {
    t3.threads.loseLaunchReply = payload.title.includes("Style reviewer");
  };
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const security = started.subflows![0]!.defaultInvocation!.blocks.find(
    (block) => block.templateBlockId === "security",
  )!;
  const worker = await blockWorkerLaunched(world, started.id, security.blockId);

  // Act
  await resultReported(world, worker, { message: "Reviewed." });
  const closing = await observeFor("scope waits for unbound launch", world, started.id, (run) =>
    run.attention.some((matter) => matter.kind === "subflow-stop-unresolved"),
  );

  // Assert
  expect(closing.result).toBeNull();
  expect(closing.subflows?.[0]?.defaultInvocation).toMatchObject({
    state: "stopping",
    ending: { output: "Reviewed.", delivery: "held" },
  });
  expect(closing.intents.filter((intent) => intent.state === "uncertain")).toHaveLength(1);
  expect(t3.threads.launchCalls).toBe(2);
  expect(t3.threads.threadStops).toEqual([]);
});

it("reads an exact inner invocation with its ancestor placement through HTTP", async (c) => {
  // Arrange
  const { f, mcp, world, input, agent } = await preparedServer(c);
  const leaf = await savedFlow(f, { name: "Review", graph: reviewPanelGraph(agent.id) });
  const group = await savedFlow(f, {
    name: "Panel",
    graph: { ...placingGraph(leaf.id), connections: [toEnding("inner-0", "approved", "done")] },
  });
  const parent = await savedFlow(f, {
    name: "Release",
    graph: { ...placingGraph(group.id), connections: [toEnding("inner-0", "done", "done")] },
  });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const run = await observeFor(
    "both levels have an invocation",
    world,
    started.id,
    (detail) => detail.subflows?.filter((placement) => placement.defaultInvocation).length === 2,
  );
  const ancestor = run.subflows![0]!.defaultInvocation!;
  const invocation = run.subflows![1]!.defaultInvocation!;

  // Act
  const response = await fetch(new URL(`/api/runs/${run.id}/invocations/${invocation.id}`, mcp));

  // Assert
  expect(await response.json()).toMatchObject({
    ok: true,
    value: {
      ancestors: [{ id: ancestor.id, placementBlockId: "inner-0" }],
      invocation: { id: invocation.id, placementBlockId: invocation.placementBlockId },
      placements: [],
    },
  });
});
