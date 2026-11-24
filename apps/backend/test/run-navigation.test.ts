import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { assert, expect, it } from "@effect/vitest";
import { prepared, preparedService } from "./support/prepared-runner.ts";
import { unnumberedRun } from "./support/navigation.ts";
import {
  allTurnsEnd,
  endingFlow,
  endingReached,
  observeFor,
  repositoryFactsObserved,
  resultReleasedToHumanReview,
  resultReported,
  reviewedEndingFlow,
  twoRunsOfOneFlow,
  workerAtWork,
  workerLaunched,
  workingReported,
  workingReportedIdle,
  worktreeBound,
  worktreeFanOutFlow,
  worktreeReviewFlow,
} from "./support/scenarios.ts";

const repository = {
  branch: "feature/search",
  pullRequests: [
    {
      host: "github.com",
      repository: "example/search",
      number: 42,
      url: "https://github.com/example/search/pull/42",
      state: "open" as const,
    },
  ],
};

/** The second of two Runs of one Flow, created a minute after the first. */
const secondStart = {
  requestId: "second",
  input: "Second title\nHidden body",
  title: "Second title",
  createdAt: "2026-11-07T08:01:00.000Z",
};

it("unchanged worker observations change neither navigation metadata nor the last activity time", async (c) => {
  // Arrange
  const { f, world, input } = await prepared(c);
  await repositoryFactsObserved(world, await workerLaunched(world, input), repository);
  const listed = await f.listRunNavigation();
  assert(listed.ok);
  const navigation = listed.value;

  // Act
  assert((await f.reconcileRuns()).ok);

  // Assert
  expect(await f.listRunNavigation()).toStrictEqual({ ok: true, value: navigation });
});

it("worker branches and linked pull requests remain available after restarting AgentEasel", async (c) => {
  // Arrange
  const { h, f, t3, world, input } = await prepared(c);
  const launched = await workerLaunched(world, input);
  const { runId, threadId } = await repositoryFactsObserved(world, launched, repository);
  const before = await f.listRunNavigation();
  assert(before.ok);
  const navigation = before.value;
  await f.close();

  // Act
  const restarted = await h.open({ t3, connectionRetryMs: 60_000 });
  c.onTestFinished(() => restarted.close());

  // Assert
  const run = await restarted.getRun(runId);
  assert(run.ok);
  expect(run.value.repositories).toMatchObject([{ threadId, ...repository }]);
  const listed = await restarted.listRunNavigation();
  assert(listed.ok);
  expect(listed.value[0]?.repositories).toStrictEqual(run.value.repositories);
  expect(listed.value[0]?.lastActivityAt).toBe(navigation[0]?.lastActivityAt);
});

it("an unavailable observation preserves last known worker repositories and marks them stale", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const launched = await workerLaunched(world, input);
  const { runId } = await repositoryFactsObserved(world, launched, repository);
  t3.connection.available = false;

  // Act
  assert((await f.reconcileRuns()).ok);

  // Assert
  const run = await f.getRun(runId);
  assert(run.ok);
  expect(run.value.repositories).toMatchObject([{ ...repository, freshness: "stale" }]);
});

it("a Start with an over-long title creates no Run", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);

  // Act
  const result = await f.startRun({ ...input, title: "x".repeat(501) });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
  expect(result.error.issues.map((issue) => issue.path)).toStrictEqual(["title"]);
  expect(await f.listRunNavigation()).toStrictEqual({ ok: true, value: [] });
});

it("a Start with a non-canonical creation time creates no Run", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);

  // Act
  const result = await f.startRun({ ...input, createdAt: "2026-11-07 08:00" });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
  expect(result.error.issues.map((issue) => issue.path)).toStrictEqual(["createdAt"]);
  expect(await f.listRunNavigation()).toStrictEqual({ ok: true, value: [] });
});

