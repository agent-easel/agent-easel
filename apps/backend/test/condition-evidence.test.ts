import { assert, expect, it } from "@effect/vitest";
import { CONDITION_TIMELINE_ARRIVALS, FINISH_BLOCK_ID } from "@t3-factory/contracts";
import { appliedRun, subscribe, watchRun } from "./support/live.ts";
import { prepared } from "./support/prepared-runner.ts";
import {
  arrivalsNumbered,
  chainedConditionArrivals,
  chainedConditionFlow,
  conditionFlow,
  conditionLoopedThrough,
  conditionSelections,
  observeFor,
  resultReported,
  selfLoopConditionFlow,
  workerAtWork,
} from "./support/scenarios.ts";

const workerOrigin = (runId: string, threadId: string) => ({
  runId,
  activationId: expect.any(String),
  threadId,
});

it("Condition evidence distinguishes ordinary recipients and every ending from the same output", async (c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const { graph } = f.flow;
  const recipient = { sourceBlockId: "gate", exitId: "otherwise" };
  const ending = (id: string) =>
    ({ id, name: id, description: "", output: "none", outputDescription: "" }) as const;
  const collidingId = "finish/ending:done";
  const adjusted = await f.f.updateFlow(f.flow.id, {
    name: f.flow.name,
    expectedRevision: f.flow.revision,
    expectedProjectId: f.flow.projectId,
    graph: {
      ...graph,
      blocks: [
        ...graph.blocks.filter((block) => block.id !== "follow-up"),
        { id: FINISH_BLOCK_ID, name: "Legacy review", kind: "human", position: { x: 700, y: 0 } },
        { id: collidingId, name: "Other review", kind: "human", position: { x: 700, y: 250 } },
      ],
      connections: [
        { sourceBlockId: "worker", exitId: "done", targetBlockId: "gate" },
        { ...recipient, targetBlockId: FINISH_BLOCK_ID },
        { ...recipient, targetBlockId: collidingId },
        { ...recipient, targetBlockId: FINISH_BLOCK_ID, targetEndingId: "done" },
        { ...recipient, targetBlockId: FINISH_BLOCK_ID, targetEndingId: "later" },
      ],
      finish: { ...graph.finish, endings: [ending("done"), ending("later")] },
    },
  });
  assert(adjusted.ok);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "The worker delivered" });

  // Act
  const run = await observeFor(
    "accept the selected ending",
    f.world,
    worker.runId,
    (detail) => detail.result !== null,
  );

  // Assert
  expect(run.result?.endingId).toBe("done");
  expect(run.blocks.map((block) => [block.blockId, block.name])).toContainEqual([
    FINISH_BLOCK_ID,
    "Legacy review",
  ]);
  const page = await f.f.listConditionArrivals(worker.runId, "gate", "", "");
  assert(page.ok);
  expect(page.value.arrivals[0]?.recipients).toStrictEqual([
    { blockId: FINISH_BLOCK_ID, targetEndingId: null, disposition: "acknowledged" },
    { blockId: collidingId, targetEndingId: null, disposition: "acknowledged" },
    { blockId: FINISH_BLOCK_ID, targetEndingId: "done", disposition: "acknowledged" },
    { blockId: FINISH_BLOCK_ID, targetEndingId: "later", disposition: "cancelled" },
  ]);
});

it("a Condition's evidence lists its arrivals in order with source, worker, matched rule or Otherwise and recipients", async (c) => {
  // Arrange
  const f = await prepared(c, chainedConditionFlow);
  const [first, second] = await chainedConditionArrivals(
    f.world,
    f.input,
    f.reopenWithCapturedOutputUnwired,
  );

  // Act
  const page = await f.f.listConditionArrivals(first.runId, "gate", "", "");

  // Assert
  assert(page.ok);
  expect(page.value).toStrictEqual({
    arrivals: [
      {
        id: expect.any(String),
        arrivalNumber: 1,
        outputId: "otherwise",
        acceptedAt: expect.any(String),
        sourceBlockId: "worker",
        origin: workerOrigin(first.runId, first.threadId),
        rule: null,
        recipients: [{ blockId: "final", targetEndingId: null, disposition: "acknowledged" }],
      },
      {
        id: expect.any(String),
        arrivalNumber: 2,
        outputId: "escalate",
        acceptedAt: expect.any(String),
        sourceBlockId: "second",
        origin: workerOrigin(first.runId, second.threadId),
        rule: { id: "escalate", name: "Escalate" },
        recipients: [{ blockId: "final", targetEndingId: null, disposition: "acknowledged" }],
      },
    ],
    highWater: 2,
    nextCursor: null,
  });
});

