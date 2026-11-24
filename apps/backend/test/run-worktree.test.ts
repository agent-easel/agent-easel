import { assert, expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { imageStart, screenshots, stageImages } from "./support/run-images.ts";
import {
  laterResultReturning,
  resultReleasedToHumanReview,
  resultReported,
  reviewApproved,
  worktreeBound,
  worktreeFanOutFlow,
  worktreeReviewFlow,
} from "./support/scenarios.ts";

it("a default-base worktree Start asks T3 Code to fetch origin for its single creator", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.worktreeMetadataPending = true;
  assert((await f.startRun(input)).ok);

  // Act
  await f.reconcileRuns();

  // Assert
  const launches = [...t3.threads.launches.values()].map((launch) => launch.payload);
  expect(launches.map((launch) => launch.title)).toStrictEqual([
    "F#1 Entry worker · Improve search",
  ]);
  expect(launches[0]!.workspaceStrategy).toStrictEqual({
    type: "worktree",
    baseRef: "origin/main",
    branch: expect.stringMatching(/^factory\/run-1-[0-9a-f]{8}$/),
    startFromOrigin: true,
  });
});

it("a custom local worktree base asks T3 Code to preserve the local ref", async (c) => {
  // Arrange
  const { f, t3, git, input } = await prepared(c, {
    workspace: { mode: "worktree", base: { kind: "ref", ref: "main" } },
  });
  git.refs.add("main");
  assert((await f.startRun(input)).ok);

  // Act
  await f.reconcileRuns();

  // Assert
  const [creator] = [...t3.threads.launches.values()].map((launch) => launch.payload);
  expect(creator!.workspaceStrategy).toStrictEqual({
    type: "worktree",
    baseRef: "main",
    branch: expect.stringMatching(/^factory\/run-1-[0-9a-f]{8}$/),
    startFromOrigin: false,
  });
});

it("a worker joining a newly bound worktree uses the latest Run title and its captured Block name", async (c) => {
  // Arrange
  const { f, t3, input, flow } = await prepared(c, worktreeFanOutFlow);
  t3.threads.worktreeMetadataPending = true;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  assert((await f.renameRun(started.value.id, { title: "Polish search" })).ok);
  const [creatorBlock, joiningBlock] = flow.graph.blocks;
  const edited = await f.updateFlow(flow.id, {
    name: flow.name,
    expectedRevision: flow.revision,
    expectedProjectId: flow.projectId,
    workspace: flow.workspace,
    graph: {
      ...flow.graph,
      blocks: [creatorBlock!, { ...joiningBlock!, name: "Updated entry" }],
    },
  });
  assert(edited.ok);
  t3.threads.worktreeMetadataPending = false;

  // Act
  await f.reconcileRuns();

  // Assert
  const [creator, second] = [...t3.threads.launches.values()].map((launch) => launch.payload);
  expect(t3.threads.launches.size).toBe(2);
  expect(creator!.title).toBe("F#1 Entry worker · Improve search");
  expect(second!.title).toBe("F#1 Second entry · Polish search");
  expect(second!.workspaceStrategy).toStrictEqual({
    type: "existing_worktree",
    worktreePath: "/t3-worktrees/thread-1",
    branch: (creator!.workspaceStrategy as { branch: string }).branch,
  });
});

it("the Flow-input worker joining a bound worktree receives the Run images too", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeFanOutFlow);
  await stageImages(f, Object.values(screenshots));
  t3.threads.worktreeMetadataPending = true;
  assert((await f.startRun(imageStart(input))).ok);
  await f.reconcileRuns();
  t3.threads.worktreeMetadataPending = false;

  // Act
  await f.reconcileRuns();

  // Assert
  const launches = [...t3.threads.launches.values()].map((launch) => launch.payload);
  expect(launches.map((launch) => launch.attachments?.map((a) => a.name))).toStrictEqual([
    ["image-1-screenshot.png", "image-2-screenshot.png", "image-3-mockup.png"],
    ["image-1-screenshot.png", "image-2-screenshot.png", "image-3-mockup.png"],
  ]);
});

it("a creator thread that shows its worktree path before its branch is observed without a scope change", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.worktreeBranchPending = true;
  const started = await f.startRun(input);
  assert(started.ok);

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.blocks[0]).toMatchObject({ freshness: "fresh", problem: null });
  expect(run.value.workspace).toMatchObject({ state: "preparing", path: null });
  expect(t3.threads.launches.size).toBe(1);
});

