import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import type { Factory } from "../src/index.ts";
import {
  answerCall,
  answeringWorld,
  archiveCall,
  archivingWorld,
  clockedStartingWorld,
  confirmationAnswers,
  confirmations,
  confirmed,
  createdBesidesReports,
  isNotice,
  isStatusCard,
  lifecycleOf,
  proposed,
  proposedStart,
  reply,
  runsOf,
  resolved,
  startCall,
  START_PROMPT,
  startingWorld,
  type StartingWorld,
} from "./support/chat-actions.ts";
import { discordBot } from "./support/chat-control.ts";
import {
  answered,
  COLLABORATOR_ID,
  invocation,
  OTHER_THREAD,
  posted,
  THREAD,
  toolResults,
  until,
  userEnvelopes,
} from "./support/chat-conversation.ts";
import { PARTICIPANT_ID, type CreatedMessage } from "./support/controlled-discord.ts";
import { launchedWorkers, resultReported } from "./support/scenarios.ts";

const HERMES_ID = "200000000000000009";
const HERMES_MENTION = `<@${HERMES_ID}>`;
const hermes = { authorId: HERMES_ID, authorIsBot: true } as const;
const hermesReply = { userId: HERMES_ID, authorIsBot: true } as const;
const SENTINEL = "390000000000000001";
const LOOP_REFUSAL = /^Factory paused bot requests in this thread/;
const RATE_REFUSAL = /^Factory paused requests from this bot/;
const START_REJECTED = /^❌ \*\*Start not accepted\*\*/;

const namedReply = (target: CreatedMessage) => ({
  ...hermes,
  replyTo: { ...target, authorId: discordBot.applicationId, authorIsBot: true },
});

async function hermesListed(factory: Pick<Factory, "getDiscordSettings" | "updateDiscordAccess">) {
  const settings = await factory.getDiscordSettings();
  assert(settings.ok, JSON.stringify(settings));
  const saved = await factory.updateDiscordAccess({
    revision: settings.value.access.revision,
    users: [PARTICIPANT_ID, COLLABORATOR_ID],
    bots: [HERMES_ID],
    channels: settings.value.access.channels.map(({ channelId, projectIds }) => ({
      channelId,
      projectIds,
    })),
  });
  assert(saved.ok, JSON.stringify(saved));
}

const hermesProposedStart = (world: StartingWorld, id: string, messages = 2) =>
  proposed(
    world,
    id,
    messages,
    startCall(world, START_PROMPT),
    `start this:\n${START_PROMPT}`,
    hermes,
  );

it("a listed bot that mentions Factory gets a Start review that mentions it, and its exact-phrase Reply starts the Run in its thread", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await hermesProposedStart(world, "600000000000000001");
  const review = world.discord.created[1]!.content;

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1, hermesReply);

  // Assert
  expect(review).toMatch(new RegExp(`^🔒 ${HERMES_MENTION} To confirm`));
  expect(answer).toBe("✅ Confirmed");
  expect(await runsOf(world.factory)).toStrictEqual([{ number: 1, title: "Improve search" }]);
  await world.discord.createdWhere(isStatusCard, 1);
  expect(world.discord.created.find(isStatusCard)!.channelId).toBe(THREAD);
});