it("an unwired selection appears in the evidence with no recipients and its worker unchanged", async (c) => {
  // Arrange
  const f = await prepared(c, chainedConditionFlow);
  const [first, second] = await chainedConditionArrivals(
    f.world,
    f.input,
    f.reopenWithCapturedOutputUnwired,
  );

  // Act
  const page = await f.f.listConditionArrivals(first.runId, "final", "", "");

  // Assert
  assert(page.ok);
  expect(
    page.value.arrivals.map((arrival) => [
      arrival.arrivalNumber,
      arrival.outputId,
      arrival.sourceBlockId,
      arrival.origin?.threadId,
      arrival.recipients,
    ]),
  ).toStrictEqual([
    [1, "otherwise", "gate", first.threadId, []],
    [2, "otherwise", "gate", second.threadId, []],
  ]);
});

it("later pages stay within the first page's window while new arrivals land", async (c) => {
  // Arrange
  const f = await prepared(c, selfLoopConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  const turn = await conditionLoopedThrough(f.world, worker, 3);
  const first = await f.f.listConditionArrivals(worker.runId, "gate", "2", "");
  assert(first.ok && first.value.nextCursor);
  await conditionLoopedThrough(f.world, turn, 4);

  // Act
  const next = await f.f.listConditionArrivals(worker.runId, "gate", "2", first.value.nextCursor);

  // Assert
  expect(first.value.arrivals.map((arrival) => arrival.arrivalNumber)).toStrictEqual([1, 2]);
  expect(first.value.highWater).toBe(3);
  assert(next.ok);
  expect(next.value.arrivals.map((arrival) => arrival.arrivalNumber)).toStrictEqual([3]);
  expect(next.value).toMatchObject({ highWater: 3, nextCursor: null });
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.conditions[0]?.arrivals).toBe(4);
});

it("a Run read keeps only a Condition's latest selections while its evidence still reaches arrival 1", async (c) => {
  // Arrange
  const f = await prepared(c, selfLoopConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  await conditionLoopedThrough(f.world, worker, CONDITION_TIMELINE_ARRIVALS + 1);

  // Act
  const run = await f.f.getRun(worker.runId);

  // Assert
  assert(run.ok);
  const numbers = conditionSelections(run.value).map((selection) => selection.arrivalNumber);
  expect(numbers).toHaveLength(CONDITION_TIMELINE_ARRIVALS);
  expect(numbers[0]).toBe(2);
  expect(numbers.at(-1)).toBe(CONDITION_TIMELINE_ARRIVALS + 1);
  const page = await f.f.listConditionArrivals(worker.runId, "gate", "1", "");
  assert(page.ok);
  expect(page.value.arrivals.map((arrival) => arrival.arrivalNumber)).toStrictEqual([1]);
});

it("an open Run subscription keeps a Condition's Timeline window as it advances past it", async (c) => {
  // Arrange
  const f = await prepared(c, selfLoopConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  const turn = await conditionLoopedThrough(f.world, worker, CONDITION_TIMELINE_ARRIVALS + 1);
  const live = subscribe(c, watchRun(f.f.live, worker.runId));
  await live.until((messages) => messages.length > 0);

  // Act
  await conditionLoopedThrough(f.world, turn, CONDITION_TIMELINE_ARRIVALS + 2);

  // Assert
  const messages = await live.until(
    (received) => appliedRun(received)?.conditions[0]?.arrivals === CONDITION_TIMELINE_ARRIVALS + 2,
  );
  const fresh = await f.f.getRun(worker.runId);
  assert(fresh.ok);
  expect(conditionSelections(appliedRun(messages)!)).toStrictEqual(
    conditionSelections(fresh.value),
  );
  expect(conditionSelections(fresh.value)[0]?.arrivalNumber).toBe(3);
});

it.for([
  ["zero", "0"],
  ["above the maximum", "101"],
  ["fractional", "1.5"],
  ["not a number", "ten"],
] as const)("a Condition evidence page size that is %s is rejected", async ([, limit], c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const started = await f.f.startRun(f.input);
  assert(started.ok);

  // Act
  const page = await f.f.listConditionArrivals(started.value.id, "gate", limit, "");

  // Assert
  assert(!page.ok);
  expect(page.error.code).toBe("validation");
  expect(page.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["condition_page_limit", "limit"],
  ]);
});

it("a cursor from another Condition of the same Run is rejected", async (c) => {
  // Arrange
  const f = await prepared(c, chainedConditionFlow);
  const [first] = await chainedConditionArrivals(
    f.world,
    f.input,
    f.reopenWithCapturedOutputUnwired,
  );
  const gatePage = await f.f.listConditionArrivals(first.runId, "gate", "1", "");
  assert(gatePage.ok && gatePage.value.nextCursor);

  // Act
  const page = await f.f.listConditionArrivals(
    first.runId,
    "final",
    "1",
    gatePage.value.nextCursor,
  );

  // Assert
  assert(!page.ok);
  expect(page.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["condition_page_cursor", "cursor"],
  ]);
});

