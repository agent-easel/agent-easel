import { assert, expect, it } from "@effect/vitest";
import { JOIN_TIMELINE_ROUNDS, type RunDetail } from "@t3-factory/contracts";
import { assertOk } from "./support/domain-setup.ts";
import {
  capturedJoinEndingMissing,
  foreignJoinQueue,
  joinRoundAtMaximum,
  joinRoundsForwarded,
  joinStorageInterrupted,
  queuedJoinMessageAltered,
  queuedJoinMessageLost,
} from "./support/join-storage.ts";
import { prepared } from "./support/prepared-runner.ts";
import {
  agentBlock,
  allTurnsEnd,
  blockExit,
  connection,
  finishedReport,
  flowInput,
  humanStep,
  joinedEndingFlow,
  workerAtWork,
  joinBesideEndingFlow,
  joinBlock,
  launchedWorkers,
  observeFor,
  parallelJoinFlow,
  report,
  resultHeld,
  resultReported,
  skippedSourceJoinFlow,
  turnBegins,
  twoWorkersStarted,
  workerHandle,
  type ScenarioWorld,
  type WorkerHandle,
} from "./support/scenarios.ts";
import { ending, placingGraph, savedFlow, subflowBlock, toEnding } from "./support/subflow.ts";

const merge = (run: RunDetail) => run.joins.find((join) => join.blockId === "merge");
const roundEvents = (run: RunDetail) =>
  run.events
    .filter((event) => event.kind.startsWith("join-round-"))
    .map((event) => ({ kind: event.kind, blockId: event.blockId, round: event.join?.round }));
const mergeIntents = (run: RunDetail) => run.intents.filter((intent) => intent.blockId === "merge");

async function partialWithFinishedWorkers(c: Parameters<typeof prepared>[0], message = "A1") {
  const f = await prepared(c, skippedSourceJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message });
  await resultReported(f.world, second, { exit: "Skip" });
  const run = await observeFor(
    "partial round with every worker finished",
    f.world,
    first.runId,
    (detail) =>
      merge(detail)?.arrived === 1 &&
      detail.blocks.filter((block) => block.threadId).every((block) => block.state === "finished"),
  );
  return { f, first, second, run };
}

it("a partial round shows Waiting with arrived and pending sources in Run reads and MCP reads and raises no attention", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);

  await resultReported(f.world, first, { message: "A1" });
  const waiting = await observeFor("one source arrived", f.world, first.runId, (run) =>
    run.blocks.some((block) => block.blockId === "merge" && block.state === "waiting"),
  );
  const revised = turnBegins(f.world, first, "another-review");

  // Act
  await resultReported(f.world, revised, { message: "A2", exit: "Revise" });
  const queued = await observeFor(
    "extra arrival queued",
    f.world,
    first.runId,
    (run) =>
      mergeIntents(run).every((intent) => intent.state === "acknowledged") &&
      mergeIntents(run).length === 2,
  );

  // Assert
  expect(merge(waiting)).toEqual({
    blockId: "merge",
    round: 1,
    sources: 2,
    arrived: 1,
    queued: 0,
    latest: null,
  });
  expect(merge(queued)).toMatchObject({ round: 1, sources: 2, arrived: 1, queued: 1 });
  expect(queued.attention).toEqual([]);
  expect(queued.lifecycle).toBe("active");
  expect(roundEvents(queued)).toEqual([]);
  const detail = assertOk(await f.f.getRunJoin(first.runId, "merge"));
  expect(detail).toEqual({
    blockId: "merge",
    round: 1,
    sources: [
      {
        sourceBlockId: "worker",
        name: "Entry worker",
        arrived: { exitId: "done", exitName: "Done", arrivedAt: expect.any(String) },
        queued: 1,
        extras: [{ exitId: "revise", exitName: "Revise", arrivedAt: expect.any(String) }],
        latestArrival: null,
      },
      {
        sourceBlockId: "second",
        name: "Second entry",
        arrived: null,
        queued: 0,
        extras: [],
        latestArrival: null,
      },
    ],
    latest: null,
  });
  expect(await f.f.runtime.run({ arguments: { blockId: second.blockId } })).toMatchObject({
    code: "RUN",
    joins: queued.joins,
  });
  expect(
    await f.f.runtime.join({ arguments: { blockId: second.blockId, joinBlockId: "merge" } }),
  ).toEqual({ code: "JOIN", join: detail });
  expect(
    await f.f.runtime.join({ arguments: { blockId: second.blockId, joinBlockId: "worker" } }),
  ).toMatchObject({ code: "UNKNOWN_JOIN" });
});

