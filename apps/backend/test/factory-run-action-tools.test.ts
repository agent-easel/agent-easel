import { assert, expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { factoryMcpClient, toolReply } from "./support/factory-mcp.ts";
import { startedRun } from "./support/chat-runs.ts";
import {
  endingBesideWaitFlow,
  launchedWorkers,
  missingReport,
  parallelReviewsFlow,
  resultReleasedToWait,
  resultReported,
  resultsReleasedToHumanReviews,
  workerAtWork,
} from "./support/scenarios.ts";

type Client = Awaited<ReturnType<typeof factoryMcpClient>>;

const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

const readRun = async (client: Client, run: string) =>
  toolReply(await call(client, "factory_read_run", { run }));

const START = { createdAt: "2026-11-07T08:00:00.000Z" };

async function reviewRun(c: Parameters<typeof prepared>[0]) {
  const fixture = await prepared(c, parallelReviewsFlow(2));
  const run = await startedRun(fixture, { requestId: "reviews", title: "Reviews", ...START });
  const { workers } = await launchedWorkers(fixture.world, run.id);
  await resultsReleasedToHumanReviews(fixture.world, workers, "Please review");
  return { fixture, run, client: await factoryMcpClient(c, fixture.f) };
}

async function firstOccurrence(c: Parameters<typeof prepared>[0]) {
  const world = await reviewRun(c);
  const [first, second] = (await readRun(world.client, world.run.id)).humanOccurrences.entries;
  return { ...world, first, second };
}

const answer = (
  world: { client: Client; run: { id: string }; first: { target: string } },
  extra: Record<string, unknown>,
) =>
  call(world.client, "factory_answer_human", {
    run: world.run.id,
    target: world.first.target,
    ...extra,
  });

async function pendingWait(c: Parameters<typeof prepared>[0]) {
  const fixture = await prepared(c, endingBesideWaitFlow);
  const run = await startedRun(fixture, { requestId: "wait", title: "Wait", ...START });
  const {
    workers: [, second],
  } = await launchedWorkers(fixture.world, run.id);
  assert(second);
  await resultReported(fixture.world, second, { message: "hold" });
  const waiting = await resultReleasedToWait(fixture.world, second);
  const client = await factoryMcpClient(c, fixture.f);
  const [wait] = (await readRun(client, run.id)).pendingWaits.entries;
  return { fixture, run, client, wait, arrival: waiting.arrival };
}

it("Approve through a Human target answers exactly that occurrence", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);

  // Act
  const answered = await answer(world, { answer: "approve" });

  // Assert
  expect(toolReply(answered)).toMatchObject({
    code: "accepted",
    answer: "approve",
    runId: world.run.id,
  });
  const detail = await world.fixture.f.getRun(world.run.id);
  assert(detail.ok);
  expect(detail.value.humanOccurrences.map((entry) => entry.state).toSorted()).toStrictEqual([
    "answered",
    "pending",
  ]);
});

it("each pending Human occurrence has its own target", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);

  // Act
  const targets = [world.first.target, world.second.target];

  // Assert
  expect(new Set(targets).size).toBe(2);
});

it("a Human target used with another Run is refused and answers nothing", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);
  const other = await startedRun(world.fixture, { requestId: "other", title: "Other", ...START });

  // Act
  const refused = await call(world.client, "factory_answer_human", {
    run: other.id,
    target: world.first.target,
    answer: "approve",
  });

  // Assert
  expect(refused.isError).toBe(true);
  expect(toolReply(refused)).toMatchObject({ code: "target_not_found" });
  expect(toolReply(refused).next).toEqual(expect.any(String));
  const detail = await world.fixture.f.getRun(world.run.id);
  assert(detail.ok);
  expect(detail.value.humanOccurrences.filter((entry) => entry.state === "pending")).toHaveLength(
    2,
  );
});

