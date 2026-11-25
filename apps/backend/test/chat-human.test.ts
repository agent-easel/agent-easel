import { setTimeout as delay } from "node:timers/promises";
import { assert, expect, it } from "@effect/vitest";
import {
  answerCall,
  answeringWorld,
  confirmationAnswered,
  confirmed,
  confirmations,
  HUMAN_CONTEXT,
  occurrenceOf,
  statusCardsIn,
  proposed,
  reply,
  resolved,
} from "./support/chat-actions.ts";
import { servingAgain } from "./support/chat-control.ts";
import { PARTICIPANT_ID } from "./support/controlled-discord.ts";
import { invocation, toolResults } from "./support/chat-conversation.ts";
import { addedProject, startedRun } from "./support/chat-runs.ts";
import { appliedRun, subscribe, watchRun } from "./support/live.ts";

const ACCEPTED = "✅ Confirmed";
const REJECTED = "🚫 No longer valid";
const FEEDBACK = "Please handle the empty state too.";
const REQUEST = `request changes on #1: ${FEEDBACK}`;

it("a Human answer proposal reviews the Run, the exact occurrence with its complete context, the answer and the exact message with the requester's confirmation phrase last, and answers nothing", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const call = answerCall(world, {
    answer: "request-changes",
    message: FEEDBACK,
    messageSource: "requester-message",
  });

  // Act
  const confirmation = await proposed(world, "600000000000000001", 2, call, REQUEST);

  // Assert
  const [review, last] = world.discord.created;
  expect(review!.content).toMatch(
    new RegExp(
      [
        "^🙋 \\*\\*Answer a Human step\\?\\*\\*",
        `📌 Run #1 · Improve search · 📁 ${world.project.title} · \`${world.project.workspaceRoot}\``,
        "🧩 Review · waiting since <t:\\d+:R>",
        "↪️ From Entry worker · exit Done",
        "📄 Full context:",
        `\`\`\`\n${HUMAN_CONTEXT}\n\`\`\``,
        "✏️ \\*\\*Request changes\\*\\* with this message:",
        `\`\`\`\n${FEEDBACK}\n\`\`\``,
        "ℹ️ Answers exactly this occurrence\\. If it was answered or cancelled elsewhere meanwhile, AgentEasel answers nothing and never applies this answer to another one\\.$",
      ].join("\n"),
    ),
  );
  expect(last!.content).toMatch(
    new RegExp(
      `^🔒 <@${PARTICIPANT_ID}> To confirm, reply to this message with \`confirm [A-Z0-9]{4}\` · only the requester can confirm · expires <t:\\d+:R>$`,
    ),
  );
  expect(confirmations(world.discord)).toHaveLength(1);
  expect(confirmation.phrase).toMatch(/^confirm [ACDEFHJKMNPQRTWXY34679]{4}$/);
  expect(
    (await occurrenceOf(world.factory, world.runId, world.occurrence.id)).occurrence.state,
  ).toBe("pending");
});

it("a presented Human answer review makes its occurrence wait for the Discord confirmation until the review expires", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const before = Date.now();

  // Act
  await proposed(world, "600000000000000001", 2, answerCall(world), "approve #1");

  // Assert
  const until = async () =>
    (await occurrenceOf(world.factory, world.runId, world.occurrence.id)).occurrence
      .chatConfirmationUntil;
  await expect.poll(until).toBeTruthy();
  expect(Date.parse((await until())!)).toBeGreaterThan(before);
});

it("revoking the requester's Access ends the waiting Discord confirmation on an open Run page at once", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const live = subscribe(c, watchRun(world.factory.live, world.runId));
  await proposed(world, "600000000000000001", 2, answerCall(world), "approve #1");
  const confirmationOnPage = (messages: Parameters<typeof appliedRun>[0]) =>
    appliedRun(messages)?.humanOccurrences.find((entry) => entry.id === world.occurrence.id)
      ?.chatConfirmationUntil;
  await live.until((messages) => !!confirmationOnPage(messages));
  const settings = await world.factory.getDiscordSettings();
  assert(settings.ok, JSON.stringify(settings));

  // Act
  const revoked = await world.factory.updateDiscordAccess({
    revision: settings.value.access.revision,
    users: [],
    bots: [],
    channels: settings.value.access.channels,
  });

  // Assert
  assert(revoked.ok, JSON.stringify(revoked));
  // The page must not wait for an unrelated Run change, which this world makes only after a minute.
  const messages = await Promise.race([
    live.until((received) => !confirmationOnPage(received)),
    delay(10_000, []),
  ]);
  expect(confirmationOnPage(messages)).toBeNull();
});

it("the requester's confirmation answers exactly the reviewed occurrence of a Run started in AgentEasel and posts the receipt in the request thread without giving the Run an origin", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const confirmation = await proposed(
    world,
    "600000000000000001",
    2,
    answerCall(world),
    "approve #1",
  );

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ACCEPTED);
  const { occurrence, handoffs } = await occurrenceOf(
    world.factory,
    world.runId,
    world.occurrence.id,
  );
  expect(occurrence).toMatchObject({ state: "answered", exitId: "approve" });
  expect(handoffs).toHaveLength(1);
  await world.discord.createdMessages(3);
  expect(world.discord.created[2]!.content).toBe(
    "✅ **Approve accepted** — 🧩 Review · Run #1 · Improve search",
  );
  expect(statusCardsIn(world.discord)).toStrictEqual([]);
});