it("a partial round holds automatic settlement while every worker is finished", async (c) => {
  // Arrange
  const { f, first } = await partialWithFinishedWorkers(c);

  // Act
  assertOk(await f.f.reconcileRuns());

  // Assert
  const run = assertOk(await f.f.getRun(first.runId));
  expect(run.lifecycle).toBe("active");
  expect(merge(run)).toMatchObject({ arrived: 1, sources: 2, latest: null });
  expect(run.blocks.find((block) => block.blockId === "merge")?.state).toBe("waiting");
  expect(run.attention).toEqual([]);
  expect(run.settlement).toBeNull();
});

it("Settle cancels a partial round without forwarding it", async (c) => {
  // Arrange
  const { f, first } = await partialWithFinishedWorkers(c);

  // Act
  const settled = await f.f.settleRun(first.runId, {});

  // Assert
  assert(settled.ok, JSON.stringify(settled));
  const run = assertOk(await f.f.getRun(first.runId));
  expect(run.lifecycle).toBe("settled");
  expect(merge(run)).toMatchObject({
    arrived: 0,
    queued: 0,
    latest: { round: 1, outcome: "cancelled", at: expect.any(String) },
  });
  expect(roundEvents(run)).toEqual([{ kind: "join-round-cancelled", blockId: "merge", round: 1 }]);
  expect(run.blocks.find((block) => block.blockId === "merge")?.state).toBe("stopped");
  expect(mergeIntents(run)).toMatchObject([{ state: "acknowledged", payloadRetained: false }]);
  expect(run.humanOccurrences).toEqual([]);
  expect(
    assertOk(await f.f.getRunJoin(first.runId, "merge")).sources.map((source) => [
      source.arrived,
      source.latestArrival?.exitName ?? null,
    ]),
  ).toEqual([
    [null, "Done"],
    [null, null],
  ]);
});

it("a late result leaves the cancelled round unchanged", async (c) => {
  // Arrange
  const { f, first, second } = await partialWithFinishedWorkers(c);
  assertOk(await f.f.settleRun(first.runId, {}));
  const run = assertOk(await f.f.getRun(first.runId));

  // Act
  const late = await report(f.world, second, finishedReport("Late."));

  // Assert
  expect(late).toBe("RUN_SETTLED");
  expect(assertOk(await f.f.getRun(first.runId)).events).toEqual(run.events);
});

it("Archive cancels a partial round, keeps the forwarded round as history and clears its message", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await resultReported(f.world, second, { message: "B1" });
  const forwarded = await observeFor("round 1 delivered", f.world, first.runId, (run) =>
    run.blocks.some((block) => block.blockId === "follow-up" && block.threadId !== null),
  );
  const recipient = workerHandle(f.world, forwarded, "follow-up");
  expect(await f.f.runtime.block({ arguments: { blockId: recipient.blockId } })).toMatchObject({
    reason: "Join",
    inputs: { feedback: expect.stringMatching(/^Join round 1/) },
  });
  const latestExits = async () =>
    assertOk(await f.f.getRunJoin(first.runId, "merge")).sources.map(
      (source) => source.latestArrival?.exitName ?? null,
    );
  expect(await latestExits()).toEqual(["Done", "Done"]);
  const revised = turnBegins(f.world, first, "another-review");
  await resultReported(f.world, revised, { message: "A2", exit: "Revise" });
  await observeFor("round 2 partial", f.world, first.runId, (run) => merge(run)?.arrived === 1);

  // Act
  const archived = assertOk(await f.f.archiveRun(first.runId));

  // Assert
  expect(merge(archived)).toMatchObject({
    round: 3,
    arrived: 0,
    latest: { round: 2, outcome: "cancelled" },
  });
  expect(roundEvents(archived)).toEqual([
    { kind: "join-round-forwarded", blockId: "merge", round: 1 },
    { kind: "join-round-cancelled", blockId: "merge", round: 2 },
  ]);
  expect(assertOk(await f.f.getRunJoin(first.runId, "merge")).round).toBe(3);
  expect(await latestExits()).toEqual(["Revise", null]);
  expect(mergeIntents(archived).every((intent) => !intent.payloadRetained)).toBe(true);
  expect(await f.f.runtime.block({ arguments: { blockId: recipient.blockId } })).toMatchObject({
    reason: "Join",
    inputs: { feedback: null },
  });
});

