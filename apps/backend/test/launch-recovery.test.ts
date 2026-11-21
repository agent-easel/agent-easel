import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { prepared, preparedService } from "./support/prepared-runner.ts";
import {
  launchUncertain,
  workerAtWork,
  blockWorkerLaunched,
  observeFor,
  separatorLaunchFlow,
  resultReported,
} from "./support/scenarios.ts";

function foreignCandidate(
  launch: {
    payload: {
      title: string;
      projectId: string;
      modelSelection: {
        instanceId: string;
        model: string;
        options: Record<string, string | boolean>;
      };
    };
  },
  workspaceRoot: string,
) {
  return {
    title: launch.payload.title,
    projectId: launch.payload.projectId,
    parentThreadId: null,
    workspaceRoot,
    branch: null,
    interactionMode: "default",
    providerInstanceId: launch.payload.modelSelection.instanceId,
    model: launch.payload.modelSelection.model,
    options: { ...launch.payload.modelSelection.options },
    threadId: "thread-foreign",
    executions: [
      {
        runId: "execution-foreign",
        providerInstanceId: launch.payload.modelSelection.instanceId,
        model: launch.payload.modelSelection.model,
        status: "running",
      },
    ],
    link: "t3://threads/thread-foreign",
  };
}

it("an empty launch search does not launch another worker", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const fixture = { ...setup, ...(await launchUncertain(setup.world, setup.input)) };
  fixture.t3.threads.discoverAvailable = false;

  // Act
  await fixture.f.reconcileRuns();

  // Assert
  const run = await fixture.f.getRun(fixture.runId);
  assert(run.ok);
  expect(fixture.t3.threads.launches.size).toBe(1);
  expect(run.value.blocks[0]?.threadId).toBeNull();
  expect(run.value.blocks[0]?.recovery).toBe("pending");
});

it("two candidates with the expected title stay unresolved", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const fixture = { ...setup, ...(await launchUncertain(setup.world, setup.input)) };
  const launch = [...fixture.t3.threads.launches.values()][0]!;
  fixture.t3.threads.extraCandidates.push(foreignCandidate(launch, fixture.project.workspaceRoot));

  // Act
  await fixture.f.reconcileRuns();

  // Assert
  const run = await fixture.f.getRun(fixture.runId);
  assert(run.ok);
  expect(fixture.t3.threads.launches.size).toBe(1);
  expect(run.value.blocks[0]?.threadId).toBeNull();
  expect(run.value.blocks[0]?.recovery).toBe("pending");
});

it("a root-strategy worker reported on the project checkout is recovered", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const fixture = { ...setup, ...(await launchUncertain(setup.world, setup.input)) };
  const launch = [...fixture.t3.threads.launches.values()][0]!;
  fixture.t3.threads.launches.clear();
  fixture.t3.threads.extraCandidates.push({
    ...foreignCandidate(launch, fixture.project.workspaceRoot),
    workspaceRoot: null,
    threadId: launch.reference.threadId,
    link: launch.reference.link,
    executions: [
      {
        runId: launch.reference.runId,
        providerInstanceId: launch.payload.modelSelection.instanceId,
        model: launch.payload.modelSelection.model,
        status: launch.reference.status,
      },
    ],
  });

  // Act
  await fixture.f.reconcileRuns();

  // Assert
  const run = await fixture.f.getRun(fixture.runId);
  assert(run.ok);
  expect(fixture.t3.threads.launches.size).toBe(0);
  expect(run.value.blocks[0]?.threadId).toBe(launch.reference.threadId);
  expect(run.value.blocks[0]?.executionId).toBe(launch.reference.runId);
  expect(run.value.blocks[0]?.recovery).toBeNull();
});