it("a Start claiming a generated title creates no Run", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);

  // Act
  const result = await f.startRun({ ...input, titleProvenance: "generated" });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
  expect(result.error.issues.map((issue) => issue.path)).toStrictEqual(["titleProvenance"]);
  expect(await f.listRunNavigation()).toStrictEqual({ ok: true, value: [] });
});

it("a Start request stored before title provenance existed is accepted as legacy and replays to the same Run", async (c) => {
  // Arrange
  const { f, input, t3 } = await prepared(c);
  const launch = t3.threads.nextLaunch();
  const { titleProvenance: _absent, ...stored } = input;
  const accepted = await f.startRun(stored);
  assert(accepted.ok);

  // Act
  const replayed = await f.startRun({ ...stored, titleProvenance: "legacy" });

  // Assert
  assert(replayed.ok);
  expect(replayed.value.id).toBe(accepted.value.id);
  expect(replayed.value.titleProvenance).toBe("legacy");
  expect((await launch).title).toBe("F#1 Entry worker · Improve search");
});

it("a started draft keeps its chosen title, its title provenance and creation order after restart", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c);
  const newer = await f.startRun({
    ...input,
    requestId: "newer-draft",
    title: "Newer draft",
    createdAt: "2026-11-07T09:00:00.000Z",
  });
  assert(newer.ok);
  const older = await f.startRun({
    ...input,
    title: "  Chosen draft title  ",
    titleProvenance: "manual",
    createdAt: "2026-11-07T08:00:00.000Z",
  });
  assert(older.ok);
  await f.close();
  const restarted = await h.open({ t3, connectionRetryMs: 60_000 });
  c.onTestFinished(() => restarted.close());

  // Act
  const result = await restarted.listRunNavigation();

  // Assert
  assert(result.ok);
  expect(
    result.value.map(({ id, title, titleProvenance, createdAt }) => ({
      id,
      title,
      titleProvenance,
      createdAt,
    })),
  ).toStrictEqual([
    {
      id: newer.value.id,
      title: "Newer draft",
      titleProvenance: "automatic",
      createdAt: "2026-11-07T09:00:00.000Z",
    },
    {
      id: older.value.id,
      title: "Chosen draft title",
      titleProvenance: "manual",
      createdAt: "2026-11-07T08:00:00.000Z",
    },
  ]);
  expect(older.value.titleProvenance).toBe("manual");
  expect(older.value.startedAt).not.toBe("2026-11-07T08:00:00.000Z");
});

it("Runs created at the same time are ordered by their Start request keys", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);
  assert((await f.startRun({ ...input, requestId: "b-draft" })).ok);
  assert((await f.startRun({ ...input, requestId: "a-draft" })).ok);

  // Act
  const result = await f.listRunNavigation();

  // Assert
  assert(result.ok);
  expect(result.value.map((entry) => entry.creationKey)).toStrictEqual(["a-draft", "b-draft"]);
});

it("renaming a Run trims its title and makes it manual without changing its sibling or its Task", async (c) => {
  // Arrange
  const { f, world, input } = await prepared(c);
  const { first, second } = await twoRunsOfOneFlow(world, input, { ...input, ...secondStart });

  // Act
  const renamed = await f.renameRun(first.id, { title: "  Independent name  " });

  // Assert
  assert(renamed.ok);
  expect(renamed.value.title).toBe("Independent name");
  expect(renamed.value.titleProvenance).toBe("manual");
  expect(renamed.value.definitions).toStrictEqual(first.definitions);
  expect(renamed.value.events).toStrictEqual(first.events);
  expect(renamed.value.input).toBe(first.input);
  expect(renamed.value.task.title).toBe(first.task.title);
  const other = await f.getRun(second.id);
  assert(other.ok);
  expect(other.value.title).toBe("Second title");
  expect(other.value.titleProvenance).toBe("automatic");
  const navigation = await f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value.find((entry) => entry.id === first.id)?.titleProvenance).toBe("manual");
});