it("Finish cancels a partial round without forwarding it", async (c) => {
  // Arrange
  const f = await prepared(c, joinBesideEndingFlow);
  const started = assertOk(await f.f.startRun(f.input));
  const { run: launched } = await launchedWorkers(f.world, started.id);
  const worker = workerHandle(f.world, launched, "worker");
  const third = workerHandle(f.world, launched, "third");
  await resultReported(f.world, worker, { message: "A1" });
  await observeFor("one source arrived", f.world, started.id, (run) => merge(run)?.arrived === 1);
  f.t3.threads.stopsEndThreads();

  // Act
  await resultReported(f.world, third, { message: "Delivered." });
  const run = await observeFor(
    "ending reached",
    f.world,
    started.id,
    (detail) => detail.result !== null && detail.lifecycle === "settled",
  );

  // Assert
  expect(run.result).toMatchObject({ endingId: "delivered" });
  expect(merge(run)).toMatchObject({ arrived: 0, latest: { round: 1, outcome: "cancelled" } });
  expect(roundEvents(run)).toEqual([{ kind: "join-round-cancelled", blockId: "merge", round: 1 }]);
  expect(run.humanOccurrences).toEqual([]);
});

it("a cutoff that closes the gate before the last arrival is accepted forwards nothing", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await observeFor("one source arrived", f.world, first.runId, (run) => merge(run)?.arrived === 1);
  await resultHeld(f.world, second, { message: "B1" });
  assertOk(await f.f.settleRun(first.runId, { stopWorkers: true }));
  allTurnsEnd(f.world, second, "interrupted");
  allTurnsEnd(f.world, first, "interrupted");

  // Act
  assertOk(await f.f.reconcileRuns());

  // Assert
  const run = assertOk(await f.f.getRun(first.runId));
  expect(run.lifecycle).toBe("settled");
  expect(merge(run)).toMatchObject({ arrived: 0, latest: { round: 1, outcome: "cancelled" } });
  expect(roundEvents(run)).toEqual([{ kind: "join-round-cancelled", blockId: "merge", round: 1 }]);
  expect(run.humanOccurrences).toEqual([]);
  expect(mergeIntents(run).map((intent) => intent.state)).toEqual(["acknowledged", "cancelled"]);
});

it("a cutoff after the last arrival completed its round keeps the round and cancels its unsent deliveries", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await resultReported(f.world, second, { message: "B1" });
  await observeFor("round 1 forwarded", f.world, first.runId, (run) => merge(run)?.latest !== null);
  f.t3.contract.support.launch = false;

  // Act
  const archived = assertOk(await f.f.archiveRun(first.runId));

  // Assert
  expect(merge(archived)).toMatchObject({ arrived: 0, latest: { round: 1, outcome: "forwarded" } });
  expect(roundEvents(archived)).toEqual([
    { kind: "join-round-forwarded", blockId: "merge", round: 1 },
  ]);
  expect(
    archived.intents
      .filter((intent) => intent.sourceBlockId === "merge")
      .every((intent) => intent.state === "cancelled" || intent.state === "acknowledged"),
  ).toBe(true);
});

it("a cutoff racing the last arrival leaves one outcome and no pending arrival", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await observeFor("one source arrived", f.world, first.runId, (run) => merge(run)?.arrived === 1);
  await resultReported(f.world, second, { message: "B1" });
  f.t3.contract.support.launch = false;

  // Act
  const [archived] = await Promise.all([f.f.archiveRun(first.runId), f.f.reconcileRuns()]);

  // Assert
  assert(archived.ok, JSON.stringify(archived));
  const run = assertOk(await f.f.getRun(first.runId));
  const outcomes = roundEvents(run);
  expect(outcomes).toHaveLength(1);
  expect(merge(run)).toMatchObject({ arrived: 0, queued: 0 });
  expect(`join-round-${merge(run)?.latest?.outcome}`).toBe(outcomes[0]?.kind);
  expect(
    run.intents.filter((intent) => intent.state === "pending" || intent.state === "reserved"),
  ).toEqual([]);
});