it("a mismatched worker is not bound and is not replaced with another launch", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const fixture = { ...setup, ...(await launchUncertain(setup.world, setup.input)) };
  const launch = [...fixture.t3.threads.launches.values()][0]!;
  fixture.t3.threads.launches.clear();
  fixture.t3.threads.extraCandidates.push(foreignCandidate(launch, "/other-workspace"));

  // Act
  await fixture.f.reconcileRuns();

  // Assert
  const run = await fixture.f.getRun(fixture.runId);
  assert(run.ok);
  expect(fixture.t3.threads.launches.size).toBe(0);
  expect(run.value.blocks[0]?.threadId).toBeNull();
  expect(run.value.blocks[0]?.recovery).toBe("pending");
});

it("a rejected worker launch is an error and later reconciliation does not search it into service", async (c) => {
  // Arrange
  const fixture = await prepared(c);
  fixture.t3.threads.rejectLaunch = true;
  const started = await fixture.f.startRun(fixture.input);
  assert(started.ok);
  assert((await fixture.f.reconcileRuns()).ok);

  // Act
  await fixture.f.reconcileRuns();

  // Assert
  const run = await fixture.f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.blocks[0]).toMatchObject({
    state: "error",
    threadId: null,
    recovery: null,
    problem: "T3 rejected the worker launch.",
  });
  expect(fixture.t3.threads.launches.size).toBe(1);
});

it("launch recovery excludes a bound worker carrying the lost launch's exact title", async (c) => {
  // Arrange
  const { f, world, t3, input } = await prepared(c);
  const bound = await workerAtWork(world, input);
  t3.threads.beforeLaunch = async (payload) => {
    t3.threads.remoteTitles.set(bound.threadId, payload.title);
  };
  t3.threads.loseLaunchReply = true;
  const lost = await f.startRun({ ...input, requestId: "next" });
  assert(lost.ok);

  // Act
  await f.reconcileRuns();

  // Assert
  await expect
    .poll(async () => {
      await f.reconcileRuns();
      return f.getRun(lost.value.id);
    })
    .toMatchObject({ ok: true, value: { blocks: [{ threadId: "thread-2" }] } });
  expect(t3.threads.launchCalls).toBe(2);
});

it.effect(
  "an uncertain launch holds a later launch with the same saved title across Run revisions",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* preparedService(c, separatorLaunchFlow);
      f.t3.threads.discoverAvailable = false;
      f.t3.threads.beforeLaunch = async (p) => {
        f.t3.threads.loseLaunchReply = p.title.startsWith("F#1 A ·");
      };
      const started = yield* f.factory.startRun({ ...f.input, title: "B · Ship" });
      assert(started.ok);
      const worker = yield* Effect.promise(() =>
        blockWorkerLaunched(f.world, started.value.id, "worker"),
      );
      assert((yield* f.factory.renameRun(worker.runId, { title: "Ship" })).ok);
      yield* Effect.promise(() => resultReported(f.world, worker));
      yield* f.factory.reconcileRuns();
      yield* Effect.promise(() =>
        observeFor("later launch pending", f.world, worker.runId, (run) =>
          run.intents.some(
            (intent) =>
              intent.blockId === "later" && intent.kind === "launch" && intent.state === "pending",
          ),
        ),
      );
      expect(f.t3.threads.launchCalls).toBe(2);
      f.t3.threads.discoverAvailable = true;
      delete f.t3.threads.beforeLaunch;
      f.t3.threads.loseLaunchReply = false;
      yield* TestClock.adjust(60_000);

      // Act
      yield* f.factory.reconcileRuns();

      // Assert
      const recovered = yield* f.factory.getRun(worker.runId);
      assert(recovered.ok);
      expect(recovered.value.blocks.map((b) => [b.blockId, b.threadId])).toStrictEqual([
        ["worker", "thread-1"],
        ["second", "thread-2"],
        ["later", "thread-3"],
      ]);
      expect([...f.t3.threads.launches.values()].map((l) => l.payload.title)).toStrictEqual([
        "F#1 Entry worker · B · Ship",
        "F#1 A · B · Ship",
        "F#1 A · B · Ship",
      ]);
    }),
);
