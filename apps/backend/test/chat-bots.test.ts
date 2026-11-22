import { assert, expect, it } from "@effect/vitest";
import type { Factory } from "../src/index.ts";
import {
  answerCall,
  answeringWorld,
  archiveCall,
  archivingWorld,
  confirmationAnswers,
  confirmations,
  confirmed,
  isNotice,
  isStatusCard,
  lifecycleOf,
  proposed,
  proposedStart,
  reply,
  runsOf,
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
  THREAD,
  toolResults,
  userEnvelopes,
} from "./support/chat-conversation.ts";
import { PARTICIPANT_ID } from "./support/controlled-discord.ts";
import { launchedWorkers, resultReported } from "./support/scenarios.ts";

const HERMES_ID = "200000000000000009";
const HERMES_MENTION = `<@${HERMES_ID}>`;
const hermes = { authorId: HERMES_ID, authorIsBot: true } as const;
const hermesReply = { userId: HERMES_ID, authorIsBot: true } as const;
const SENTINEL = "390000000000000001";

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

it("a bot-started Run's notices go to the requesting thread and mention the bot", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await hermesListed(world.factory);
  const confirmation = await hermesProposedStart(world, "600000000000000001");
  await confirmed(world.discord, confirmation, "610000000000000001", 1, hermesReply);
  const navigation = await world.factory.listRunNavigation();
  assert(navigation.ok, JSON.stringify(navigation));
  const { workers } = await launchedWorkers(world.world, navigation.value[0]!.id);
  await resultReported(world.world, workers[0]!, { message: "Implemented the requested result." });

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