async function joinedChild(f: Awaited<ReturnType<typeof prepared>>["f"], agentId: string) {
  return savedFlow(f, {
    name: "Joined review",
    graph: {
      flowInput: flowInput("a", "b"),
      blocks: [
        agentBlock("a", "Reviewer A", agentId, { x: 200, y: 0 }),
        agentBlock(
          "b",
          "Reviewer B",
          agentId,
          { x: 200, y: 200 },
          [],
          [blockExit("skip", "Skip", "Finish without arriving")],
        ),
        joinBlock("merge", "Merge", { x: 500, y: 100 }),
        humanStep("review", "Confirm", { x: 800, y: 100 }),
      ],
      connections: [
        connection("a", "done", "merge"),
        connection("b", "done", "merge"),
        connection("merge", "output", "review"),
        toEnding("review", "approve", "done"),
      ],
      finish: { position: { x: 1000, y: 100 }, endings: [ending("done", "Done")] },
    },
  });
}

it("a partial round inside a Subflow keeps its invocation open until Settle cancels it", async (c) => {
  // Arrange
  const { f, input, agent, world } = await prepared(c);
  const child = await joinedChild(f, agent.id);
  const parent = await savedFlow(f, { name: "Review", graph: placingGraph(child.id) });
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const {
    workers: [a, b],
  } = await launchedWorkers(world, started.id);
  await resultReported(world, a!, { message: "A1" });
  await resultReported(world, b!, { exit: "Skip" });

  const open = await observeFor("partial round in the invocation", world, started.id, (run) =>
    run.joins.some((join) => join.arrived === 1),
  );
  assertOk(await f.reconcileRuns());
  const still = assertOk(await f.getRun(started.id));

  // Act
  assertOk(await f.settleRun(started.id, {}));
  const settled = assertOk(await f.getRun(started.id));

  // Assert
  const [join] = open.joins;
  expect(still.subflows?.[0]?.defaultInvocation?.state).toBe("active");
  expect(still.lifecycle).toBe("active");
  expect(join).toMatchObject({ sources: 2, arrived: 1, latest: null });
  expect(join?.blockId).not.toBe("merge");
  expect(settled.joins[0]).toMatchObject({
    arrived: 0,
    latest: { round: 1, outcome: "cancelled" },
  });
  expect(roundEvents(settled)).toEqual([
    { kind: "join-round-cancelled", blockId: join!.blockId, round: 1 },
  ]);
});

