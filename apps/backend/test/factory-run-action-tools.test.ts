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

it("the owner read gives each pending Human occurrence a target, and Approve through it answers exactly that occurrence", async (c) => {
  // Arrange
  const { fixture, run, client } = await reviewRun(c);
  const [first, second] = (await readRun(client, run.id)).humanOccurrences.entries;

  // Act
  const answered = await call(client, "factory_answer_human", {
    run: run.id,
    target: first.target,
    answer: "approve",
  });

  // Assert
  expect(answered.isError).toBe(false);
  expect(toolReply(answered)).toMatchObject({ code: "accepted", answer: "approve", runId: run.id });
  const occurrences = await fixture.f.getRun(run.id);
  assert(occurrences.ok);
  expect(occurrences.value.humanOccurrences.map((entry) => entry.state).toSorted()).toStrictEqual([
    "answered",
    "pending",
  ]);
  expect(second.target).not.toBe(first.target);
});

it("a Human answer through a target of another Run, an answered occurrence or another kind is refused and answers nothing else", async (c) => {
  // Arrange
  const { fixture, run, client } = await reviewRun(c);
  const other = await startedRun(fixture, { requestId: "other", title: "Other", ...START });
  const [first] = (await readRun(client, run.id)).humanOccurrences.entries;
  await call(client, "factory_answer_human", {
    run: run.id,
    target: first.target,
    answer: "approve",
  });

  // Act
  const mismatched = await call(client, "factory_answer_human", {
    run: other.id,
    target: first.target,
    answer: "approve",
  });
  const repeated = await call(client, "factory_answer_human", {
    run: run.id,
    target: first.target,
    answer: "approve",
  });
  const wrongKind = await call(client, "factory_continue_wait", {
    run: run.id,
    target: first.target,
  });

  // Assert
  expect(toolReply(mismatched)).toMatchObject({ code: "target_not_found" });
  expect(toolReply(repeated)).toMatchObject({ code: "occurrence_not_pending" });
  expect(toolReply(wrongKind)).toMatchObject({ code: "validation" });
  expect([mismatched, repeated, wrongKind].map((refused) => refused.isError)).toStrictEqual([
    true,
    true,
    true,
  ]);
  expect(
    [mismatched, repeated, wrongKind].map((refused) => typeof toolReply(refused).next),
  ).toStrictEqual(["string", "string", "string"]);
  const detail = await fixture.f.getRun(run.id);
  assert(detail.ok);
  expect(detail.value.humanOccurrences.filter((entry) => entry.state === "pending")).toHaveLength(
    1,
  );
});

it("Request changes needs the owner's exact feedback and Approve takes none", async (c) => {
  // Arrange
  const { run, client } = await reviewRun(c);
  const [first] = (await readRun(client, run.id)).humanOccurrences.entries;

  // Act
  const missing = await call(client, "factory_answer_human", {
    run: run.id,
    target: first.target,
    answer: "request-changes",
  });
  const approvedWithMessage = await call(client, "factory_answer_human", {
    run: run.id,
    target: first.target,
    answer: "approve",
    message: "extra",
  });
  const changed = await call(client, "factory_answer_human", {
    run: run.id,
    target: first.target,
    answer: "request-changes",
    message: "Rename the helper.",
  });

  // Assert
  expect(toolReply(missing).code).toBe("validation");
  expect(toolReply(approvedWithMessage).code).toBe("validation");
  expect(toolReply(changed)).toMatchObject({ code: "accepted", answer: "request-changes" });
});

it("Continue now through a pending Wait target forwards that arrival, and a second call is refused", async (c) => {
  // Arrange
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

  // Act
  const continued = await call(client, "factory_continue_wait", {
    run: run.id,
    target: wait.target,
  });
  const repeated = await call(client, "factory_continue_wait", {
    run: run.id,
    target: wait.target,
  });

  // Assert
  expect(continued.isError).toBe(false);
  expect(toolReply(continued)).toMatchObject({ code: "accepted", runId: run.id });
  const detail = await fixture.f.getRun(run.id);
  assert(detail.ok);
  expect(detail.value.waitArrivals.find((entry) => entry.id === waiting.arrival.id)).toMatchObject({
    state: "forwarded",
    forwardedBy: "user",
  });
  expect(repeated.isError).toBe(true);
  expect(toolReply(repeated).code).toBe("arrival_not_pending");
});

it("Request report through a missing-report Problem target asks that Block, and a Human target is refused", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const worker = await workerAtWork(fixture.world, fixture.input);
  await missingReport(fixture.world, worker);
  const client = await factoryMcpClient(c, fixture.f);
  const run = await readRun(client, worker.runId);
  const [problem] = run.problems.entries;

  // Act
  const requested = await call(client, "factory_request_report", {
    run: worker.runId,
    target: problem.target,
  });
  const misused = await call(client, "factory_request_report", {
    run: worker.runId,
    target: `human:${problem.target.split(":")[1]}`,
  });

  // Assert
  expect(problem.target).toMatch(/^problem:/);
  expect(requested.isError).toBe(false);
  expect(toolReply(requested)).toMatchObject({ code: "accepted", runId: worker.runId });
  expect(toolReply(misused).code).toBe("validation");
});

it("a stale or unknown target and an unknown Run are refused with a next step", async (c) => {
  // Arrange
  const { run, client } = await reviewRun(c);

  // Act
  const stale = await call(client, "factory_continue_wait", { run: run.id, target: "wait:gone" });
  const unknownRun = await call(client, "factory_answer_human", {
    run: "#999999",
    target: "human:x",
    answer: "approve",
  });

  // Assert
  expect(toolReply(stale)).toMatchObject({ code: "target_not_found" });
  expect(toolReply(unknownRun)).toMatchObject({ code: "not_found" });
  expect(toolReply(stale).next).toEqual(expect.any(String));
});
