import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { driverHomes, installFirstReportingTarget } from "./support/reporting.ts";
import { assert, expect, it } from "@effect/vitest";
import { factoryHarness } from "./support/factory.ts";
import { mockIngest } from "./support/telemetry.ts";
import { prepared } from "./support/prepared-runner.ts";
import { assertOk } from "./support/domain-setup.ts";
import { ending, placingGraph, savedFlow, toEnding } from "./support/subflow.ts";
import {
  agentBlock,
  allTurnsEnd,
  endingFlow,
  endingReached,
  flowInput,
  launchedWorkers,
  racingEndingsFlow,
  twoWorkersStarted,
  turnBegins,
  workerFinal,
  settleUnresolved,
  resultReleasedToWait,
  resultReported,
  settled,
  waitFlow,
  workerAtWork,
} from "./support/scenarios.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";

async function nestedEntry(context: Parameters<typeof prepared>[0]) {
  const ingest = await mockIngest(context);
  const ready = await prepared(context, undefined, { telemetry: { env: ingest.env } });
  const leaf = await savedFlow(ready.f, {
    name: "Private leaf Flow",
    graph: {
      flowInput: flowInput("same-worker"),
      blocks: [agentBlock("same-worker", "Private leaf Block", ready.agent.id)],
      connections: [toEnding("same-worker", "done", "done")],
      finish: { endings: [ending("done", "Private leaf ending")] },
    },
  });
  const middle = await savedFlow(ready.f, {
    name: "Private middle Flow",
    graph: placingGraph(leaf.id),
  });
  const root = await savedFlow(ready.f, {
    name: "Private root Flow",
    graph: placingGraph(middle.id),
  });
  return { ...ready, ingest, leaf, middle, root };
}

it("completing setup twice sends one anonymous setup event", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const harness = await factoryHarness(context, { freshDatabase: true });
  const factory = await harness.open({ t3: new ControlledT3(), telemetry: { env: ingest.env } });

  // Act
  const completed = await factory.completeFirstRunSetup();
  await factory.completeFirstRunSetup();
  await factory.close();

  // Assert
  assert(completed.ok && completed.value.completed);
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"setup.completed"/g)).toHaveLength(1);
  expect(payload).toContain('"t3Connection":"skipped"');
  expect(payload).toContain('"agentInstallation":"skipped"');
});

it("starting a Run reports graph structure and excludes its content", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, waitFlow, { telemetry: { env: ingest.env } });

  // Act
  await workerAtWork(ready.world, {
    ...ready.input,
    input: "private prompt sentinel",
    title: "private title sentinel",
  });
  await ready.f.close();

  // Assert
  expect(ingest.events("run.started")).toMatchObject([
    {
      properties: {
        source: "manual",
        flowScope: "global",
        blockCount: "2-5",
        hasImages: false,
        blockTypes: ["agent", "wait", "finish"],
      },
    },
  ]);
  const payload = JSON.stringify(ingest.requests);
  expect(payload).not.toMatch(/private prompt sentinel|private title sentinel/);
  expect(payload).not.toContain(ready.project.workspaceRoot);
  expect(payload).not.toContain(ready.project.title);
  expect(payload).not.toContain(JSON.stringify(ready.flow.name));
  expect(payload).not.toContain(JSON.stringify(ready.agent.name));
});

it("starting a composed Run reports the captured root graph once", async (context) => {
  // Arrange
  const { f, input, ingest, leaf, middle, root } = await nestedEntry(context);
  const launch = { ...input, flowId: root.id };

  // Act
  const [first, retry] = await Promise.all([f.startRun(launch), f.startRun(launch)]);
  await f.close();

  // Assert
  const started = assertOk(first);
  expect(assertOk(retry).id).toBe(started.id);
  expect(started.definitions.subflows?.map(({ id }) => id).sort()).toEqual(
    [middle.id, leaf.id].sort(),
  );
  expect(started.subflows?.[0]?.defaultInvocation).toMatchObject({ state: "active" });
  expect(ingest.events("run.started")).toMatchObject([
    { properties: { blockTypes: ["subflow", "finish"], blockCount: "2-5", flowScope: "global" } },
  ]);
  const payload = JSON.stringify(ingest.events("run.started"));
  expect(payload).not.toContain(root.id);
  expect(payload).not.toContain(leaf.id);
  expect(payload).not.toContain("Private");
});

