import { rm } from "node:fs/promises";
import { join } from "node:path";
import { assert, expect, it } from "@effect/vitest";
import { imageRequest, screenshots } from "./support/run-images.ts";
import { prepared } from "./support/prepared-runner.ts";
import {
  fanOutFlow,
  handoffFlow,
  imageDispatchHeld,
  resultReported,
  sha256Hex,
  workerAtWork,
} from "./support/scenarios.ts";

const attachmentNames = ["image-1-screenshot.png", "image-2-screenshot.png", "image-3-mockup.png"];
const digests = [screenshots.red, screenshots.blue, screenshots.green].map((image) =>
  sha256Hex(image.data),
);

it("every Flow-input worker receives the same original images, uploaded anew for its launch", async (c) => {
  // Arrange
  const f = await prepared(c, fanOutFlow);
  assert((await f.f.startRun(await imageRequest(f))).ok);

  // Act
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const launches = [...f.t3.threads.launches.values()].map((launch) => launch.payload);
  expect(launches.map((launch) => launch.title)).toStrictEqual([
    "F#1 Entry worker · Improve search",
    "F#1 Second entry · Improve search",
  ]);
  expect(launches.map((launch) => launch.attachments?.map((a) => a.name))).toStrictEqual([
    attachmentNames,
    attachmentNames,
  ]);
  const uploadedDigests = launches.map((launch) =>
    launch.attachments?.map((a) => sha256Hex(f.t3.threads.uploads.get(a.id)!.data)),
  );
  expect(uploadedDigests).toStrictEqual([digests, digests]);
  expect(new Set(launches.flatMap((launch) => launch.attachments!.map((a) => a.id))).size).toBe(6);
  expect(launches[0]!.message).toContain(
    "Initial prompt images are attached to this message as image-1-screenshot.png, image-2-screenshot.png, image-3-mockup.png; references like [Image N: name] in the initial prompt point to them.",
  );
});

it("a failed image upload leaves the launch pending with the upload problem and launches nothing", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const f = { ...setup, ...(await imageDispatchHeld(setup.world, await imageRequest(setup))) };
  f.t3.threads.failUploads = true;
  f.release();

  // Act
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(f.t3.threads.launchCalls).toBe(0);
  expect(run.value.intents.map((intent) => [intent.state, intent.problem])).toStrictEqual([
    ["pending", "Image upload to T3 Code failed: T3 Code answered the upload with HTTP 500."],
    ["pending", "Image upload to T3 Code failed: T3 Code answered the upload with HTTP 500."],
  ]);
  expect(run.value.blocks.map((block) => [block.state, block.problem])).toStrictEqual([
    ["not-started", null],
    ["not-started", null],
    ["not-started", null],
  ]);
  expect(run.value.attention).toStrictEqual([]);
});

it("a pending image launch uploads its images again after restart once T3 Code accepts attachments", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const f = { ...setup, ...(await imageDispatchHeld(setup.world, await imageRequest(setup))) };
  f.t3.contract.support.attachmentLimit = null;
  f.release();
  assert((await f.f.reconcileRuns()).ok);
  await f.f.close();
  f.t3.contract.support.attachmentLimit = 8;
  const reopened = await f.h.open({ t3: f.t3, connectionRetryMs: 60_000 });

  // Act
  assert((await reopened.reconcileRuns()).ok);

  // Assert
  const launches = [...f.t3.threads.launches.values()].map((launch) => launch.payload);
  expect(launches.map((launch) => launch.attachments?.map((a) => a.name))).toStrictEqual([
    attachmentNames,
    attachmentNames,
  ]);
  expect(f.t3.threads.uploadCalls).toBe(6);
});

it("Run image bytes missing from AgentEasel storage cancel the launch with a Block error", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const f = { ...setup, ...(await imageDispatchHeld(setup.world, await imageRequest(setup))) };
  await rm(join(f.h.processHome, "images", digests[1]!));
  f.release();

  // Act
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(f.t3.threads.launchCalls).toBe(0);
  expect(run.value.intents.map((intent) => intent.state)).toStrictEqual(["cancelled", "cancelled"]);
  expect(run.value.blocks.slice(0, 2).map((block) => [block.state, block.problem])).toStrictEqual([
    ["error", "Run image missing from AgentEasel storage"],
    ["error", "Run image missing from AgentEasel storage"],
  ]);
});

it("an image launch with a lost acknowledgement is searched for, never uploaded or launched again", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const f = { ...setup, ...(await imageDispatchHeld(setup.world, await imageRequest(setup))) };
  f.t3.threads.loseLaunchReply = true;
  f.release();
  assert((await f.f.reconcileRuns()).ok);
  f.t3.threads.loseLaunchReply = false;

  // Act
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(f.t3.threads.launchCalls).toBe(2);
  expect(f.t3.threads.uploadCalls).toBe(6);
  expect(run.value.blocks.slice(0, 2).map((block) => block.threadId)).toStrictEqual([
    "thread-1",
    "thread-2",
  ]);
});

it("a downstream worker launches with a text-only message and no attachments", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, await imageRequest(setup));
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };

  // Act
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const launches = [...f.t3.threads.launches.values()].map((launch) => launch.payload);
  expect(launches.map((launch) => launch.title)).toStrictEqual([
    "F#1 Entry worker · Improve search",
    "F#1 Parallel work · Improve search",
  ]);
  expect(launches[1]!.attachments).toBeUndefined();
  expect(launches[1]!.message).not.toContain("Initial prompt images");
  expect(f.t3.threads.uploadCalls).toBe(3);
});
