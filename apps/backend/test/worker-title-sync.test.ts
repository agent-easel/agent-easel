import { assert, expect, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import { fingerprint } from "../src/fingerprint.ts";
import { prepared } from "./support/prepared-runner.ts";
import {
  allTurnsEnd,
  continuationFlow,
  enableRunTitles,
  handoffFlow,
  nextRename,
  observeFor,
  resultReleasedToSecondWorker,
  resultReported,
  settled,
  titleGenerationLaunched,
  workerAtWork,
} from "./support/scenarios.ts";

const legacyLaunchTitle = "Factory #1 · 1 Entry worker";

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

it("a lost launch recovered by its saved legacy title is renamed to the current format after it binds", async (c) => {
  // Arrange
  const { h, f, t3, input, world } = await prepared(c);
  t3.threads.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  const launch = [...t3.threads.launches.values()][0];
  assert(launch);
  t3.threads.remoteTitles.set(launch.reference.threadId, legacyLaunchTitle);
  await f.close();
  const db = new DatabaseSync(h.databasePath);
  const row = db
    .prepare("SELECT id, payload_json FROM operation_intents WHERE kind = 'launch'")
    .get() as {
    id: string;
    payload_json: string;
  };
  const payload = JSON.parse(row.payload_json) as { title: string };
  payload.title = legacyLaunchTitle;
  const body = JSON.stringify(payload);
  db.prepare("UPDATE operation_intents SET payload_json = ?, fingerprint = ? WHERE id = ?").run(
    body,
    fingerprint(body),
    row.id,
  );
  db.close();
  t3.threads.loseLaunchReply = false;
  const update = nextRename(world);

  // Act
  const restored = await h.open({ t3, connectionRetryMs: 60_000 });
  c.onTestFinished(() => restored.close());

  // Assert
  expect(await update).toMatchObject({
    threadId: launch.reference.threadId,
    title: "F#1 Entry worker · Improve search",
  });
  const run = await restored.getRun(accepted.value.id);
  assert(run.ok);
  expect(run.value.blocks.map((block) => block.threadId)).toContain(launch.reference.threadId);
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

  // Act
  assert((await f.renameRun(started.value.id, { title: `${"a".repeat(299)}b` })).ok);
  await f.reconcileRuns();

  // Assert
  expect(t3.threads.renames.map((rename) => rename.title)).toStrictEqual([sent.title]);
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