it("an identical answer given in AgentEasel meanwhile is not this action's: the confirmation is rejected and the receipt says nothing was answered", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const confirmation = await proposed(
    world,
    "600000000000000001",
    2,
    answerCall(world),
    "approve #1",
  );
  const elsewhere = await world.factory.answerHumanOccurrence(world.occurrence.id, {
    exitId: "approve",
  });
  assert(elsewhere.ok, JSON.stringify(elsewhere));

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(REJECTED);
  await world.discord.createdMessages(3);
  expect(world.discord.created[2]!.content).toBe(
    "❌ **Answer not accepted** — 🧩 Review · Run #1 · Improve search\nThis occurrence was already answered or cancelled elsewhere.",
  );
  expect(
    (await occurrenceOf(world.factory, world.runId, world.occurrence.id)).handoffs,
  ).toHaveLength(1);
});

it("two confirmation replies racing on one Human answer review answer once and hand the answer on once", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const confirmation = await proposed(
    world,
    "600000000000000001",
    2,
    answerCall(world),
    "approve #1",
  );

  // Act
  reply(world.discord, confirmation, "610000000000000001");
  reply(world.discord, confirmation, "610000000000000002");

  // Assert
  expect(await resolved(world.discord, confirmation)).toBe(ACCEPTED);
  expect(await confirmationAnswered(world.discord, 1)).toMatch(
    /^(?:⏳|You already confirmed this review\.)/,
  );
  const { occurrence, handoffs } = await occurrenceOf(
    world.factory,
    world.runId,
    world.occurrence.id,
  );
  expect(occurrence.state).toBe("answered");
  expect(handoffs).toHaveLength(1);
});

it("a Human answer review presented before a backend restart is confirmed once after it", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const confirmation = await proposed(
    world,
    "600000000000000001",
    2,
    answerCall(world),
    "approve #1",
  );
  await world.factory.close();
  const reopened = await world.open();
  await servingAgain(world.discord, 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ACCEPTED);
  const { occurrence, handoffs } = await occurrenceOf(reopened, world.runId, world.occurrence.id);
  expect(occurrence).toMatchObject({ state: "answered", exitId: "approve" });
  expect(handoffs).toHaveLength(1);
});

it("a broad request without one identified occurrence gets no review, and the model is told to ask which one", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  world.model.script(
    { toolCalls: [{ name: "answer_human", input: { run: "#1", answer: "approve" } }] },
    { text: "Which Human step?" },
  );

  // Act
  world.discord.deliver(invocation("600000000000000001", { content: "approve this Run" }));

  // Assert
  await world.discord.createdMessages(1);
  expect(confirmations(world.discord)).toHaveLength(0);
  expect(toolResults(world.model, 1)).toStrictEqual([
    {
      error: "invalid_arguments",
      message:
        "occurrenceId must name the one pending Human occurrence read_run lists. When several are pending, ask the requester which one; never answer more than one.",
    },
  ]);
});

it("Request changes without feedback gets no review and nothing is invented", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  world.model.script(answerCall(world, { answer: "request-changes" }), { text: "What changes?" });

  // Act
  world.discord.deliver(invocation("600000000000000001", { content: "request changes on #1" }));

  // Assert
  await world.discord.createdMessages(1);
  expect(confirmations(world.discord)).toHaveLength(0);
  expect(toolResults(world.model, 1)[0]!.message).toBe(
    "Request changes needs the requester's feedback. Ask for the exact text; never invent it.",
  );
});

it("a Human context beyond the 32,000-character review cannot be confirmed in chat and is never cut", async (c) => {
  // Arrange
  const world = await answeringWorld(c, "Review this change line by line.\n".repeat(1000));
  world.model.script(answerCall(world), { text: "Too long for chat." });

  // Act
  world.discord.deliver(invocation("600000000000000001", { content: "approve #1" }));

  // Assert
  await world.discord.createdMessages(1);
  expect(confirmations(world.discord)).toHaveLength(0);
  expect(toolResults(world.model, 1)[0]!.error).toBe("review_too_long");
});

it("an answer for a Run of a Project the thread does not permit is refused like a Run that does not exist", async (c) => {
  // Arrange
  const world = await answeringWorld(c);
  const other = await addedProject(world, "other-clone");
  const run = await startedRun(world, {
    requestId: "other-project-run",
    title: "Other work",
    createdAt: "2026-11-07T09:00:00.000Z",
    projectId: other.id,
  });
  world.model.script(answerCall(world, { run: run.id }), { text: "Not found." });

  // Act
  world.discord.deliver(invocation("600000000000000001", { content: `approve ${run.id}` }));

  // Assert
  await world.discord.createdMessages(1);
  expect(confirmations(world.discord)).toHaveLength(0);
  expect(toolResults(world.model, 1)[0]!.error).toBe("not_found");
});