async function parallelJoinedCopies(f: Awaited<ReturnType<typeof prepared>>["f"], agentId: string) {
  const child = await savedFlow(f, {
    name: "Joined review with ending",
    graph: {
      flowInput: flowInput("a", "b", "c"),
      blocks: [
        agentBlock("a", "Reviewer A", agentId, { x: 200, y: 0 }),
        agentBlock("b", "Reviewer B", agentId, { x: 200, y: 200 }),
        agentBlock("c", "Reviewer C", agentId, { x: 200, y: 400 }),
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
  return savedFlow(f, {
    name: "Parallel joined copies",
    graph: {
      flowInput: flowInput("inner-0", "inner-1"),
      blocks: [
        subflowBlock("inner-0", "Inner 0", child.id, { x: 0, y: 0 }),
        subflowBlock("inner-1", "Inner 1", child.id, { x: 0, y: 300 }),
        humanStep("parent-review", "Parent review", { x: 400, y: 150 }),
      ],
      connections: [
        connection("inner-0", "done", "parent-review"),
        connection("inner-1", "done", "parent-review"),
        toEnding("parent-review", "approve", "done"),
      ],
      finish: { position: { x: 700, y: 150 }, endings: [ending("done", "Done")] },
    },
  });
}

function copyWorkers(run: RunDetail, workers: readonly WorkerHandle[]) {
  const byCopy = new Map<string, Map<string, WorkerHandle>>();
  for (const worker of workers) {
    const block = run.blocks.find((entry) => entry.blockId === worker.flowBlockId)!;
    const copy = byCopy.get(block.invocationId!) ?? new Map<string, WorkerHandle>();
    copy.set(block.templateBlockId!, worker);
    byCopy.set(block.invocationId!, copy);
  }
  const [left, right] = [...byCopy.values()];
  return { left: left!, right: right! };
}

it("simultaneous invocations keep separate rounds, arrivals and numbers", async (c) => {
  // Arrange
  const { f, input, agent, world } = await prepared(c);
  const parent = await parallelJoinedCopies(f, agent.id);
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const { run: launched, workers } = await launchedWorkers(world, started.id);
  const { left, right } = copyWorkers(launched, workers);

  await resultReported(world, left.get("a")!, { message: "Left A" });
  await resultReported(world, right.get("b")!, { message: "Right B" });
  const apart = await observeFor(
    "one arrival in each copy",
    world,
    started.id,
    (run) => run.joins.length === 2 && run.joins.every((join) => join.arrived === 1),
  );

  // Act
  await resultReported(world, left.get("b")!, { message: "Left B" });
  const together = await observeFor("the left copy forwarded", world, started.id, (run) =>
    run.humanOccurrences.some((occurrence) => occurrence.context?.startsWith("Join round 1")),
  );

  // Assert
  expect(new Set(apart.joins.map((join) => join.blockId)).size).toBe(2);
  const forwarded = together.joins.filter((join) => join.latest?.outcome === "forwarded");
  const waiting = together.joins.filter((join) => join.latest === null);
  expect(forwarded).toMatchObject([{ round: 2, arrived: 0, latest: { round: 1 } }]);
  expect(waiting).toMatchObject([{ round: 1, arrived: 1 }]);
  const waitingDetail = assertOk(await f.getRunJoin(started.id, waiting[0]!.blockId));
  expect(waitingDetail.sources.map((source) => source.arrived?.exitName ?? null)).toEqual([
    null,
    "Done",
  ]);
  expect(
    together.humanOccurrences.filter((occurrence) => occurrence.context?.startsWith("Join round")),
  ).toHaveLength(1);
  expect(
    together.humanOccurrences.find((o) => o.context?.startsWith("Join round 1"))?.context,
  ).toMatch(/Left A[\s\S]*Left B/);
});

it("an inner Finish cancels only its own invocation's partial round", async (c) => {
  // Arrange
  const { f, input, agent, world, t3 } = await prepared(c);
  const parent = await parallelJoinedCopies(f, agent.id);
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const { run: launched, workers } = await launchedWorkers(world, started.id);
  const { left, right } = copyWorkers(launched, workers);
  await resultReported(world, left.get("a")!, { message: "Left A" });
  await resultReported(world, right.get("b")!, { message: "Right B" });
  await resultReported(world, right.get("a")!, { message: "Right A" });
  await observeFor(
    "right copy forwarded, left partial",
    world,
    started.id,
    (run) =>
      run.joins.some((join) => join.latest?.outcome === "forwarded") &&
      run.joins.some((join) => join.arrived === 1),
  );
  const before = assertOk(await f.getRun(started.id));
  const leftJoin = before.joins.find((join) => join.arrived === 1)!;
  const rightJoin = before.joins.find((join) => join.latest?.outcome === "forwarded")!;
  t3.threads.stopsEndThreads();

  // Act
  await resultReported(world, left.get("c")!, { message: "Left C finishes the copy." });
  allTurnsEnd(world, left.get("b")!, "interrupted");
  const after = await observeFor("the left copy returned", world, started.id, (run) =>
    run.joins.some((join) => join.blockId === leftJoin.blockId && join.latest !== null),
  );

  // Assert
  expect(after.joins.find((join) => join.blockId === leftJoin.blockId)).toMatchObject({
    arrived: 0,
    latest: { round: 1, outcome: "cancelled" },
  });
  expect(after.joins.find((join) => join.blockId === rightJoin.blockId)).toEqual(rightJoin);
  expect(roundEvents(after)).toEqual(
    expect.arrayContaining([
      { kind: "join-round-forwarded", blockId: rightJoin.blockId, round: 1 },
      { kind: "join-round-cancelled", blockId: leftJoin.blockId, round: 1 },
    ]),
  );
  expect(roundEvents(after).filter((event) => event.kind === "join-round-cancelled")).toHaveLength(
    1,
  );
  expect(after.lifecycle).toBe("active");
});

const latched = (world: ScenarioWorld, runId: string) =>
  observeFor("the Join integrity Problem", world, runId, (run) =>
    run.attention.some((matter) => matter.kind === "join-integrity"),
  );

function expectLatched(run: RunDetail, refused: number) {
  expect(run.attention.filter((matter) => matter.kind === "join-integrity")).toMatchObject([
    { blockId: "merge", settledAt: null, message: expect.any(String) },
  ]);
  expect(run.humanOccurrences).toEqual([]);
  expect(merge(run)?.latest).toBeNull();
  expect(mergeIntents(run).filter((intent) => intent.state === "pending")).toHaveLength(refused);
  expect(mergeIntents(run).filter((intent) => intent.state === "pending")[0]?.payloadRetained).toBe(
    true,
  );
}

it("a lost queued message latches join-integrity before the round is consumed", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await observeFor("one source arrived", f.world, first.runId, (run) => merge(run)?.arrived === 1);
  queuedJoinMessageLost(f.h.databasePath);

  // Act
  await resultReported(f.world, second, { message: "B1" });
  const run = await latched(f.world, first.runId);

  // Assert
  expect(merge(run)).toMatchObject({ arrived: 1, queued: 0 });
  expectLatched(run, 1);
});

it("an altered queued message latches join-integrity even though the round is incomplete", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await observeFor("one source arrived", f.world, first.runId, (run) => merge(run)?.arrived === 1);
  queuedJoinMessageAltered(f.h.databasePath);
  const revised = turnBegins(f.world, first, "another-review");

  // Act
  await resultReported(f.world, revised, { message: "A2", exit: "Revise" });
  const run = await latched(f.world, first.runId);

  // Assert
  expect(second.runId).toBe(run.id);
  expect(merge(run)).toMatchObject({ arrived: 1, queued: 0 });
  expectLatched(run, 1);
});

it("a captured Join whose output lost its wires latches join-integrity at its first delivery", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first] = await twoWorkersStarted(f.world, f.input);
  await f.reopenWithCapturedOutputUnwired("merge", "output");

  // Act
  await resultReported(f.world, first, { message: "A1" });
  const run = await latched(f.world, first.runId);

  // Assert
  expect(merge(run)).toMatchObject({ arrived: 0 });
  expectLatched(run, 1);
});

