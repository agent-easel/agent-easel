import { assert, expect, it } from "@effect/vitest";
import { copyFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { prepared } from "./support/prepared-runner.ts";
import {
  allTurnsEnd,
  continuationFlow,
  enableRunTitles,
  handoffFlow,
  heldWorkerRename,
  nextRename,
  observeFor,
  resultReleasedToSecondWorker,
  resultReported,
  settled,
  titleGenerationLaunched,
  workerAtWork,
} from "./support/scenarios.ts";

it("renaming a Run updates its bound worker thread without timeline, activity, or attention changes", async (c) => {
  // Arrange
  const { f, t3, input, world } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  const before = await f.getRun(started.value.id);
  const navigation = await f.listRunNavigation();
  assert(before.ok && navigation.ok);
  const update = nextRename(world);

  // Act
  const renamed = await f.renameRun(started.value.id, { title: "Polish search" });

  // Assert
  assert(renamed.ok);
  expect(await update).toMatchObject({
    threadId: [...t3.threads.launches.values()][0]?.reference.threadId,
    title: "F#1 Entry worker · Polish search",
  });
  const after = await f.getRun(started.value.id);
  const afterNavigation = await f.listRunNavigation();
  assert(after.ok && afterNavigation.ok);
  expect(after.value.events.map((event) => event.kind)).toStrictEqual(
    before.value.events.map((event) => event.kind),
  );
  expect(after.value.attention).toStrictEqual(before.value.attention);
  expect(afterNavigation.value.map((entry) => [entry.id, entry.lastActivityAt])).toStrictEqual(
    navigation.value.map((entry) => [entry.id, entry.lastActivityAt]),
  );
});

it("a manual title chosen before Start launches the worker and does not rename it afterward", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);

  // Act
  const started = await f.startRun({
    ...input,
    title: "Manual title",
    titleProvenance: "manual",
  });
  assert(started.ok);
  await f.reconcileRuns();

  // Assert
  expect([...t3.threads.launches.values()].map((launch) => launch.payload.title)).toStrictEqual([
    "F#1 Entry worker · Manual title",
  ]);
  expect(t3.threads.renames).toStrictEqual([]);
});

it("an applied generated title renames the worker and leaves the title thread on its technical label", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  await enableRunTitles(fixture.f);
  const started = await fixture.f.startRun(fixture.input);
  assert(started.ok);
  const launch = await titleGenerationLaunched(fixture.world, started.value.id);
  const worker = [...fixture.t3.threads.launches.values()].find((entry) =>
    entry.payload.title.startsWith("F#1 "),
  );
  assert(worker);
  const update = nextRename(fixture.world);

  // Act
  const applied = await fixture.f.runtime.title({
    arguments: {
      titleGenerationId: /titleGenerationId "([^"]+)"/.exec(launch.message)?.[1],
      title: "Search ranking",
    },
  });

  // Assert
  expect(applied.code).toBe("TITLE_APPLIED");
  expect(await update).toMatchObject({
    threadId: worker.reference.threadId,
    title: "F#1 Entry worker · Search ranking",
  });
  expect(launch.title).toBe(`Factory title · Run #1 · ${started.value.id}`);
});

it("a title chosen while a launch is still in flight is applied when the worker binds", async (c) => {
  // Arrange
  const { f, t3, input, world } = await prepared(c);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  t3.threads.beforeLaunch = () => held;
  const started = await f.startRun(input);
  assert(started.ok);
  const update = nextRename(world);
  assert((await f.renameRun(started.value.id, { title: "Polish search" })).ok);

  // Act
  release();

  // Assert
  expect(await update).toMatchObject({ title: "F#1 Entry worker · Polish search" });
  expect([...t3.threads.launches.values()][0]?.payload.title).toBe(
    "F#1 Entry worker · Improve search",
  );
});

it("archiving a Run drops a pending worker rename and a later title change does not call T3", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  t3.contract.support.rename = false;
  assert((await f.renameRun(started.value.id, { title: "Pending at Archive" })).ok);
  await f.reconcileRuns();
  assert((await f.archiveRun(started.value.id)).ok);
  t3.contract.support.rename = true;

  // Act
  const renamed = await f.renameRun(started.value.id, { title: "Archived title" });
  await f.reconcileRuns();

  // Assert
  assert(renamed.ok);
  expect(t3.threads.renames).toStrictEqual([]);
  expect(t3.threads.threadTitle([...t3.threads.launches.values()][0]!.reference.threadId)).toBe(
    "F#1 Entry worker · Improve search",
  );
});