it("a nested Finish counts scoped Blocks toward one root Run completion", async (context) => {
  // Arrange
  const { f, world, input, ingest, root } = await nestedEntry(context);
  const started = assertOk(await f.startRun({ ...input, flowId: root.id }));
  const { workers } = await launchedWorkers(world, started.id);
  const [worker] = workers;
  assert(worker);

  // Act
  await resultReported(world, worker, { message: "Private leaf result" });
  await settled(world, worker);
  const finished = assertOk(await f.getRun(started.id));
  await f.close();

  // Assert
  expect(finished.result?.output).toBe("Private leaf result");
  expect(ingest.events("run.finished")).toMatchObject([
    { properties: { status: "completed", executedBlockCount: "6+" } },
  ]);
  expect(JSON.stringify(ingest.events("run.finished"))).not.toContain("Private leaf result");
});

it("continuing a waiting arrival records one manual continuation", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, waitFlow, { telemetry: { env: ingest.env } });
  const worker = await workerAtWork(ready.world, ready.input);
  await resultReported(ready.world, worker);
  const waiting = await resultReleasedToWait(ready.world, worker);

  // Act
  assert((await ready.f.continueWaitArrival(waiting.arrival.id)).ok);
  await ready.f.close();

  // Assert
  expect(ingest.events("run.continued")).toHaveLength(1);
});

it("archiving a waiting Run twice records one cancellation and its terminal fields", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, waitFlow, { telemetry: { env: ingest.env } });
  const worker = await workerAtWork(ready.world, ready.input);
  await resultReported(ready.world, worker);
  const waiting = await resultReleasedToWait(ready.world, worker);
  assert((await ready.f.continueWaitArrival(waiting.arrival.id)).ok);

  // Act
  assert((await ready.f.archiveRun(worker.runId)).ok);
  assert((await ready.f.archiveRun(worker.runId)).ok);
  await ready.f.close();

  // Assert
  expect(ingest.events("run.cancelled")).toHaveLength(1);
  expect(ingest.events("run.finished")).toMatchObject([
    {
      properties: {
        status: "cancelled",
        executedBlockCount: "2-5",
        hadHumanWait: true,
        usedContinuation: false,
      },
    },
  ]);
});

it("automatic settlement sends one completed event even if the settled Run is later archived", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, endingFlow("optional"));
  await ready.f.close();
  const factory = await ready.h.open({ t3: ready.t3, telemetry: { env: ingest.env } });
  const world = { ...ready.world, factory };
  const worker = await workerAtWork(world, ready.input);

  // Act
  await resultReported(world, worker);
  await settled(world, worker);
  assert((await factory.archiveRun(worker.runId)).ok);
  await factory.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"run.finished"/g)).toHaveLength(1);
  expect(payload).toContain('"status":"completed"');
  expect(payload).toContain('"executedBlockCount":"2-5"');
  expect(payload).not.toContain('"event":"run.cancelled"');
});

it("settling a Run after an execution failure records a failed terminal outcome", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context);
  await ready.f.close();
  const factory = await ready.h.open({ t3: ready.t3, telemetry: { env: ingest.env } });
  const world = { ...ready.world, factory };
  const worker = await workerAtWork(world, ready.input);
  allTurnsEnd(world, worker, "failed");
  assert((await factory.reconcileRuns()).ok);

  // Act
  const result = await factory.settleRun(worker.runId, {});
  await factory.close();

  // Assert
  assert(result.ok && result.value.outcome === "settled");
  const payload = JSON.stringify(ingest.requests);
  expect(payload.match(/"event":"run.finished"/g)).toHaveLength(1);
  expect(payload).toContain('"status":"failed"');
});

