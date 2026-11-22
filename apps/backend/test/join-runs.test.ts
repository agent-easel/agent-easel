import { expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { launchedBlockId } from "./support/run-worker.ts";
import {
  joinedEndingFlow,
  workerAtWork,
  workerHandle,
  reviewApproved,
  resultReleasedToHumanReview,
  parallelJoinFlow,
  twoWorkersStarted,
  turnBegins,
  resultReported,
  observeFor,
} from "./support/scenarios.ts";

it("a round combines both messages in captured order and releases one workerless delivery per recipient", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, second, { message: "Second." });
  const waiting = await observeFor("second source waiting", f.world, first.runId, (run) =>
    run.blocks.some((b) => b.blockId === "merge" && b.state === "waiting"),
  );

  // Act
  await resultReported(f.world, first, { message: "First.\n```\n## Forged" });
  const run = await observeFor(
    "joined deliveries",
    f.world,
    first.runId,
    (run) =>
      run.humanOccurrences.length === 2 &&
      run.blocks.some((b) => b.blockId === "follow-up" && b.threadId !== null),
  );

  // Assert
  const feedback =
    "Join round 1\n\n## Entry worker — Done\n\n````\nFirst.\n```\n## Forged\n````\n\n## Second entry — Done\n\n```\nSecond.\n```";
  expect(waiting.humanOccurrences).toHaveLength(0);
  expect(run.humanOccurrences.map((h) => h.context)).toEqual([feedback, feedback]);
  expect(run.conditions[0]?.arrivals).toBe(1);
  expect(
    run.intents.filter((intent) => intent.blockId === "merge").map((i) => i.payloadRetained),
  ).toEqual([false, false]);
  expect(
    await f.f.runtime.block({ arguments: { blockId: launchedBlockId(f.t3, "Follow-up") } }),
  ).toMatchObject({ reason: "Join", inputs: { results: [], feedback } });
});

it("a restart preserves a fast source's extra arrival and the next round pairs the oldest remaining messages", async (c) => {
  // Arrange
  const f = await prepared(c, parallelJoinFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "A1" });
  await observeFor("first queued", f.world, first.runId, (r) =>
    r.blocks.some((b) => b.blockId === "merge" && b.state === "waiting"),
  );
  const revised = turnBegins(f.world, first, "another-review");
  await resultReported(f.world, revised, { message: "A2", exit: "Revise" });
  await observeFor(
    "second queued",
    f.world,
    first.runId,
    (r) =>
      r.intents.filter((i) => i.blockId === "merge" && i.state === "acknowledged").length === 2,
  );

  await f.reopen();
  await resultReported(f.world, second, { message: "B1" });
  const one = await observeFor(
    "first pair",
    f.world,
    first.runId,
    (r) =>
      r.humanOccurrences.length === 2 &&
      r.blocks.some((b) => b.blockId === "follow-up" && b.executionId),
  );
  const recipient = workerHandle(f.world, one, "follow-up");
  await f.t3.threads.recordLaunchedThread(recipient.threadId);
  await resultReported(f.world, recipient, { message: "Reviewed." });

  const later = turnBegins(f.world, second, "another-second");

  // Act
  await resultReported(f.world, later, { message: "B2", exit: "Revise" });
  const two = await observeFor(
    "second pair",
    f.world,
    first.runId,
    (r) =>
      r.humanOccurrences.length === 4 &&
      r.intents.some(
        (i) => i.blockId === "follow-up" && i.kind === "send" && i.state === "acknowledged",
      ),
  );

  // Assert
  expect(one.humanOccurrences[0]?.context).toMatch(/Join round 1[\s\S]*A1[\s\S]*B1/);
  expect(two.humanOccurrences[2]?.context).toMatch(/Join round 2[\s\S]*Revise[\s\S]*A2[\s\S]*B2/);
  expect(two.conditions[0]?.arrivals).toBe(2);
  expect(
    await f.f.runtime.block({ arguments: { blockId: launchedBlockId(f.t3, "Follow-up") } }),
  ).toMatchObject({
    reason: "Join",
    visit: 2,
    revisitInstruction: "Compare the revisions.",
    inputs: { feedback: two.humanOccurrences[2]?.context, results: [] },
  });
});

it("an empty approval fills its source slot and Finish records the Join as writer", async (c) => {
  // Arrange
  const f = await prepared(c, joinedEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "Ready." });
  const review = await resultReleasedToHumanReview(f.world, worker);

  // Act
  await reviewApproved(f.world, review);
  const run = await observeFor(
    "reached joined ending",
    f.world,
    worker.runId,
    (detail) => detail.result !== null,
  );

  // Assert
  expect(run.result).toMatchObject({
    sourceBlockId: "merge",
    authorBlockId: "merge",
    exitId: "output",
    origin: null,
    output:
      "Join round 1\n\n## Entry worker (1) — Done\n\n```\nReady.\n```\n\n## Entry worker (2) — Approve\n\n```\n(no message)\n```",
  });
});