it("an Archived Run cannot be renamed and keeps its title", async (c) => {
  // Arrange
  const { f, world, input } = await prepared(c);
  const { first } = await twoRunsOfOneFlow(world, input, { ...input, ...secondStart });
  assert((await f.archiveRun(first.id)).ok);

  // Act
  const result = await f.renameRun(first.id, { title: "Too late" });

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "conflict",
    message: "An Archived Run cannot be renamed.",
  });
  const run = await f.getRun(first.id);
  assert(run.ok);
  expect(run.value.title).toBe(first.title);
});

it("a whitespace-only Run title is rejected", async (c) => {
  // Arrange
  const { f, world, input } = await prepared(c);
  const { first } = await twoRunsOfOneFlow(world, input, { ...input, ...secondStart });

  // Act
  const result = await f.renameRun(first.id, { title: " \t " });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
});

it("global navigation leaves out an archived Run and keeps the others in creation order", async (c) => {
  // Arrange
  const { f, input, world } = await prepared(c);
  const { first, second } = await twoRunsOfOneFlow(world, input, { ...input, ...secondStart });
  await f.renameRun(first.id, { title: "Latest activity on oldest Run" });
  const third = await f.startRun({
    ...input,
    requestId: "third",
    title: "Third title",
    input: "Third title",
    createdAt: "2026-11-07T08:02:00.000Z",
  });
  assert(third.ok);
  assert((await f.archiveRun(second.id)).ok);

  // Act
  const result = await f.listRunNavigation();

  // Assert
  assert(result.ok);
  expect(result.value.map((run) => run.id)).toStrictEqual([third.value.id, first.id]);
  expect(result.value.map((run) => run.lifecycle)).toStrictEqual(["active", "active"]);
});

it("snoozing an open Run leaves execution, attention and history unchanged", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  const before = await f.getRun(started.value.id);

  // Act
  const result = await f.snoozeRun(started.value.id);

  // Assert
  expect(result).toStrictEqual({ ok: true, value: { snoozed: true, woke: false } });
  expect(await f.getRun(started.value.id)).toStrictEqual(before);
  const navigation = await f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]?.presentation).toStrictEqual({ snoozed: true, woke: false });
});

it("navigation identifies a started Run with the same number as Run detail", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  const detail = await f.getRun(started.value.id);
  assert(detail.ok);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(detail.value.number).toBeGreaterThan(0);
  expect(navigation.value[0]?.number).toBe(detail.value.number);
});

it("navigation and Run detail preserve an absent stored Run number", async (c) => {
  // Arrange
  const { f, runId } = await unnumberedRun(c);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(navigation.value[0]?.number).toBeNull();
  const detail = await f.getRun(runId);
  assert(detail.ok);
  expect(detail.value.number).toBeNull();
});

it("a pending native request in navigation carries the worker's pending request count and its Block name", async (c) => {
  // Arrange
  const { f, world, input } = await prepared(c);
  const worker = await workerLaunched(world, input);
  world.t3.threads.recordThreadFacts(worker.threadId, { pendingRequestCount: 2 });
  await observeFor("observe the native requests", world, worker.runId, (run) =>
    run.attention.some((matter) => matter.kind === "native-request" && !matter.settledAt),
  );

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(navigation.value[0]?.attention.matters).toMatchObject([
    { kind: "native-request", pendingRequestCount: 2, blockName: "Entry worker" },
  ]);
});

it("a Run whose worktree creation failed is a Problem in navigation without an attention matter", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.rejectLaunch = true;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  const entry = navigation.value.find((run) => run.id === started.value.id);
  expect(entry?.lifecycle).toBe("active");
  expect(entry?.attention).toStrictEqual({ needsInput: false, problem: true, matters: [] });
});

