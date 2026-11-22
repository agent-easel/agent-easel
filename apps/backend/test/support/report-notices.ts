import { assert } from "@effect/vitest";
import { isNotice, noticesIn, type startingWorld } from "./chat-actions.ts";
import { COLLABORATOR_ID, savedAccess, THREAD } from "./chat-conversation.ts";
import { addedProject } from "./chat-runs.ts";
import { type ControlledDiscord, type MessageFault, PARTICIPANT_ID } from "./controlled-discord.ts";
import {
  observeFor,
  settleUnresolved,
  type ScenarioWorld,
  type WorkerHandle,
} from "./scenarios.ts";
import { chatStartedRun } from "./status-cards.ts";

type World = Awaited<ReturnType<typeof startingWorld>>;
const MESSAGES = new RegExp(`^/api/v10/channels/${THREAD}/messages$`);

export async function pausedAttentionCreate(
  world: World,
  fault: Extract<MessageFault, `paused${string}`>,
) {
  const started = await chatStartedRun(world);
  const ordinal = world.discord.requested("POST", MESSAGES).length + 1;
  world.discord.faultMessages(fault);
  await nativeRequestShown(world.world, started.worker);
  return { ...started, ordinal };
}

export async function revokedNoticeCreate(world: World, runId: string, ordinal: number) {
  await world.discord.request("POST", MESSAGES, ordinal);
  const other = await addedProject({ f: world.factory, h: world.harness }, "other");
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [other.id]);
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id, other.id]);
  assert((await world.factory.snoozeRun(runId)).ok);
}

export async function pausedSettlementProblem(world: World, worker: WorkerHandle) {
  const ordinal = world.discord.requested("POST", MESSAGES).length + 1;
  world.discord.faultMessages("paused");
  await settleUnresolved(world.world, worker);
  await world.discord.request("POST", MESSAGES, ordinal);
}

/** Resolves with the `ordinal`-th notice Discord shows (1 is the first) once it exists. */
export async function noticeCreated(discord: ControlledDiscord, ordinal = 1) {
  await discord.createdWhere(isNotice, ordinal);
  return noticesIn(discord)[ordinal - 1]!;
}

/** A notice's text without the machine line that closes it. */
export const prose = (content: string) => content.split("\n").slice(0, -1).join("\n");

/** The versioned record on the single machine line that closes an attention, completion or Archive notice. */
export function machineRecord(content: string) {
  const line = content.split("\n").at(-1)!;
  assert(/^`\{.*\}`$/.test(line), `no machine line closes: ${content}`);
  return JSON.parse(line.slice(1, -1)) as Record<string, unknown>;
}

const pendingNativeRequest = (run: Awaited<ReturnType<typeof observeFor>>) =>
  run.attention.some((matter) => matter.kind === "native-request" && matter.settledAt === null);

/** T3 shows a pending native request in the worker's thread and Factory observed it. */
export async function nativeRequestShown(world: ScenarioWorld, worker: WorkerHandle) {
  world.t3.threads.recordThreadFacts(worker.threadId, { pendingRequestCount: 1 });
  await observeFor("observe the native request", world, worker.runId, pendingNativeRequest);
}

/** The request was answered in T3, which shows none pending, and Factory settled it. */
export async function nativeRequestAnswered(world: ScenarioWorld, worker: WorkerHandle) {
  world.t3.threads.recordThreadFacts(worker.threadId, { pendingRequestCount: 0 });
  await observeFor(
    "observe the native request answered",
    world,
    worker.runId,
    (run) => !pendingNativeRequest(run),
  );
}