it("a lost creator reply is recovered by search without a second worktree, and the other worker waits for it", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.loseLaunchReply = true;
  t3.threads.discoverAvailable = false;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  t3.threads.loseLaunchReply = false;
  t3.threads.discoverAvailable = true;
  const waiting = t3.threads.launches.size;

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  const strategies = [...t3.threads.launches.values()].map(
    (launch) => launch.payload.workspaceStrategy,
  );
  expect(waiting).toBe(1);
  expect(t3.threads.launchCalls).toBe(2);
  expect(strategies.map((strategy) => strategy.type)).toStrictEqual([
    "worktree",
    "existing_worktree",
  ]);
  expect(run.value.blocks[0]).toMatchObject({ threadId: "thread-1", recovery: null });
});

it("restart before the worktree is bound binds it and launches the other worker once", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.worktreeMetadataPending = true;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  await f.close();
  t3.threads.worktreeMetadataPending = false;

  // Act
  const reopened = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  expect(t3.threads.launchCalls).toBe(2);
  const strategies = [...t3.threads.launches.values()].map(
    (launch) => launch.payload.workspaceStrategy,
  );
  expect(strategies).toMatchObject([
    { type: "worktree" },
    { type: "existing_worktree", worktreePath: "/t3-worktrees/thread-1" },
  ]);
  const run = await reopened.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.blocks.map((block) => block.threadId)).toStrictEqual(["thread-1", "thread-2"]);
});

it("restart with a joining launch unresolved recovers it by search without another launch", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.worktreeMetadataPending = true;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  t3.threads.worktreeMetadataPending = false;
  t3.threads.loseLaunchReply = true;
  t3.threads.discoverAvailable = false;
  await f.reconcileRuns();
  assert(t3.threads.launches.size === 2);
  await f.close();
  t3.threads.loseLaunchReply = false;
  t3.threads.discoverAvailable = true;

  // Act
  const reopened = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  expect(t3.threads.launchCalls).toBe(2);
  const run = await reopened.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.blocks[1]).toMatchObject({ threadId: "thread-2", recovery: null });
});

it("a worker thread that reports a worktree other than the Run's is a scope change", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, worktreeFanOutFlow);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  const moved = await t3.threads.readExecution(project, "thread-2");
  t3.threads.executionObservations.set("thread-2", {
    ...moved,
    workspaceRoot: "/t3-worktrees/other",
  });

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.blocks[1]).toMatchObject({
    freshness: "stale",
    problem: "Worker thread observation unavailable.",
  });
});

it("a rejected worktree-creating launch is a Block error and launches no other worker into the project root", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeFanOutFlow);
  t3.threads.rejectLaunch = true;
  const started = await f.startRun(input);
  assert(started.ok);

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(t3.threads.launchCalls).toBe(1);
  expect(run.value.blocks.map(({ state, problem }) => ({ state, problem }))).toStrictEqual([
    { state: "error", problem: "T3 Code rejected the worker launch." },
    {
      state: "error",
      problem:
        "T3 Code rejected the worker that creates the Run worktree. This worker was not launched.",
    },
  ]);
  expect(run.value.workspace).toMatchObject({
    state: "failed",
    path: null,
    problem:
      "T3 Code rejected the worker that creates the Run worktree. No worker was launched into it.",
  });
});

it("binding the worktree launches no worker for a Block whose turn has not come", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c, worktreeReviewFlow);
  t3.threads.worktreeMetadataPending = true;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  t3.threads.worktreeMetadataPending = false;

  // Act
  await f.reconcileRuns();
  await f.reconcileRuns();

  // Assert
  expect(t3.threads.launchCalls).toBe(1);
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.workspace).toMatchObject({ state: "bound", path: "/t3-worktrees/thread-1" });
  expect(run.value.blocks.map(({ threadId, state }) => ({ threadId, state }))).toStrictEqual([
    { threadId: "thread-1", state: "working" },
    { threadId: null, state: "not-started" },
    { threadId: null, state: "not-started" },
    { threadId: null, state: "not-started" },
  ]);
  expect(run.value.attention).toStrictEqual([]);
});

