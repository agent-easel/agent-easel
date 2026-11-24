import { assert, type TestContext } from "@effect/vitest";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { AgentEasel } from "../../src/index.ts";
import { ALLOWED_CHANNEL, discordBot, discordGuild } from "./chat-control.ts";
import { invocation, operatingService, THREAD } from "./chat-conversation.ts";
import { chatWorlds, runConversation } from "./chat-runs.ts";
import {
  messageEvent,
  PARTICIPANT_ID,
  type ControlledDiscord,
  type CreatedMessage,
} from "./controlled-discord.ts";
import { preparedService } from "./prepared-runner.ts";
import {
  humanReviewFlow,
  resultReleasedToHumanReview,
  resultReported,
  workerAtWork,
  type ReadyFlowShape,
} from "./scenarios.ts";

/**
 * An operating Chat control over a Factory that can start Runs (the prepared ready Flow of
 * `runConversation`). `open` reopens the same home against the same external worlds.
 */
export async function startingWorld(
  c: TestContext,
  shape?: ReadyFlowShape,
  telemetry?: Parameters<typeof runConversation>[2],
) {
  const fixture = await runConversation(c, shape, telemetry);
  const open = () =>
    fixture.h.open({
      t3: fixture.t3,
      reportingStateDirectory: join(fixture.h.processHome, "reporting-state"),
      discordApiUrl: fixture.discord.apiUrl,
      connectionRetryMs: 60_000,
    });
  return { ...fixture, factory: fixture.f, harness: fixture.h, open };
}

export type StartingWorld = Pick<
  Awaited<ReturnType<typeof startingWorld>>,
  "model" | "discord" | "project" | "flow"
>;

/**
 * The same operating world as `startingWorld`, built inside the test's Effect scope so TestClock
 * drives consent expiry and every other backend deadline. Operations return Effects.
 */
export const clockedStartingWorld = (c: TestContext, bots: readonly string[] = []) =>
  Effect.gen(function* () {
    const worlds = yield* Effect.promise(() => chatWorlds(c));
    const { factory, project, flow, t3 } = yield* preparedService(c, undefined, {
      discordApiUrl: worlds.discord.apiUrl,
    });
    yield* operatingService(factory, worlds, project.id, bots);
    return { ...worlds, factory, project, flow, t3 };
  });

/** The model's start_run call for the world's Project and Flow with `prompt`. */
export const startCall = (
  world: Pick<StartingWorld, "project" | "flow">,
  prompt: string,
  overrides: Record<string, unknown> = {},
) => ({
  toolCalls: [
    {
      name: "start_run",
      input: {
        projectId: world.project.id,
        flowId: world.flow.id,
        prompt,
        promptSource: "requester-message",
        ...overrides,
      },
    },
  ],
});

export const START_PROMPT = "Improve search\nKeep it accessible.";

export interface Confirmation {
  readonly messageId: string;
  readonly phrase: string;
}

const PHRASE = /`(confirm [A-Z0-9]{4})`/;
const RESOLUTION = /^(?:✅ Confirmed|⌛ Expired|↩️ Replaced|🚫 No longer valid)$/;

const confirmationIn = (message: CreatedMessage): Confirmation | undefined => {
  const phrase = PHRASE.exec(message.content)?.[1];
  return phrase === undefined ? undefined : { messageId: message.id, phrase };
};

const isConfirmation = (message: CreatedMessage) =>
  PHRASE.test(message.content) || RESOLUTION.test(message.content);

export const reviewShows = (discord: ControlledDiscord, confirmation: Confirmation) =>
  discord.created.find((message) => message.id === confirmation.messageId)!.content;

export async function resolved(discord: ControlledDiscord, confirmation: Confirmation) {
  await discord.messagesWhen((messages) =>
    messages.some(
      (message) => message.id === confirmation.messageId && RESOLUTION.test(message.content),
    ),
  );
  return reviewShows(discord, confirmation);
}

export const confirmations = (discord: ControlledDiscord) => discord.created.filter(isConfirmation);

/** The model asks for one mutation tool call. */
type MutationCall = { readonly toolCalls: readonly { name: string; input: unknown }[] };

export const proposedStart = (
  world: StartingWorld,
  id: string,
  messages: number,
  answer: MutationCall = startCall(world, START_PROMPT),
  content = `start this:\n${START_PROMPT}`,
) => proposed(world, id, messages, answer, content);