async function overflowQueue(c: Parameters<typeof prepared>[0]) {
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "Existing queued message" });
  await observeFor("source queued", f.world, first.runId, (r) => merge(r)?.arrived === 1);
  joinRoundsForwarded(f.h.databasePath, first.runId, "merge", 1);
  joinRoundAtMaximum(f.h.databasePath);
  await resultReported(f.world, second, { message: "Final source" });
  await latched(f.world, first.runId);
  return { f, runId: first.runId };
}

function expectOverflowCleared(run: RunDetail) {
  expect(merge(run)).toMatchObject({
    arrived: 0,
    latest: { round: Number.MAX_SAFE_INTEGER, outcome: "forwarded" },
  });
  expect(roundEvents(run)).toEqual([
    { kind: "join-round-forwarded", blockId: "merge", round: Number.MAX_SAFE_INTEGER },
  ]);
  expect(run.attention.filter((matter) => matter.kind === "join-integrity")).toMatchObject([
    { settledAt: expect.any(String) },
  ]);
}

it("Archive clears an existing overflow queue and preserves the last valid round", async (c) => {
  // Arrange
  const { f, runId } = await overflowQueue(c);

  // Act
  const result = await f.f.archiveRun(runId);

  // Assert
  assertOk(result);
  expectOverflowCleared(assertOk(await f.f.getRun(runId)));
});