it("after a Human step, the first arrival at a later Block launches its worker with its task in the Run worktree", async (c) => {
  // Arrange
  const setup = await prepared(c, worktreeReviewFlow);
  const entry = await worktreeBound(setup.world, setup.input);
  const reported = await resultReported(setup.world, entry);
  const review = await resultReleasedToHumanReview(setup.world, reported);
  const { f, t3, runId } = { ...setup, ...(await reviewApproved(setup.world, review)) };

  // Act
  await f.reconcileRuns();

  // Assert
  const [creator, parallel] = [...t3.threads.launches.values()].map(({ payload }) => payload);
  expect(t3.threads.launchCalls).toBe(2);
  expect(t3.threads.sends.size).toBe(0);
  expect(parallel).toMatchObject({
    title: "F#1 Parallel work · Improve search",
    workspaceStrategy: {
      type: "existing_worktree",
      worktreePath: "/t3-worktrees/thread-1",
      branch: (creator!.workspaceStrategy as { branch: string }).branch,
    },
    message: expect.stringMatching(/^\$factory-block\n\nFactory Block id: [0-9a-f-]{36}\./),
  });
  const run = await f.getRun(runId);
  assert(run.ok);
  expect(run.value.blocks.map(({ threadId }) => threadId)).toStrictEqual([
    "thread-1",
    null,
    "thread-2",
    null,
  ]);
  expect(run.value.blocks[2]).toMatchObject({ state: "working", problem: null });
});

it("a Flow that returns to an earlier Block revisits its thread in the same worktree and launches nothing", async (c) => {
  // Arrange
  const setup = await prepared(c, worktreeReviewFlow);
  const entry = await worktreeBound(setup.world, setup.input);
  const reported = await resultReported(setup.world, entry);
  const review = await resultReleasedToHumanReview(setup.world, reported);
  const approved = await reviewApproved(setup.world, review);
  const { f, t3, runId } = {
    ...setup,
    ...(await laterResultReturning(setup.world, approved, entry)),
  };

  // Act
  await f.reconcileRuns();

  // Assert
  const sends = [...t3.threads.sends.values()].map(({ payload }) => payload.threadId);
  expect(sends).toStrictEqual(["thread-1"]);
  expect(t3.threads.launchCalls).toBe(2);
  const run = await f.getRun(runId);
  assert(run.ok);
  expect(run.value.workspace).toMatchObject({
    state: "bound",
    path: "/t3-worktrees/thread-1",
    branch: expect.stringMatching(/^factory\/run-1-/),
  });
  expect(run.value.blocks[0]).toMatchObject({
    threadId: "thread-1",
    state: "working",
    freshness: "fresh",
  });
});

it("a send that fails while the worker's worktree is missing stays unresolved and is delivered once T3 Code accepts it", async (c) => {
  // Arrange
  const setup = await prepared(c, worktreeReviewFlow);
  const entry = await worktreeBound(setup.world, setup.input);
  const reported = await resultReported(setup.world, entry);
  const review = await resultReleasedToHumanReview(setup.world, reported);
  const approved = await reviewApproved(setup.world, review);
  const { f, t3, runId } = {
    ...setup,
    ...(await laterResultReturning(setup.world, approved, entry)),
  };
  t3.threads.beforeSend = () => Promise.reject(Error("Worktree directory does not exist"));
  await f.reconcileRuns();
  delete t3.threads.beforeSend;

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(runId);
  assert(run.ok);
  expect([...t3.threads.sends.values()].map(({ payload }) => payload.threadId)).toStrictEqual([
    "thread-1",
  ]);
  expect(run.value.blocks[0]).toMatchObject({ threadId: "thread-1", state: "working" });
});

it("a worktree Run settles once its visited Block finishes, with no worker for its unvisited Blocks", async (c) => {
  // Arrange
  const setup = await prepared(c, worktreeReviewFlow);
  const entry = await worktreeBound(setup.world, setup.input);
  const shipped = await resultReported(setup.world, entry, { message: "Shipped.", exit: "ship" });
  const { f, t3, runId } = { ...setup, ...shipped };

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(t3.threads.launchCalls).toBe(1);
});

it("a rejected launch for a later Block keeps the worktree Run from settling without that Block's result", async (c) => {
  // Arrange
  const setup = await prepared(c, worktreeReviewFlow);
  const entry = await worktreeBound(setup.world, setup.input);
  const reported = await resultReported(setup.world, entry);
  const review = await resultReleasedToHumanReview(setup.world, reported);
  const { f, t3, runId } = { ...setup, ...(await reviewApproved(setup.world, review)) };
  t3.threads.rejectLaunch = true;

  // Act
  await f.reconcileRuns();
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(runId);
  assert(run.ok);
  expect(run.value.blocks[2]).toMatchObject({
    threadId: null,
    state: "error",
    problem: "T3 Code rejected the worker launch.",
  });
  expect(run.value.lifecycle).toBe("active");
});