it("an altered cursor is rejected", async (c) => {
  // Arrange
  const f = await prepared(c, chainedConditionFlow);
  const [first] = await chainedConditionArrivals(
    f.world,
    f.input,
    f.reopenWithCapturedOutputUnwired,
  );
  const gatePage = await f.f.listConditionArrivals(first.runId, "gate", "1", "");
  assert(gatePage.ok && gatePage.value.nextCursor);

  // Act
  const page = await f.f.listConditionArrivals(
    first.runId,
    "gate",
    "1",
    `${gatePage.value.nextCursor}A`,
  );

  // Assert
  assert(!page.ok);
  expect(page.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["condition_page_cursor", "cursor"],
  ]);
});

it("a cursor re-encoded with its high-water raised past a later arrival is rejected", async (c) => {
  // Arrange
  const f = await prepared(c, selfLoopConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  const turn = await conditionLoopedThrough(f.world, worker, 3);
  const first = await f.f.listConditionArrivals(worker.runId, "gate", "1", "");
  assert(first.ok && first.value.nextCursor);
  await conditionLoopedThrough(f.world, turn, 4);
  const [payload = "", ...signature] = first.value.nextCursor.split(".");
  const [runId, blockId, , after] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const raised = Buffer.from(JSON.stringify([runId, blockId, 4, after]), "utf8").toString(
    "base64url",
  );

  // Act
  const page = await f.f.listConditionArrivals(
    worker.runId,
    "gate",
    "1",
    [raised, ...signature].join("."),
  );

  // Assert
  expect(first.value.highWater).toBe(3);
  assert(!page.ok);
  expect(page.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["condition_page_cursor", "cursor"],
  ]);
});

it("each evidence read shows a recipient's current disposition, not the one at selection", async (c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  f.t3.contract.support.launch = false;
  await resultReported(f.world, worker, { message: "Hold this." });
  await arrivalsNumbered(f.world, worker.runId, 1);
  const before = await f.f.listConditionArrivals(worker.runId, "gate", "", "");
  assert((await f.f.archiveRun(worker.runId)).ok);

  // Act
  const after = await f.f.listConditionArrivals(worker.runId, "gate", "", "");

  // Assert
  assert(before.ok && after.ok);
  expect(before.value.arrivals[0]?.recipients).toStrictEqual([
    { blockId: "follow-up", targetEndingId: null, disposition: "pending" },
  ]);
  expect(after.value.arrivals[0]?.recipients).toStrictEqual([
    { blockId: "follow-up", targetEndingId: null, disposition: "cancelled" },
  ]);
  expect(after.value.arrivals[0]?.acceptedAt).toBe(before.value.arrivals[0]?.acceptedAt);
});

it("factory_get_condition_arrivals returns the same page as the HTTP read for the caller's Run", async (c) => {
  // Arrange
  const f = await prepared(c, chainedConditionFlow);
  const [first] = await chainedConditionArrivals(
    f.world,
    f.input,
    f.reopenWithCapturedOutputUnwired,
  );

  // Act
  const reply = await f.f.runtime.conditionArrivals({
    arguments: { blockId: first.blockId, conditionBlockId: "gate", limit: 1 },
  });

  // Assert
  const page = await f.f.listConditionArrivals(first.runId, "gate", "1", "");
  assert(page.ok);
  expect(reply).toStrictEqual({ code: "CONDITION_ARRIVALS", ...page.value });
  expect(reply.nextCursor).toEqual(expect.any(String));
});

it("factory_get_run includes each Condition's summary", async (c) => {
  // Arrange
  const f = await prepared(c, chainedConditionFlow);
  const [first] = await chainedConditionArrivals(
    f.world,
    f.input,
    f.reopenWithCapturedOutputUnwired,
  );

  // Act
  const reply = await f.f.runtime.run({ arguments: { blockId: first.blockId } });

  // Assert
  expect(reply.conditions).toStrictEqual([
    {
      blockId: "gate",
      arrivals: 2,
      pending: 0,
      latest: { arrivalNumber: 2, outputId: "escalate", acceptedAt: expect.any(String) },
    },
    {
      blockId: "final",
      arrivals: 2,
      pending: 0,
      latest: { arrivalNumber: 2, outputId: "otherwise", acceptedAt: expect.any(String) },
    },
  ]);
});