it("a snoozed Run still renames its bound worker thread", async (c) => {
  // Arrange
  const { f, input, world } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  assert((await f.snoozeRun(started.value.id)).ok);
  const update = nextRename(world);

  // Act
  assert((await f.renameRun(started.value.id, { title: "Snoozed title" })).ok);

  // Assert
  expect(await update).toMatchObject({ title: "F#1 Entry worker · Snoozed title" });
});

it("a settled Run still renames its bound worker thread", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  const worker = await workerAtWork(fixture.world, fixture.input);
  await resultReported(fixture.world, worker);
  allTurnsEnd(fixture.world, worker);
  await settled(fixture.world, worker);
  const update = nextRename(fixture.world);

  // Act
  assert((await fixture.f.renameRun(worker.runId, { title: "Settled title" })).ok);

  // Assert
  expect(await update).toMatchObject({ title: "F#1 Entry worker · Settled title" });
});

it("editing only the clipped tail of a Run title does not call T3 again", async (c) => {
  // Arrange
  const { f, t3, input, world } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  const first = nextRename(world);
  assert((await f.renameRun(started.value.id, { title: "a".repeat(300) })).ok);
  const sent = await first;
  await f.reconcileRuns();
  t3.threads.remoteTitles.set(sent.threadId, "Manually chosen in T3");

  // Act
  assert((await f.renameRun(started.value.id, { title: `${"a".repeat(299)}b` })).ok);
  await f.reconcileRuns();

  // Assert
  expect(t3.threads.renames.map((rename) => rename.title)).toStrictEqual([sent.title]);
  expect(t3.threads.threadTitle(sent.threadId)).toBe("Manually chosen in T3");
});

it("a Continuation keeps the launching Block's title when the Run is renamed", async (c) => {
  // Arrange
  const fixture = await prepared(c, continuationFlow);
  const worker = await workerAtWork(fixture.world, fixture.input);
  await resultReported(fixture.world, worker);
  await observeFor("observe the continuation prompt", fixture.world, worker.runId, (run) =>
    run.blocks.some((block) => block.blockId === "spec" && block.state === "sent"),
  );
  const update = nextRename(fixture.world);

  // Act
  assert((await fixture.f.renameRun(worker.runId, { title: "Continuation title" })).ok);

  // Assert
  expect(await update).toMatchObject({
    threadId: worker.threadId,
    title: "F#1 Entry worker · Continuation title",
  });
  expect(fixture.t3.threads.launches.size).toBe(1);
});

it("an older T3 without rename support still accepts a Run rename and skips the thread update", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);
  t3.contract.support.rename = false;
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();

  // Act
  const renamed = await f.renameRun(started.value.id, { title: "Polish search" });
  await f.reconcileRuns();

  // Assert
  assert(renamed.ok);
  expect(renamed.value.title).toBe("Polish search");
  expect(t3.threads.renames).toStrictEqual([]);
});

it("a downstream worker launches with the Run title chosen before its first handoff", async (c) => {
  // Arrange
  const { f, world, input, t3 } = await prepared(c, handoffFlow);
  const worker = await workerAtWork(world, input);
  assert((await f.renameRun(worker.runId, { title: "New subject" })).ok);

  // Act
  await resultReleasedToSecondWorker(world, await resultReported(world, worker));

  // Assert
  expect([...t3.threads.launches.values()][1]?.payload.title).toBe(
    "F#1 Parallel work · New subject",
  );
});

it("a return to the launch title repairs a rename whose acknowledgement was lost", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();
  t3.threads.loseRenameReply = true;
  assert((await f.renameRun(started.value.id, { title: "Intermediate" })).ok);
  await f.reconcileRuns();
  await expect.poll(() => t3.threads.renames.length).toBe(1);
  const [intermediate] = t3.threads.renames;
  assert(intermediate);
  t3.threads.loseRenameReply = false;

  // Act
  assert((await f.renameRun(started.value.id, { title: input.title })).ok);

  // Assert
  await f.reconcileRuns();
  await expect
    .poll(() => t3.threads.threadTitle(intermediate.threadId))
    .toBe("F#1 Entry worker · Improve search");
  expect(t3.threads.renames.at(-1)?.clientRequestId).not.toBe(intermediate.clientRequestId);
});

it("a replacement grant selected after the claim cannot dispatch the old Run's rename", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  t3.threads.beforeRename = async () => t3.connection.approve("replacement-grant");

  // Act
  assert((await f.renameRun(worker.runId, { title: "New subject" })).ok);

  // Assert
  await f.reconcileRuns();
  expect(t3.threads.renames).toStrictEqual([]);
});