it("Settle clears an existing overflow queue and preserves the last valid round", async (c) => {
  // Arrange
  const { f, runId } = await overflowQueue(c);
  f.t3.threads.stopsEndThreads();

  // Act
  const result = await f.f.settleRun(runId, { stopWorkers: true });

  // Assert
  assertOk(result);
  expectOverflowCleared(
    await observeFor(
      "completed manual settlement",
      f.world,
      runId,
      (r) => r.lifecycle === "settled",
    ),
  );
});

it("a latched Join holds every later delivery unaccepted", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first] = await twoWorkersStarted(f.world, f.input);
  await f.reopenWithCapturedOutputUnwired("merge", "output");
  await resultReported(f.world, first, { message: "A1" });
  await latched(f.world, first.runId);
  const revised = turnBegins(f.world, first, "another-review");

  // Act
  await resultReported(f.world, revised, { message: "A2", exit: "Revise" });
  await observeFor(
    "second delivery released",
    f.world,
    first.runId,
    (run) => mergeIntents(run).length === 2,
  );
  assertOk(await f.f.reconcileRuns());

  // Assert
  const run = assertOk(await f.f.getRun(first.runId));
  expect(mergeIntents(run).map((intent) => intent.state)).toEqual(["pending", "pending"]);
  expect(merge(run)).toMatchObject({ arrived: 0 });
  expect(run.attention.filter((matter) => matter.kind === "join-integrity")).toHaveLength(1);
});

it("a storage failure while accepting an arrival records no arrival and no Problem; the next pass accepts it", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first] = await twoWorkersStarted(f.world, f.input);
  const restore = joinStorageInterrupted(f.h.databasePath);
  await resultReported(f.world, first, { message: "Retry me." });
  const failed = await observeFor("observe the release", f.world, first.runId, (run) =>
    run.events.some((event) => event.kind === "handoff-released"),
  );
  restore();

  // Act
  const run = await observeFor(
    "arrival accepted",
    f.world,
    first.runId,
    (detail) => merge(detail)?.arrived === 1,
  );

  // Assert
  expect(merge(failed)).toMatchObject({ arrived: 0 });
  expect(mergeIntents(failed)).toMatchObject([{ state: "pending" }]);
  expect(failed.attention).toEqual([]);
  expect(mergeIntents(run)).toMatchObject([{ state: "acknowledged", problem: null }]);
  expect(run.attention).toEqual([]);
});

it("a Run keeps only each Join's latest rounds on the timeline while the summary counts on", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first] = await twoWorkersStarted(f.world, f.input);
  joinRoundsForwarded(f.h.databasePath, first.runId, "merge", JOIN_TIMELINE_ROUNDS + 10);

  // Act
  const run = assertOk(await f.f.getRun(first.runId));

  // Assert
  const rounds = roundEvents(run).map((event) => event.round);
  expect(rounds).toHaveLength(JOIN_TIMELINE_ROUNDS);
  expect(rounds[0]).toBe(11);
  expect(rounds.at(-1)).toBe(JOIN_TIMELINE_ROUNDS + 10);
  expect(merge(run)).toMatchObject({
    round: JOIN_TIMELINE_ROUNDS + 11,
    latest: { round: JOIN_TIMELINE_ROUNDS + 10, outcome: "forwarded" },
  });
});

