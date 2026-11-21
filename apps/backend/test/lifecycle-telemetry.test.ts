import { assert, expect, it } from "@effect/vitest";
import { factoryHarness } from "./support/factory.ts";
import { mockIngest } from "./support/telemetry.ts";
import { prepared } from "./support/prepared-runner.ts";
import {
  allTurnsEnd,
  resultReleasedToWait,
  resultReported,
  settled,
  waitFlow,
  workerAtWork,
} from "./support/scenarios.ts";
import { ControlledT3 } from "./support/controlled-t3.ts";

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

it("starting, continuing and cancelling a Run sends only its anonymous lifecycle fields", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context, waitFlow);
  await ready.f.close();
  const customModel = "private custom model sentinel";
  ready.t3.projects.controlledProviders.push({
    providerInstanceId: "private instance sentinel",
    driverKind: "private driver sentinel",
    displayName: "private provider sentinel",
    models: [{ id: customModel, label: customModel }],
  });
  const factory = await ready.h.open({ t3: ready.t3, telemetry: { env: ingest.env } });
  const world = { ...ready.world, factory };
  const prompt = "private prompt sentinel";
  const title = "private title sentinel";
  const atWork = await workerAtWork(world, { ...ready.input, input: prompt, title });
  await resultReported(world, atWork);
  const waiting = await resultReleasedToWait(world, atWork);

  // Act
  assert((await factory.continueWaitArrival(waiting.arrival.id)).ok);
  assert((await factory.archiveRun(atWork.runId)).ok);
  assert((await factory.archiveRun(atWork.runId)).ok);
  await factory.close();

  // Assert
  const payload = JSON.stringify(ingest.requests);
  expect(ingest.requests[0]).toMatchObject({
    path: "/ingest/batch/",
    method: "POST",
    body: {
      batch: expect.arrayContaining([
        expect.objectContaining({
          event: "t3.connected",
          properties: expect.objectContaining({ mode: "local", driverKinds: ["codex"] }),
        }),
        expect.objectContaining({
          event: "run.started",
          properties: expect.objectContaining({
            source: "manual",
            flowScope: "global",
            blockCount: "2-5",
            hasImages: false,
            blockTypes: ["agent", "wait", "finish"],
          }),
        }),
        expect.objectContaining({ event: "run.continued" }),
        expect.objectContaining({ event: "run.cancelled" }),
        expect.objectContaining({
          event: "run.finished",
          properties: expect.objectContaining({
            status: "cancelled",
            executedBlockCount: "2-5",
            hadHumanWait: true,
            usedContinuation: false,
          }),
        }),
      ]),
    },
  });
  expect(payload.match(/"event":"t3.connected"/g)).toHaveLength(1);
  expect(payload.match(/"event":"run.cancelled"/g)).toHaveLength(1);
  expect(payload.match(/"event":"run.finished"/g)).toHaveLength(1);
  expect(payload).not.toContain("private driver sentinel");
  expect(payload).not.toContain(customModel);
  expect(payload).not.toContain(prompt);
  expect(payload).not.toContain(title);
  expect(payload).not.toContain(ready.project.workspaceRoot);
  expect(payload).not.toContain(ready.project.title);
  expect(payload).not.toContain(JSON.stringify(ready.flow.name));
  expect(payload).not.toContain(JSON.stringify(ready.agent.name));
});

it("automatic settlement sends one completed event even if the settled Run is later archived", async (context) => {
  // Arrange
  const ingest = await mockIngest(context);
  const ready = await prepared(context);
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