it("a second answer to an answered occurrence is refused and answers no other occurrence", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);
  await answer(world, { answer: "approve" });

  // Act
  const repeated = await answer(world, { answer: "approve" });

  // Assert
  expect(repeated.isError).toBe(true);
  expect(toolReply(repeated)).toMatchObject({ code: "occurrence_not_pending" });
  const detail = await world.fixture.f.getRun(world.run.id);
  assert(detail.ok);
  expect(detail.value.humanOccurrences.filter((entry) => entry.state === "pending")).toHaveLength(
    1,
  );
});

it("a Human target given to Continue now is refused as not a Wait target", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);

  // Act
  const refused = await call(world.client, "factory_continue_wait", {
    run: world.run.id,
    target: world.first.target,
  });

  // Assert
  expect(refused.isError).toBe(true);
  expect(toolReply(refused).code).toBe("validation");
});

it("Request changes without the owner's feedback is refused", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);

  // Act
  const refused = await answer(world, { answer: "request-changes" });

  // Assert
  expect(toolReply(refused).code).toBe("validation");
});

it("Approve with a message is refused", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);

  // Act
  const refused = await answer(world, { answer: "approve", message: "extra" });

  // Assert
  expect(toolReply(refused).code).toBe("validation");
});

it("Request changes with the owner's feedback is accepted", async (c) => {
  // Arrange
  const world = await firstOccurrence(c);

  // Act
  const changed = await answer(world, { answer: "request-changes", message: "Rename the helper." });

  // Assert
  expect(toolReply(changed)).toMatchObject({ code: "accepted", answer: "request-changes" });
});

it("Continue now through a pending Wait target forwards that arrival", async (c) => {
  // Arrange
  const { fixture, run, client, wait, arrival } = await pendingWait(c);

  // Act
  const continued = await call(client, "factory_continue_wait", {
    run: run.id,
    target: wait.target,
  });

  // Assert
  expect(continued.isError).toBe(false);
  expect(toolReply(continued)).toMatchObject({ code: "accepted", runId: run.id });
  const detail = await fixture.f.getRun(run.id);
  assert(detail.ok);
  expect(detail.value.waitArrivals.find((entry) => entry.id === arrival.id)).toMatchObject({
    state: "forwarded",
    forwardedBy: "user",
  });
});

it("Continue now on an already forwarded Wait arrival is refused", async (c) => {
  // Arrange
  const { run, client, wait } = await pendingWait(c);
  await call(client, "factory_continue_wait", { run: run.id, target: wait.target });

  // Act
  const repeated = await call(client, "factory_continue_wait", {
    run: run.id,
    target: wait.target,
  });

  // Assert
  expect(repeated.isError).toBe(true);
  expect(toolReply(repeated).code).toBe("arrival_not_pending");
});

it("Request report through a missing-report Problem target asks that Block", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const worker = await workerAtWork(fixture.world, fixture.input);
  await missingReport(fixture.world, worker);
  const client = await factoryMcpClient(c, fixture.f);
  const [problem] = (await readRun(client, worker.runId)).problems.entries;

  // Act
  const requested = await call(client, "factory_request_report", {
    run: worker.runId,
    target: problem.target,
  });

  // Assert
  expect(problem.target).toMatch(/^problem:/);
  expect(requested.isError).toBe(false);
  expect(toolReply(requested)).toMatchObject({ code: "accepted", runId: worker.runId });
});

it("a stale Wait target is refused with a next step", async (c) => {
  // Arrange
  const { run, client } = await reviewRun(c);

  // Act
  const stale = await call(client, "factory_continue_wait", { run: run.id, target: "wait:gone" });

  // Assert
  expect(toolReply(stale)).toMatchObject({ code: "target_not_found" });
  expect(toolReply(stale).next).toEqual(expect.any(String));
});

it("an unknown Run is refused as not found", async (c) => {
  // Arrange
  const { client } = await reviewRun(c);

  // Act
  const unknownRun = await call(client, "factory_answer_human", {
    run: "#999999",
    target: "human:x",
    answer: "approve",
  });

  // Assert
  expect(toolReply(unknownRun)).toMatchObject({ code: "not_found" });
});