export async function proposed(
  world: Pick<StartingWorld, "model" | "discord">,
  id: string,
  messages: number,
  answer: MutationCall,
  content: string,
  author: Pick<Parameters<typeof messageEvent>[0], "authorId" | "authorIsBot"> = {},
) {
  world.model.script(answer);
  world.discord.deliver(invocation(id, { content, ...author }));
  await createdBesidesReports(world.discord, messages);
  const confirmation = confirmationIn(besidesReports(world.discord)[messages - 1]!);
  assert(confirmation !== undefined, "the last message asks for the confirmation phrase");
  return confirmation;
}

const CONFIRMATION_ANSWER =
  /^(?:🔒 Only the person|↪️ Nothing was done|🔤 That is not|🚫 This confirmation|⌛ This review|🚫 Chat control does not accept this confirmation|⚠️ AgentEasel could not (?:confirm your access|act on this)|⏳ AgentEasel is already|❓ AgentEasel cannot tell|You already confirmed)/;

const isConfirmationAnswer = (message: CreatedMessage) => CONFIRMATION_ANSWER.test(message.content);

export const confirmationAnswers = (discord: ControlledDiscord) =>
  discord.created.filter(isConfirmationAnswer).map((message) => message.content);

export async function confirmationAnswered(discord: ControlledDiscord, count: number) {
  await discord.createdWhere(isConfirmationAnswer, count);
  return confirmationAnswers(discord).at(-1)!;
}

async function outcome(discord: ControlledDiscord, confirmation: Confirmation, answers: number) {
  await discord.messagesWhen(
    (messages) =>
      messages.filter(isConfirmationAnswer).length >= answers ||
      messages.some(
        (message) => message.id === confirmation.messageId && RESOLUTION.test(message.content),
      ),
  );
  const shown = reviewShows(discord, confirmation);
  return RESOLUTION.test(shown) ? shown : confirmationAnswers(discord).at(-1)!;
}

export interface ReplyOptions {
  readonly userId?: string;
  readonly authorIsBot?: boolean;
  readonly text?: string;
  readonly asReply?: boolean;
  readonly replyTo?: string;
  readonly thread?: { readonly id: string };
}

export function reply(
  discord: ControlledDiscord,
  confirmation: Confirmation,
  id: string,
  options: ReplyOptions = {},
) {
  const channelId = options.thread?.id ?? THREAD;
  const target = options.replyTo ?? confirmation.messageId;
  const shown = discord.created.find((message) => message.id === target);
  discord.deliver(
    messageEvent({
      bot: discordBot,
      guildId: discordGuild.id,
      channelId,
      id,
      authorId: options.userId ?? PARTICIPANT_ID,
      authorIsBot: options.authorIsBot ?? false,
      content: options.text ?? confirmation.phrase,
      ...(options.asReply === false
        ? { mention: true }
        : {
            mention: false,
            replyTo: {
              id: target,
              channelId,
              authorId: discordBot.applicationId,
              authorIsBot: true,
              content: shown?.content ?? "An earlier message.",
            },
          }),
    }),
  );
}

export async function confirmed(
  discord: ControlledDiscord,
  confirmation: Confirmation,
  id: string,
  answers = 1,
  options: ReplyOptions = {},
) {
  reply(discord, confirmation, id, options);
  return outcome(discord, confirmation, answers);
}

/** Holds a confirmed Start at its T3 contract snapshot until the test releases it. */
export async function pendingStart(
  world: Pick<Awaited<ReturnType<typeof startingWorld>>, "discord" | "t3">,
  confirmation: Confirmation,
  options: ReplyOptions = {},
) {
  const { inspecting, release } = world.t3.contract.holdInspection();
  const answer = confirmed(world.discord, confirmation, "610000000000000090", 1, options);
  await inspecting;
  return { answer, release };
}

/** A reviewed Start in a private thread; only Discord membership changes in the consent tests. */
export async function privateStartingWorld(c: TestContext) {
  const world = await startingWorld(c);
  const thread = { id: "500000000000000090", parentId: ALLOWED_CHANNEL, private: true };
  world.discord.addThread({
    ...thread,
    guildId: discordGuild.id,
    name: "private work",
    members: [PARTICIPANT_ID],
  });
  world.model.script(startCall(world, START_PROMPT));
  world.discord.deliver(
    invocation("300000000000000090", {
      channelId: thread.id,
      content: `start this:\n${START_PROMPT}`,
    }),
  );
  await world.discord.createdMessages(2);
  const confirmation = confirmationIn(world.discord.created[1]!);
  assert(confirmation !== undefined);
  return { ...world, confirmation, replyOptions: { thread } };
}

