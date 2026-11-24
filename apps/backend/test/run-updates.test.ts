import { expect, it } from "@effect/vitest";
import { T3Failure } from "../src/t3/connection.ts";
import { toolReply } from "./support/factory-mcp.ts";
import {
  CONVERSATION,
  conversationRun,
  nativeQuestionAsked,
  returnedToActive,
  runSettled,
  sentMessages,
  subscribedRun,
} from "./support/run-updates.ts";
import { archived, workerWorking } from "./support/scenarios.ts";

it("a conversation whose own T3 activity records the Start call binds the Run's updates to itself", async (c) => {
  // Arrange
  const run = await conversationRun(c);

  // Act
  const result = await run.subscribe();

  // Assert
  expect(result.isError).toBe(false);
  expect(toolReply(result)).toMatchObject({
    status: "subscribed",
    run: { id: run.worker.runId, number: 1 },
    destination: { threadId: CONVERSATION },
  });
});

it("a thread whose T3 activity does not record the Run's Start call is refused as an unverified origin", async (c) => {
  // Arrange
  const run = await conversationRun(c);

  // Act
  const result = await run.subscribe("guessed-thread");

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "validation",
    issues: [{ code: "origin_unverified", path: "threadId" }],
  });
});

it("a Run whose updates go to one conversation refuses another, so updates never move", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  run.t3.threads.recordStartCall("second-conversation", run.input.requestId);

  // Act
  const result = await run.subscribe("second-conversation");

  // Assert
  expect(result.isError).toBe(true);
  expect(toolReply(result)).toMatchObject({
    code: "conflict",
    issues: [{ code: "updates_bound_elsewhere" }],
  });
});

it("a bound Run that newly needs input queues one update in its conversation with only the Run reference and the event", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  const sent = run.t3.threads.nextSend();

  // Act
  await nativeQuestionAsked(run);

  // Assert
  const update = await sent;
  expect(update).toMatchObject({
    threadId: CONVERSATION,
    mode: "queue",
    environmentId: run.t3.connection.environmentId,
  });
  expect(update.message).toContain(
    `Factory Run #1 (id ${run.worker.runId}) needs input (1 matter).`,
  );
  expect(update.message).toContain('factory_read_run({"run":"#1"})');
  expect(update.message).not.toContain("Improve search");
});

it("a bound Run's confirmed settlement queues one settlement update in its conversation", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  const sent = run.t3.threads.nextSend();

  // Act
  await runSettled(run);

  // Assert
  expect((await sent).message).toContain(
    `Factory Run #1 (id ${run.worker.runId}) settled automatically.`,
  );
});

it("an update whose acknowledgement was lost is never sent again, also after a restart", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  run.t3.threads.loseSendReply = true;
  const lost = run.t3.threads.nextSend();
  await nativeQuestionAsked(run);
  await lost;
  await run.reopen();
  run.t3.threads.loseSendReply = false;
  const sends: string[] = [];
  run.t3.threads.beforeSend = async (payload) => {
    sends.push(payload.message);
  };
  const settlement = run.t3.threads.nextSend();

  // Act
  await runSettled(run);

  // Assert
  await settlement;
  expect(sends).toHaveLength(1);
  expect(sends[0]).toContain("settled automatically");
});

it("an update T3 refuses is not sent again or to another conversation", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  run.t3.threads.refusedSendThreads.add(CONVERSATION);
  const sends: string[] = [];
  const refused = new Promise<void>((resolve) => {
    run.t3.threads.beforeSend = async (payload) => {
      sends.push(payload.threadId);
      resolve();
    };
  });
  await nativeQuestionAsked(run);
  await refused;
  run.t3.threads.refusedSendThreads.delete(CONVERSATION);
  const settlement = run.t3.threads.nextSend();

  // Act
  await runSettled(run);

  // Assert
  await settlement;
  expect(sends).toStrictEqual([CONVERSATION, CONVERSATION]);
  expect([...run.t3.threads.sends.values()].map(({ payload }) => payload.message)).toStrictEqual([
    expect.stringContaining("settled automatically"),
  ]);
});

it("a T3 activity read that does not complete binds nothing and may be retried", async (c) => {
  // Arrange
  const run = await conversationRun(c);
  run.t3.threads.beforeFindStartCall = async () => {
    throw new T3Failure("unavailable", "No reply");
  };

  // Act
  const result = await run.subscribe();

  // Assert
  expect(toolReply(result)).toMatchObject({
    code: "conflict",
    issues: [{ code: "t3_unavailable" }],
  });
});

it("a Run Archived while its origin is being verified is refused instead of bound", async (c) => {
  // Arrange
  const run = await conversationRun(c);
  run.t3.threads.beforeFindStartCall = async () => {
    await archived(run.world, run.worker);
  };

  // Act
  const result = await run.subscribe();

  // Assert
  expect(toolReply(result)).toMatchObject({
    code: "validation",
    issues: [{ code: "run_archived" }],
  });
});

it("a settlement still waiting to be sent is not sent once the Run is Active again", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  run.t3.threads.beforeSend = async () => {
    throw new T3Failure("authorization-required", "Grant rejected");
  };
  await runSettled(run);
  await returnedToActive(run);
  const sent = sentMessages(run);
  const attention = run.t3.threads.nextSend();

  // Act
  await nativeQuestionAsked(run);

  // Assert
  await attention;
  expect(sent).toStrictEqual([expect.stringContaining("needs input")]);
});

it("an update T3 rejected for its grant waits and is sent once after reauthorization", async (c) => {
  // Arrange
  const run = await subscribedRun(c);
  const rejected = new Promise<void>((resolve) => {
    run.t3.threads.beforeSend = async () => {
      resolve();
      throw new T3Failure("authorization-required", "Grant rejected");
    };
  });
  await nativeQuestionAsked(run);
  await rejected;
  const sent = sentMessages(run);
  const retried = run.t3.threads.nextSend();

  // Act
  await run.world.factory.runtime.submit(workerWorking(run.worker.blockId, "Still here"));

  // Assert
  await retried;
  expect(sent).toStrictEqual([expect.stringContaining("needs input")]);
});