it("an unresolved Stop followed by a retry and Archive counts the cancellation once", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, undefined, { telemetry: { env: ingest.env } });
  const worker = await workerAtWork(ready.world, ready.input);
  await settleUnresolved(ready.world, worker);

  // Act
  assert((await ready.f.settleRun(worker.runId, { stopWorkers: true })).ok);
  assert((await ready.f.archiveRun(worker.runId)).ok);
  await ready.f.close();

  // Assert
  expect(ingest.events("run.cancelled")).toHaveLength(1);
});

it("a Run that recovers an execution failure and settles without a named ending reports completion", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, undefined, { telemetry: { env: ingest.env } });
  const worker = await workerAtWork(ready.world, ready.input);
  await resultReported(ready.world, worker, { status: "failed" });
  assert((await ready.f.reconcileRuns()).ok);
  turnBegins(ready.world, worker, "retry-execution");
  expect((await ready.f.runtime.submit(workerFinal(worker.blockId))).code).toBe("ACCEPTED");
  ready.t3.threads.endThreadRun(worker.threadId, "retry-execution", "completed");

  // Act
  await settled(ready.world, worker);
  await ready.f.close();

  // Assert
  expect(ingest.events("run.finished")).toMatchObject([
    { properties: { status: "completed", executedBlockCount: "1" } },
  ]);
});

it("connecting to T3 includes recognized Mistral Vibe instances without custom driver or model names", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const fixture = await driverHomes(context, {
    "private-vibe": { driver: "acpRegistry", config: { agentId: "mistral-vibe" } },
    "private-registry": { driver: "acpRegistry", config: { agentId: "custom" } },
  });
  await fixture.factory.close();
  const provider = {
    driverKind: "acpRegistry",
    displayName: "private provider",
    models: [{ id: "private-model", label: "private-model" }],
  };
  fixture.t3.projects.controlledProviders.push(
    { ...provider, providerInstanceId: "private-vibe" },
    { ...provider, providerInstanceId: "private-registry" },
  );

  // Act
  const factory = await fixture.harness.open({
    ...fixture.options,
    telemetry: { env: ingest.env },
  });
  assert((await factory.recheckConnection()).ok);
  await factory.close();

  // Assert
  expect(ingest.events("t3.connected")).toMatchObject([
    { properties: { mode: "local", driverKinds: ["codex", "mistral-vibe"] } },
  ]);
  expect(JSON.stringify(ingest.requests)).not.toMatch(
    /private-model|private provider|private-registry|private-vibe/,
  );
});

it("setup completion with one installed and one outstanding target reports incomplete", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const fixture = await driverHomes(context, {
    first: { driver: "codex", config: { homePath: "~/first" } },
    other: { driver: "claudeAgent", config: { homePath: "~/other" } },
  });
  await mkdir(join(fixture.home, "first"));
  await fixture.factory.close();
  const factory = await fixture.harness.open({
    ...fixture.options,
    telemetry: { env: ingest.env },
  });
  await installFirstReportingTarget(factory);

  // Act
  assert((await factory.completeFirstRunSetup()).ok);
  await factory.close();

  // Assert
  expect(ingest.events("setup.completed")).toMatchObject([
    { properties: { t3Connection: "completed", agentInstallation: "incomplete" } },
  ]);
});

it("archiving while Finish is settling the other worker reports completion", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, racingEndingsFlow, { telemetry: { env: ingest.env } });
  const [first] = await twoWorkersStarted(ready.world, ready.input);
  await resultReported(ready.world, first, { message: "Delivered." });
  const reached = await endingReached(ready.world, first.runId);
  expect(reached.lifecycle).toBe("active");

  // Act
  assert((await ready.f.archiveRun(first.runId)).ok);
  await ready.f.close();

  // Assert
  expect(ingest.events("run.cancelled")).toHaveLength(0);
  expect(ingest.events("run.finished")).toMatchObject([{ properties: { status: "completed" } }]);
});
