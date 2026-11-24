import type { TestContext } from "@effect/vitest";
import { factoryMcpClient, toolReply } from "./factory-mcp.ts";
import { prepared } from "./prepared-runner.ts";
import {
  observeFor,
  resultReported,
  settled,
  workerAtWork,
  workerWorking,
  type ScenarioWorld,
  type WorkerHandle,
} from "./scenarios.ts";
import type { ControlledT3 } from "./controlled-t3.ts";

export const CONVERSATION = "conversation-thread";

export async function conversationRun(c: TestContext) {
  const fixture = await prepared(c);
  const worker = await workerAtWork(fixture.world, fixture.input);
  const t3: ControlledT3 = fixture.t3;
  t3.threads.recordStartCall(CONVERSATION, fixture.input.requestId);
  const client = await factoryMcpClient(c, fixture.f);
  return {
    ...fixture,
    worker,
    client,
    subscribe: async (threadId = CONVERSATION) =>
      client.callTool({
        name: "factory_subscribe_run_updates",
        arguments: { run: worker.runId, threadId },
      }),
  };
}

export async function subscribedRun(c: TestContext) {
  const run = await conversationRun(c);
  const reply = await run.subscribe();
  if (reply.isError) throw new Error(`Subscription refused: ${JSON.stringify(toolReply(reply))}`);
  return run;
}

export async function nativeQuestionAsked(run: {
  world: ScenarioWorld;
  t3: ControlledT3;
  worker: WorkerHandle;
}) {
  run.t3.threads.recordThreadFacts(run.worker.threadId, { pendingRequestCount: 1 });
  await observeFor("observe the native question", run.world, run.worker.runId, (detail) =>
    detail.attention.some((matter) => matter.kind === "native-request" && !matter.settledAt),
  );
}

export async function runSettled(run: {
  world: ScenarioWorld;
  t3: ControlledT3;
  worker: WorkerHandle;
}) {
  run.t3.threads.recordThreadFacts(run.worker.threadId, { pendingRequestCount: 0 });
  await settled(run.world, await resultReported(run.world, run.worker));
}

export async function returnedToActive(run: { world: ScenarioWorld; worker: WorkerHandle }) {
  await run.world.factory.runtime.submit(workerWorking(run.worker.blockId));
  await observeFor(
    "return to Active",
    run.world,
    run.worker.runId,
    (detail) => detail.lifecycle === "active",
  );
}

export function sentMessages(run: { t3: ControlledT3 }) {
  const sent: string[] = [];
  run.t3.threads.beforeSend = async (payload) => {
    sent.push(payload.message);
  };
  return sent;
}