it.for(["thread-not-found", "capability-denied"] as const)(
  "a %s refusal preserves the binding and prevents later revisions from retrying",
  async (kind, c) => {
    // Arrange
    const { f, t3, world, input } = await prepared(c);
    const worker = await workerAtWork(world, input);
    const before = await f.getRun(worker.runId);
    assert(before.ok);
    t3.threads.renameDisposition = { kind };
    assert((await f.renameRun(worker.runId, { title: "First title" })).ok);
    await f.reconcileRuns();
    await expect.poll(() => t3.threads.renames.length).toBe(1);
    const [sent] = t3.threads.renames;
    assert(sent);
    t3.threads.renameDisposition = undefined;

    // Act
    assert((await f.renameRun(worker.runId, { title: "Second title" })).ok);

    // Assert
    await f.reconcileRuns();
    expect(t3.threads.renames).toStrictEqual([sent]);
    const after = await f.getRun(worker.runId);
    assert(after.ok);
    expect(after.value.blocks.map((block) => block.threadId)).toContain(worker.threadId);
    expect(after.value.events).toEqual(before.value.events);
    expect(after.value.attention).toEqual(before.value.attention);
  },
);

it("Archive between claim and dispatch cancels the unsent rename", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  let archived = false;
  t3.threads.beforeRename = async () => {
    archived = (await f.archiveRun(worker.runId)).ok;
  };

  // Act
  assert((await f.renameRun(worker.runId, { title: "Cancelled title" })).ok);

  // Assert
  await f.reconcileRuns();
  await expect.poll(() => archived).toBe(true);
  expect(t3.threads.renames).toStrictEqual([]);
});

it("a restart with a sent claim and a newer target dispatches only the latest revision", async (c) => {
  // Arrange
  const { h, f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  const { sent, release } = await heldWorkerRename(world, worker.runId, "Intermediate");
  assert((await f.renameRun(worker.runId, { title: input.title })).ok);
  const snapshot = h.databasePath + ".at-dispatch";
  const db = new DatabaseSync(h.databasePath);
  db.prepare("VACUUM INTO ?").run(snapshot);
  db.close();
  t3.contract.support.rename = false;
  release();
  await f.close();
  await copyFile(snapshot, h.databasePath);
  t3.contract.support.rename = true;

  // Act
  const restored = await h.open({ t3 });

  // Assert
  await restored.reconcileRuns();
  await expect
    .poll(() => t3.threads.renames.map((request) => request.title))
    .toStrictEqual([sent.title, "F#1 Entry worker · Improve search"]);
  expect(t3.threads.renames[1]?.clientRequestId).not.toBe(sent.clientRequestId);
});

it("Archive ignores an already dispatched result and discards its queued successor", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  const { sent, release } = await heldWorkerRename(world, worker.runId, "Already sent");
  assert((await f.renameRun(worker.runId, { title: "Unsent" })).ok);

  // Act
  assert((await f.archiveRun(worker.runId)).ok);

  // Assert
  release();
  await f.reconcileRuns();
  expect(t3.threads.renames).toStrictEqual([sent]);
  expect(t3.threads.threadTitle(worker.threadId)).toBe(sent.title);
});

it("a capability withdrawn while connecting prevents dispatch of the claimed rename", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  t3.threads.beforeRename = async () => {
    t3.contract.support.rename = false;
    assert((await f.recheckConnection()).ok);
  };

  // Act
  assert((await f.renameRun(worker.runId, { title: "Held" })).ok);

  // Assert
  await f.reconcileRuns();
  delete t3.threads.beforeRename;
  assert((await f.renameRun(worker.runId, { title: input.title })).ok);
  t3.contract.support.rename = true;
  await f.reconcileRuns();
  expect(t3.threads.renames).toStrictEqual([]);
});

it("returning to the acknowledged title before dispatch preserves the worker's manual T3 title", async (c) => {
  // Arrange
  const { f, t3, world, input } = await prepared(c);
  const worker = await workerAtWork(world, input);
  t3.threads.remoteTitles.set(worker.threadId, "Manual T3 title");
  t3.threads.beforeRename = async () => {
    delete t3.threads.beforeRename;
    assert((await f.renameRun(worker.runId, { title: input.title })).ok);
  };

  // Act
  assert((await f.renameRun(worker.runId, { title: "Never sent" })).ok);

  // Assert
  await f.reconcileRuns();
  expect(t3.threads.renames).toStrictEqual([]);
  expect(t3.threads.threadTitle(worker.threadId)).toBe("Manual T3 title");
});