it("an Agent idle with a working report marks its Run Needs input in navigation without an attention matter", async (c) => {
  // Arrange
  const { f, world, input } = await prepared(c);
  await workingReportedIdle(world, await workerAtWork(world, input));

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(navigation.value[0]?.attention).toStrictEqual({
    needsInput: true,
    problem: false,
    matters: [],
  });
});

it("an Agent with a working report and pending delegated work does not ask for input", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  await workingReported(world, worker);
  allTurnsEnd(world, worker);
  t3.threads.answerDelegatedWait(worker.threadId, worker.executionId, "pending", "completed");
  await f.reconcileRuns();

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(navigation).toMatchObject({
    ok: true,
    value: [{ attention: { needsInput: false, problem: false, matters: [] } }],
  });
});

it.effect("an unreported visit first needs review after three hours without progress", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c, {}, { connectionRetryMs: 24 * 60 * 60_000 });
    yield* Effect.promise(() => workerAtWork(f.world, f.input));
    yield* TestClock.adjust(179 * 60_000);
    const before = yield* f.factory.listRunNavigation();

    // Act
    yield* TestClock.adjust(60_000);

    // Assert
    expect(before).toMatchObject({ value: [{ attention: { needsInput: false } }] });
    expect(yield* f.factory.listRunNavigation()).toMatchObject({
      value: [{ attention: { needsInput: true, matters: [] } }],
    });
  }),
);

it("navigation carries the recorded ending of a Run that reached it with its output", async (c) => {
  // Arrange
  const { world, input, f } = await prepared(c, endingFlow("optional"));
  const worker = await workerAtWork(world, input);
  await resultReported(world, worker, { message: "https://example.test/pull/42" });
  await endingReached(world, worker.runId);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(navigation).toMatchObject({
    ok: true,
    value: [{ result: { endingName: "Shipped", outputMissing: false }, flowHasEndings: true }],
  });
});

it("navigation flags Output missing when an ending that required output was reached without it", async (c) => {
  // Arrange
  const { world, input, f } = await prepared(c, reviewedEndingFlow);
  const worker = await workerAtWork(world, input);
  await resultReported(world, worker, { message: "Ready to review." });
  const review = await resultReleasedToHumanReview(world, worker);
  assert((await f.answerHumanOccurrence(review.occurrence.id, { exitId: "approve" })).ok);
  await endingReached(world, worker.runId);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(navigation).toMatchObject({
    ok: true,
    value: [{ result: { endingName: "Delivered", outputMissing: true }, flowHasEndings: true }],
  });
});

it("navigation has no result before an ending is reached and says the Flow has endings", async (c) => {
  // Arrange
  const { world, input, f } = await prepared(c, endingFlow("optional"));
  await workerAtWork(world, input);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(navigation).toMatchObject({ ok: true, value: [{ result: null, flowHasEndings: true }] });
});

it("navigation says a Flow without endings has none", async (c) => {
  // Arrange
  const { world, input, f } = await prepared(c);
  await workerAtWork(world, input);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(navigation).toMatchObject({ ok: true, value: [{ result: null, flowHasEndings: false }] });
});

it("navigation carries a worktree Run's bound branch", async (c) => {
  // Arrange
  const { world, input, f } = await prepared(c, worktreeReviewFlow);
  const worker = await worktreeBound(world, input);
  const detail = await f.getRun(worker.runId);
  assert(detail.ok && detail.value.workspace.mode === "worktree");

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(detail.value.workspace.branch).toStrictEqual(expect.any(String));
  expect(navigation).toMatchObject({
    ok: true,
    value: [{ boundBranch: detail.value.workspace.branch }],
  });
});

it("navigation has no bound branch for a checkout Run", async (c) => {
  // Arrange
  const { world, input, f } = await prepared(c);
  await workerAtWork(world, input);

  // Act
  const navigation = await f.listRunNavigation();

  // Assert
  expect(navigation).toMatchObject({ ok: true, value: [{ boundBranch: null }] });
});