it("a listed bot's plain message and its reply to a Factory message are not admitted and never reach the language model", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);

  // Act
  world.discord.deliver(invocation("300000000000000001", { ...hermes, mention: false }));
  world.discord.deliver(invocation("300000000000000002", { ...hermes, replyToBot: true }));

  // Assert
  await answered(world.discord, SENTINEL, 1);
  expect(world.model.requests).toHaveLength(1);
  expect(userEnvelopes(world.model, 0).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it("webhook messages, unlisted bots and Factory's own messages are ignored even when they mention Factory", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);

  // Act
  world.discord.deliver(invocation("300000000000000001", { ...hermes, webhook: true }));
  world.discord.deliver(
    invocation("300000000000000002", { authorId: "200000000000000008", authorIsBot: true }),
  );
  world.discord.deliver(
    invocation("300000000000000003", { authorId: discordBot.applicationId, authorIsBot: true }),
  );

  // Assert
  await answered(world.discord, SENTINEL, 1);
  expect(world.model.requests).toHaveLength(1);
  expect(userEnvelopes(world.model, 0).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it("a bot's Reply to a status card is dropped even when it explicitly mentions Factory", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await hermesProposedStart(world, "600000000000000001");
  await confirmed(world.discord, confirmation, "610000000000000001", 1, hermesReply);
  await world.discord.createdWhere(isStatusCard, 1);
  const card = world.discord.created.find(isStatusCard)!;

  // Act
  world.discord.deliver(invocation("620000000000000001", namedReply(card)));

  // Assert
  await answered(world.discord, SENTINEL, 4);
  expect(world.model.requests).toHaveLength(2);
  expect(userEnvelopes(world.model, 1).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it("a bot's Reply to a Start receipt is dropped even when it explicitly mentions Factory", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await hermesProposedStart(world, "600000000000000001");
  assert((await world.factory.removeFlow(world.flow.id)).ok);
  await confirmed(world.discord, confirmation, "610000000000000001", 1, hermesReply);
  await world.discord.createdWhere(({ content }) => START_REJECTED.test(content), 1);
  const receipt = world.discord.created.find(({ content }) => START_REJECTED.test(content))!;

  // Act
  world.discord.deliver(invocation("620000000000000001", namedReply(receipt)));

  // Assert
  await answered(world.discord, SENTINEL, 4);
  expect(world.model.requests).toHaveLength(2);
  expect(userEnvelopes(world.model, 1).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it("a listed bot's phrase Reply to a person's review is dropped without an answer and leaves the person's consent usable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  reply(world.discord, confirmation, "610000000000000001", hermesReply);

  // Assert
  expect(await confirmed(world.discord, confirmation, "610000000000000002")).toBe("✅ Confirmed");
  expect(confirmationAnswers(world.discord)).toStrictEqual([]);
  expect(await runsOf(world.factory)).toStrictEqual([{ number: 1, title: "Improve search" }]);
});

it("a second Start proposal from the same bot leaves its original review confirmable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const original = await hermesProposedStart(world, "600000000000000001");
  const prompt = "Improve keyboard navigation.";
  world.model.script(startCall(world, prompt));

  // Act
  const replies = await answered(world.discord, "600000000000000002", 3, {
    ...hermes,
    content: `start this:\n${prompt}`,
  });

  // Assert
  expect(replies.at(-1)).toContain("already has a pending Start");
  expect(confirmations(world.discord)).toHaveLength(1);
  expect(await confirmed(world.discord, original, "610000000000000001", 1, hermesReply)).toBe(
    "✅ Confirmed",
  );
  expect(await runsOf(world.factory)).toStrictEqual([{ number: 1, title: "Improve search" }]);
});

it.effect("an expired Start review frees that bot's proposal slot", (c) =>
  Effect.gen(function* () {
    // Arrange
    const world = yield* clockedStartingWorld(c, [HERMES_ID]);
    const original = yield* until(() => hermesProposedStart(world, "600000000000000001"));
    yield* TestClock.adjust(5 * 60_000);
    expect(yield* until(() => resolved(world.discord, original))).toBe("⌛ Expired");

    // Act
    const next = yield* until(() => hermesProposedStart(world, "600000000000000002", 4));

    // Assert
    expect(next.messageId).not.toBe(original.messageId);
    expect(confirmations(world.discord)).toHaveLength(2);
  }),
);

it("the fourth consecutive bot turn gets one refusal without a mention, and the next stays silent", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  await answered(world.discord, "300000000000000001", 1, hermes);
  await answered(world.discord, "300000000000000002", 2, hermes);
  await answered(world.discord, "300000000000000003", 3, hermes);

  // Act
  world.discord.deliver(invocation("300000000000000004", hermes));
  world.discord.deliver(invocation("300000000000000005", hermes));

  // Assert
  const replies = await answered(world.discord, SENTINEL, 5);
  expect(replies).toStrictEqual(["OK", "OK", "OK", expect.stringMatching(LOOP_REFUSAL), "OK"]);
  expect(replies[3]).not.toContain("<@");
  expect(world.model.requests).toHaveLength(4);
  expect(userEnvelopes(world.model, 3).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it("a bot's model request limit applies across threads with one unmentioned refusal", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const elsewhere = { ...hermes, channelId: OTHER_THREAD };
  await answered(world.discord, "300000000000000001", 1, hermes);
  await answered(world.discord, "300000000000000002", 2, hermes);
  await answered(world.discord, "300000000000000003", 3, hermes);
  await answered(world.discord, "300000000000000004", 4, elsewhere);
  await answered(world.discord, "300000000000000005", 5, elsewhere);
  await answered(world.discord, "300000000000000006", 6, elsewhere);
  world.discord.deliver(invocation("300000000000000007", { mention: false }));

  // Act
  const replies = await answered(world.discord, "300000000000000008", 7, hermes);
  world.discord.deliver(invocation("300000000000000009", elsewhere));

  // Assert
  const throughSentinel = await answered(world.discord, SENTINEL, 8, {
    channelId: OTHER_THREAD,
  });
  expect(replies.at(-1)).toMatch(RATE_REFUSAL);
  expect(replies.at(-1)).not.toContain("<@");
  expect(throughSentinel.at(-1)).toBe("OK");
  expect(world.model.requests).toHaveLength(7);
  expect(userEnvelopes(world.model, 6).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it.effect("a bot can invoke Factory again when its model request window clears", (c) =>
  Effect.gen(function* () {
    // Arrange
    const { discord, model } = yield* clockedStartingWorld(c, [HERMES_ID]);
    const read = { toolCalls: [{ name: "list_projects", input: {} }] };
    model.script(read, read, read, read, read, read);
    const replies = yield* until(() => answered(discord, "300000000000000001", 1, hermes));
    expect(replies[0]).toMatch(RATE_REFUSAL);
    expect(model.requests).toHaveLength(6);
    yield* TestClock.adjust(60_000);

    // Act
    const afterWindow = yield* until(() => answered(discord, "300000000000000002", 2, hermes));

    // Assert
    expect(afterWindow.at(-1)).toBe("OK");
    expect(model.requests).toHaveLength(7);
  }),
);

it("after two Start proposals Factory pauses the bot before calling the model, while its pending review stays confirmable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const first = await hermesProposedStart(world, "600000000000000001");
  await confirmed(world.discord, first, "610000000000000001", 1, hermesReply);
  const second = await hermesProposedStart(world, "600000000000000002", 4);

  // Act
  world.discord.deliver(invocation("600000000000000003", hermes));
  await createdBesidesReports(world.discord, 5);

  // Assert
  const refusal = world.discord.created.find(({ content }) => RATE_REFUSAL.test(content));
  expect(refusal?.content).toMatch(RATE_REFUSAL);
  expect(refusal?.content).not.toContain("<@");
  expect(world.model.requests).toHaveLength(2);
  expect(await confirmed(world.discord, second, "610000000000000002", 1, hermesReply)).toBe(
    "✅ Confirmed",
  );
});

it("a human message without a mention clears the thread's bot breaker", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  await answered(world.discord, "300000000000000001", 1, hermes);
  await answered(world.discord, "300000000000000002", 2, hermes);
  await answered(world.discord, "300000000000000003", 3, hermes);
  await answered(world.discord, "300000000000000004", 4, hermes);

  // Act
  world.discord.deliver(invocation("300000000000000005", { mention: false }));

  // Assert
  const replies = await answered(world.discord, "300000000000000006", 5, hermes);
  expect(replies.slice(-2)).toStrictEqual([expect.stringMatching(LOOP_REFUSAL), "OK"]);
  expect(world.model.requests).toHaveLength(4);
});

it("an accepted Start clears the breaker even when the exact confirmation arrives after the refusal", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  await answered(world.discord, "300000000000000001", 1, hermes);
  await answered(world.discord, "300000000000000002", 2, hermes);
  const proposal = await hermesProposedStart(world, "600000000000000001", 4);
  const replies = await answered(world.discord, "300000000000000003", 5, hermes);
  expect(replies.at(-1)).toMatch(LOOP_REFUSAL);
  reply(world.discord, proposal, "610000000000000001", {
    ...hermesReply,
    replyTo: world.discord.created[2]!.id,
  });

  // Act
  const result = await confirmed(world.discord, proposal, "610000000000000002", 1, hermesReply);

  // Assert
  expect(result).toBe("✅ Confirmed");
  expect(confirmationAnswers(world.discord)).toStrictEqual([]);
  await world.discord.createdWhere(isStatusCard, 1);
  world.discord.deliver(invocation("300000000000000004", hermes));
  expect((await posted(world.discord, 7)).at(-1)).toBe("OK");
  expect(world.model.requests).toHaveLength(4);
});

it("a listed bot cannot propose a Human answer: the model is refused and no review is posted", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  await hermesListed(world.factory);
  world.model.script(answerCall(world), { text: "Only a person can answer this." });

  // Act
  world.discord.deliver(invocation("600000000000000001", { ...hermes, content: "approve #1" }));

  // Assert
  await world.discord.createdMessages(1);
  expect(toolResults(world.model, 1)[0]!.error).toBe("requester_not_permitted");
  expect(confirmations(world.discord)).toStrictEqual([]);
});

it("a listed bot cannot propose an Archive: the model is refused, no review is posted and the Run stays active", async (c) => {
  // Arrange
  const world = await archivingWorld(c);
  await hermesListed(world.factory);
  world.model.script(archiveCall(), { text: "Only a person can archive this." });

  // Act
  world.discord.deliver(invocation("600000000000000001", { ...hermes, content: "archive #1" }));

  // Assert
  await world.discord.createdMessages(1);
  expect(toolResults(world.model, 1)[0]!.error).toBe("requester_not_permitted");
  expect(confirmations(world.discord)).toStrictEqual([]);
  expect(await lifecycleOf(world.factory, world.runId)).toBe("active");
});

async function reportedBotRun(c: Parameters<typeof startingWorld>[0]) {
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await hermesProposedStart(world, "600000000000000001");
  await confirmed(world.discord, confirmation, "610000000000000001", 1, hermesReply);
  const navigation = await world.factory.listRunNavigation();
  assert(navigation.ok, JSON.stringify(navigation));
  const { workers } = await launchedWorkers(world.world, navigation.value[0]!.id);
  await resultReported(world.world, workers[0]!, { message: "Implemented the requested result." });
  return world;
}

it("a bot-started Run's notices go to the requesting thread and mention the bot", async (c) => {
  // Arrange
  const world = await reportedBotRun(c);

  // Act
  assert((await world.factory.reconcileRuns()).ok);

  // Assert
  await world.discord.createdWhere(isNotice, 1);
  const notice = world.discord.created.find(isNotice)!;
  expect(notice.channelId).toBe(THREAD);
  expect(notice.content).toContain(HERMES_MENTION);
  expect(world.discord.requested("POST", /\/messages$/)).toContainEqual(
    expect.objectContaining({
      body: expect.objectContaining({
        content: notice.content,
        allowed_mentions: { parse: [], users: [HERMES_ID] },
      }),
    }),
  );
});

it("a bot's Reply to a Run notice is dropped even when it explicitly mentions Factory", async (c) => {
  // Arrange
  const world = await reportedBotRun(c);
  assert((await world.factory.reconcileRuns()).ok);
  await world.discord.createdWhere(isNotice, 1);
  const notice = world.discord.created.find(isNotice)!;

  // Act
  world.discord.deliver(invocation("620000000000000001", namedReply(notice)));

  // Assert
  await answered(world.discord, SENTINEL, 5);
  expect(world.model.requests).toHaveLength(2);
  expect(userEnvelopes(world.model, 1).at(-1)!.from).toBe(`discord-user:${PARTICIPANT_ID}`);
});

it("an allowed person still talks to Factory in a thread where a bot is conversing", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  await answered(world.discord, "300000000000000001", 1, { ...hermes, content: "list Flows" });

  // Act
  const replies = await answered(world.discord, "300000000000000002", 2, {
    content: "what can I start?",
  });

  // Assert
  expect(replies).toStrictEqual(["OK", "OK"]);
  expect(userEnvelopes(world.model, 1).at(-1)).toStrictEqual(
    expect.objectContaining({
      from: `discord-user:${PARTICIPANT_ID}`,
      message: expect.stringContaining("what can I start?"),
    }),
  );
});

it("an Access save that keeps the bot listed leaves its pending Start review confirmable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await hermesProposedStart(world, "600000000000000001");

  // Act
  await hermesListed(world.factory);

  // Assert
  expect(await confirmed(world.discord, confirmation, "610000000000000001", 1, hermesReply)).toBe(
    "✅ Confirmed",
  );
});