/** The Runs Factory shows in navigation, as identity and title. */
export async function runsOf(factory: Pick<AgentEasel, "listRunNavigation">) {
  const navigation = await factory.listRunNavigation();
  assert(navigation.ok, JSON.stringify(navigation));
  return navigation.value.map((entry) => ({ number: entry.number, title: entry.title }));
}

const STATUS_CARD =
  /^(?:<@\d+> )?(?:_[^\n]+_\n\n)?\*\*Run [^\n]+\*\* · (?:🟢 Active|💤 Snoozed|✅ Settled|🗄️ Archived) · 🔀 /;
/** A status card or notice: its first line names the Run in bold, after an emoji for notices. */
const RUN_REPORT = /^(?:_[^\n]+_\n\n)?(?:\S+ (?:<@\d+> )?)?\*\*Run \S+ · [^\n]+\*\* /;

/** Whether Discord shows `message` as a Run's status card: its first line names the Run. */
export const isStatusCard = (message: Pick<CreatedMessage, "content">) =>
  STATUS_CARD.test(message.content);

/** The status cards Discord shows, in creation order. */
export const statusCardsIn = (discord: ControlledDiscord) => discord.created.filter(isStatusCard);

/** Whether Discord shows `message` as an attention or catch-up notice about a Run. */
export const isNotice = (message: Pick<CreatedMessage, "content">) =>
  RUN_REPORT.test(message.content) && !isStatusCard(message);

/** The notices Discord shows, in creation order. */
export const noticesIn = (discord: ControlledDiscord) => discord.created.filter(isNotice);

const isRunReport = (message: Pick<CreatedMessage, "content">) => RUN_REPORT.test(message.content);

/** Messages Factory created besides status cards and notices (reviews, receipts, replies), in order. */
export const besidesReports = (discord: ControlledDiscord) =>
  discord.created.filter((message) => !isRunReport(message));

/** Resolves once Factory created `count` messages besides status cards and notices. */
export const createdBesidesReports = (discord: ControlledDiscord, count: number) =>
  discord.createdWhere((message) => !isRunReport(message), count);

export const HUMAN_CONTEXT = "Review this change.\nCheck the empty state.";

/**
 * An operating Chat control over a Run started in Factory (Run #1) of the Human review Flow, whose
 * Review waits on its pending occurrence with the worker's result `context`.
 */
export async function answeringWorld(
  c: TestContext,
  context = HUMAN_CONTEXT,
  telemetry?: Parameters<typeof runConversation>[2],
) {
  const world = await startingWorld(c, humanReviewFlow, telemetry);
  const worker = await workerAtWork(world.world, world.input);
  await resultReported(world.world, worker, { message: context });
  const review = await resultReleasedToHumanReview(world.world, worker);
  return { ...world, runId: worker.runId, occurrence: review.occurrence };
}

/** The model's answer_human call for the world's pending occurrence of Run #1. */
export const answerCall = (
  world: { readonly occurrence: { readonly id: string } },
  input: Record<string, unknown> = {},
) => ({
  toolCalls: [
    {
      name: "answer_human",
      input: { run: "#1", occurrenceId: world.occurrence.id, answer: "approve", ...input },
    },
  ],
});

/** The occurrence `id` of the Run as Factory shows it now. */
export async function occurrenceOf(factory: Pick<AgentEasel, "getRun">, runId: string, id: string) {
  const run = await factory.getRun(runId);
  assert(run.ok, JSON.stringify(run));
  return {
    occurrence: run.value.humanOccurrences.find((entry) => entry.id === id)!,
    handoffs: run.value.intents.filter((intent) => intent.occurrenceId === id),
  };
}

/**
 * An operating Chat control over a working Run started in Factory (Run #1 “Improve search”) whose
 * worker thread is bound, so Archive requests its interruption.
 */
export async function archivingWorld(c: TestContext) {
  const world = await startingWorld(c);
  const worker = await workerAtWork(world.world, world.input);
  return { ...world, runId: worker.runId };
}

/** The model's archive_run call for Run #1. */
export const archiveCall = (input: Record<string, unknown> = {}) => ({
  toolCalls: [{ name: "archive_run", input: { run: "#1", ...input } }],
});

/** The Run's lifecycle as Factory shows it now. */
export async function lifecycleOf(factory: Pick<AgentEasel, "getRun">, runId: string) {
  const run = await factory.getRun(runId);
  assert(run.ok, JSON.stringify(run));
  return run.value.lifecycle;
}