it("a missing captured ending latches before the first Join arrival", async (c) => {
  // Arrange
  const f = await prepared(c, joinedEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  capturedJoinEndingMissing(f.h.databasePath);
  await f.reopen();

  // Act
  await resultReported(f.world, worker);

  // Assert
  const run = await latched(f.world, worker.runId);
  expect(merge(run)).toMatchObject({ arrived: 0, latest: null });
  expect(mergeIntents(run)).toMatchObject([{ state: "pending", payloadRetained: true }]);
});

async function foreignQueue(c: Parameters<typeof prepared>[0]) {
  const f = await prepared(c, parallelJoinFlow);
  const [, second] = await twoWorkersStarted(f.world, f.input);
  const [other] = await twoWorkersStarted(f.world, { ...f.input, requestId: "other-run" });
  await resultReported(f.world, other, { message: "Other review" });
  await observeFor("other queued", f.world, other.runId, (r) => merge(r)?.arrived === 1);
  foreignJoinQueue(f.h.databasePath, second.runId, other.runId);
  return { f, second, other };
}

it("release holds a queue referencing another Run's acknowledged Handoff", async (c) => {
  // Arrange
  const { f, second, other } = await foreignQueue(c);

  // Act
  await resultReported(f.world, second, { message: "Second review" });

  // Assert
  const run = await latched(f.world, second.runId);
  expect(merge(run)?.latest).toBeNull();
  expect(run.humanOccurrences).toEqual([]);
  expect(mergeIntents(assertOk(await f.f.getRun(other.runId)))).toMatchObject([
    { payloadRetained: true },
  ]);
});

it("cancelling a queue preserves a referenced payload belonging to another Run", async (c) => {
  // Arrange
  const { f, second, other } = await foreignQueue(c);

  // Act
  const archived = await f.f.archiveRun(second.runId);

  // Assert
  expect(merge(assertOk(archived))).toMatchObject({ arrived: 0, latest: { outcome: "cancelled" } });
  expect(mergeIntents(assertOk(await f.f.getRun(other.runId)))).toMatchObject([
    { payloadRetained: true },
  ]);
});

it("Finish preserves the Join integrity Problem when another branch completes", async (c) => {
  // Arrange
  const f = await prepared(c, joinBesideEndingFlow);
  const started = assertOk(await f.f.startRun(f.input));
  const { run } = await launchedWorkers(f.world, started.id);
  const worker = workerHandle(f.world, run, "worker");
  const third = workerHandle(f.world, run, "third");
  await f.reopenWithCapturedOutputUnwired("merge", "output");
  await resultReported(f.world, worker);
  await latched(f.world, started.id);
  f.t3.threads.stopsEndThreads();

  // Act
  await resultReported(f.world, third);

  // Assert
  const ended = await observeFor(
    "Finish settled",
    f.world,
    started.id,
    (r) => r.lifecycle === "settled",
  );
  expect(ended.attention.filter((m) => m.kind === "join-integrity")).toMatchObject([
    { settledAt: null },
  ]);
});

it("an inner Finish preserves its Join integrity Problem", async (c) => {
  // Arrange
  const { f, input, agent, world, t3, h } = await prepared(c);
  const parent = await parallelJoinedCopies(f, agent.id);
  const started = assertOk(await f.startRun({ ...input, flowId: parent.id }));
  const { run, workers } = await launchedWorkers(world, started.id);
  const { left } = copyWorkers(run, workers);
  await resultReported(world, left.get("a")!);
  await observeFor("queued", world, started.id, (r) => r.joins.some((j) => j.arrived === 1));
  queuedJoinMessageLost(h.databasePath);
  await resultReported(world, left.get("b")!);
  const problem = (await latched(world, started.id)).attention.find(
    (m) => m.kind === "join-integrity",
  )!;
  t3.threads.stopsEndThreads();

  // Act
  await resultReported(world, left.get("c")!);

  // Assert
  const ended = await observeFor("inner cutoff", world, started.id, (r) =>
    r.joins.some((j) => j.latest?.outcome === "cancelled"),
  );
  expect(ended.attention.find((m) => m.id === problem.id)?.settledAt).toBeNull();
  const invocation = run.blocks.find((b) => b.blockId === problem.blockId)!.invocationId!;
  const path = assertOk(await f.getSubflowInvocation(started.id, invocation));
  expect(path.joins).toContainEqual(
    expect.objectContaining({
      blockId: problem.blockId,
      round: 2,
      latest: expect.objectContaining({ outcome: "cancelled" }),
    }),
  );
});

it("the first arrival after the round ceiling latches before queuing any message", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [a] = await twoWorkersStarted(f.world, f.input);
  joinRoundsForwarded(f.h.databasePath, a.runId, "merge", 1);
  joinRoundAtMaximum(f.h.databasePath);

  // Act
  await resultReported(f.world, a);

  // Assert
  const run = await latched(f.world, a.runId);
  expect(merge(run)).toMatchObject({ round: Number.MAX_SAFE_INTEGER, arrived: 0, queued: 0 });
  expect(mergeIntents(run)).toMatchObject([{ state: "pending", payloadRetained: true }]);
});
