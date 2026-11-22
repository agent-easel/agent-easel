import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import {
  confirmationAnswered,
  besidesReports,
  clockedStartingWorld,
  confirmationAnswers,
  confirmed,
  createdBesidesReports,
  confirmations,
  isStatusCard,
  proposedStart,
  pendingStart,
  privateStartingWorld,
  reply,
  resolved,
  type Confirmation,
  type ReplyOptions,
  reviewShows,
  runsOf,
  START_PROMPT,
  startCall,
  startingWorld,
  statusCardsIn,
} from "./support/chat-actions.ts";
import {
  ALLOWED_CHANNEL,
  discordBot,
  discordConnectionSave,
  discordSettingsWhen,
  servingAgain,
  turnedOn,
} from "./support/chat-control.ts";
import {
  COLLABORATOR_ID,
  invocation,
  savedAccess,
  THREAD,
  toolResults,
  until,
} from "./support/chat-conversation.ts";
import { addedProject } from "./support/chat-runs.ts";
import { assertOk } from "./support/domain-setup.ts";
import { PARTICIPANT_ID, unproven } from "./support/controlled-discord.ts";

const ANSWERS = {
  accepted: "✅ Confirmed",
  notYours:
    "🔒 Only the person who asked for this review can confirm it. Ask Factory for your own.",
  notReply:
    "↪️ Nothing was done. To confirm, reply to the review's last message with its exact confirmation phrase.",
  wrongPhrase:
    "🔤 That is not this review's confirmation phrase, so nothing was done. Reply with the exact phrase before the review expires.",
  invalid: "🚫 This confirmation is no longer valid. Ask Factory for a new review.",
  expired: "⌛ This review expired, so nothing was done. Ask Factory for a new review.",
  denied: "🚫 Chat control does not accept this confirmation from you here.",
  rejected: "🚫 No longer valid",
} as const;

const CONFIRMATION_TEXT = new RegExp(
  `^🔒 <@${PARTICIPANT_ID}> To confirm, reply to this message with \`confirm [ACDEFHJKMNPQRTWXY34679]{4}\` · only the requester can confirm · expires <t:\\d+:R>$`,
);

const MESSAGE_CREATES = /^\/api\/v10\/channels\/\d+\/messages$/;

it("a Start proposal posts Factory's complete compact review with the requester's confirmation phrase last, and starts nothing", async (c) => {
  // Arrange
  const world = await startingWorld(c);

  // Act
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Assert
  const [review, last] = world.discord.created;
  expect(review!.content).toBe(
    [
      `📝 **Start ${world.flow.name} in ${world.project.title}?**`,
      `\`\`\`\n${START_PROMPT}\n\`\`\``,
    ].join("\n"),
  );
  expect(last!.content).toMatch(CONFIRMATION_TEXT);
  expect(last!.content).toContain(`\`${confirmation.phrase}\``);
  expect(confirmations(world.discord)).toHaveLength(1);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("the review's last message mentions only its requester", async (c) => {
  // Arrange
  const world = await startingWorld(c);

  // Act
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Assert
  const create = world.discord
    .requested("POST", MESSAGE_CREATES)
    .map((request) => request.body as { content: string; allowed_mentions: unknown })
    .find((body) => body.content.includes(confirmation.phrase));
  expect(create!.allowed_mentions).toStrictEqual({ parse: [], users: [PARTICIPANT_ID] });
});

it("each review gets a fresh confirmation phrase", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const other = await addedProject(world, "other-clone");
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id, other.id]);
  const first = await proposedStart(world, "600000000000000001", 2);

  // Act
  const second = await proposedStart(
    world,
    "600000000000000002",
    4,
    startCall(world, "Improve search filters", { projectId: other.id }),
    "also start: Improve search filters",
  );

  // Assert
  expect(second.phrase).not.toBe(first.phrase);
});

it("the requester's confirmation accepts exactly the reviewed Start, posts its status card as the only message and makes the thread the Run's originating thread", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(confirmationAnswers(world.discord)).toStrictEqual([]);
  await world.discord.createdWhere(isStatusCard, 1);
  const navigation = await world.factory.listRunNavigation();
  assert(navigation.ok);
  const [run] = navigation.value;
  const detail = await world.factory.getRun(run!.id);
  assert(detail.ok);
  expect(detail.value.input).toBe(START_PROMPT);
  expect(detail.value.title).toBe("Improve search");
  expect(detail.value.titleProvenance).toBe("automatic");
  expect(besidesReports(world.discord)).toHaveLength(2);
  expect(statusCardsIn(world.discord).map((card) => card.channelId)).toStrictEqual([THREAD]);
});

it("another participant's reply with the phrase is refused publicly, never reaches the language model and leaves the requester's consent usable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const requests = world.model.requests.length;
  await confirmed(world.discord, confirmation, "610000000000000001", 1, {
    userId: COLLABORATOR_ID,
  });

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000002", 2);

  // Assert
  expect(confirmationAnswers(world.discord)).toStrictEqual([ANSWERS.notYours]);
  expect(answer).toBe(ANSWERS.accepted);
  expect(world.model.requests).toHaveLength(requests);
  expect(await runsOf(world.factory)).toStrictEqual([{ number: 1, title: "Improve search" }]);
});

const REFUSED_ATTEMPTS: readonly {
  readonly name: string;
  readonly options: (confirmation: Confirmation) => ReplyOptions;
  readonly answer: string;
}[] = [
  { name: "a plain yes as a Reply", options: () => ({ text: "yes" }), answer: ANSWERS.wrongPhrase },
  {
    name: "a wrong code",
    options: () => ({ text: "confirm 7777" }),
    answer: ANSWERS.wrongPhrase,
  },
  {
    name: "the phrase in lower case",
    options: (confirmation) => ({ text: confirmation.phrase.toLowerCase() }),
    answer: ANSWERS.wrongPhrase,
  },
  {
    name: "the exact phrase without a Reply",
    options: () => ({ asReply: false }),
    answer: ANSWERS.notReply,
  },
];

for (const attempt of REFUSED_ATTEMPTS)
  it(`${attempt.name} confirms nothing, never reaches the language model and leaves the consent usable`, async (c) => {
    // Arrange
    const world = await startingWorld(c);
    const confirmation = await proposedStart(world, "600000000000000001", 2);
    const requests = world.model.requests.length;

    // Act
    const answer = await confirmed(
      world.discord,
      confirmation,
      "610000000000000001",
      1,
      attempt.options(confirmation),
    );

    // Assert
    expect(answer).toBe(attempt.answer);
    expect(world.model.requests).toHaveLength(requests);
    expect(await runsOf(world.factory)).toStrictEqual([]);
    expect(await confirmed(world.discord, confirmation, "610000000000000002", 2)).toBe(
      ANSWERS.accepted,
    );
  });

it("the phrase as a Reply to another of Factory's messages confirms nothing", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const [review] = world.discord.created;

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1, {
    replyTo: review!.id,
  });

  // Assert
  expect(answer).toBe(ANSWERS.notReply);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("a reply to the review from a user Access does not allow is ignored without any answer or model request", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const requests = world.model.requests.length;
  reply(world.discord, confirmation, "610000000000000001", { userId: "200000000000000099" });

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000002", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(confirmationAnswers(world.discord)).toStrictEqual([]);
  expect(world.model.requests).toHaveLength(requests);
});

it("another participant's reply leaves the requester's review waiting", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1, {
    userId: COLLABORATOR_ID,
  });

  // Assert
  expect(answer).toBe(ANSWERS.notYours);
  expect(reviewShows(world.discord, confirmation)).toMatch(CONFIRMATION_TEXT);
  expect(world.discord.edits).toStrictEqual([]);
});

it("reusing a used phrase after acceptance starts no second Run and tells the requester the accepted result without a receipt", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  await world.discord.createdWhere(isStatusCard, 1);

  // Act
  reply(world.discord, confirmation, "610000000000000002");

  // Assert
  expect(await confirmationAnswered(world.discord, 1)).toBe(
    "You already confirmed this review. Factory accepted Run #1 “Improve search”.",
  );
  expect(await runsOf(world.factory)).toHaveLength(1);
  expect(besidesReports(world.discord)).toHaveLength(3);
  expect(statusCardsIn(world.discord)).toHaveLength(1);
});

it("two confirmation replies racing on one review start exactly one Run", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  reply(world.discord, confirmation, "610000000000000001");
  reply(world.discord, confirmation, "610000000000000002");

  // Assert
  expect(await resolved(world.discord, confirmation)).toBe(ANSWERS.accepted);
  expect(await confirmationAnswered(world.discord, 1)).toMatch(
    /^(?:⏳|You already confirmed this review\.)/,
  );
  expect(await runsOf(world.factory)).toStrictEqual([{ number: 1, title: "Improve search" }]);
});

it("an identical proposal by the same requester reuses the waiting review and posts no second phrase", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  await proposedStart(world, "600000000000000001", 2);
  world.model.script(startCall(world, START_PROMPT));

  // Act
  world.discord.deliver(
    invocation("600000000000000002", { content: `start this:\n${START_PROMPT}` }),
  );

  // Assert
  await createdBesidesReports(world.discord, 3);
  expect(besidesReports(world.discord)[2]!.content).toContain(
    "This exact Start already has a review waiting for your confirmation in this thread.",
  );
  expect(confirmations(world.discord)).toHaveLength(1);
});

it("a corrected Start for the same Project supersedes the earlier review without the model naming it, so its phrase starts nothing", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const first = await proposedStart(world, "600000000000000001", 2);
  await proposedStart(
    world,
    "600000000000000002",
    4,
    startCall(world, "Improve search filters"),
    "no, start: Improve search filters",
  );

  // Act
  reply(world.discord, first, "610000000000000001");

  // Assert
  expect(await confirmationAnswered(world.discord, 1)).toBe(ANSWERS.invalid);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("a corrected Start shows the earlier review as replaced", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const first = await proposedStart(world, "600000000000000001", 2);

  // Act
  await proposedStart(
    world,
    "600000000000000002",
    4,
    startCall(world, "Improve search filters"),
    "no, start: Improve search filters",
  );

  // Assert
  expect(await resolved(world.discord, first)).toBe("↩️ Replaced");
  expect(confirmations(world.discord)).toHaveLength(2);
});

it("a Start proposed for another Project leaves the earlier Start's review confirmable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const other = await addedProject(world, "other-clone");
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id, other.id]);
  const first = await proposedStart(world, "600000000000000001", 2);
  await proposedStart(
    world,
    "600000000000000002",
    4,
    startCall(world, "Improve search filters", { projectId: other.id }),
    "also start: Improve search filters",
  );

  // Act
  const answer = await confirmed(world.discord, first, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(await runsOf(world.factory)).toStrictEqual([{ number: 1, title: "Improve search" }]);
});

it("completing Start preflight after the requester's Access revocation accepts no Run", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const pending = await pendingStart(world, confirmation);
  await savedAccess(world.factory, [COLLABORATOR_ID], [world.project.id]);

  // Act
  pending.release();

  // Assert
  expect(await pending.answer).toBe(ANSWERS.rejected);
  expect(await runsOf(world.factory)).toStrictEqual([]);
  expect(world.t3.threads.launchCalls).toBe(0);
});

it("completing Start preflight after a Gateway gap refreshes the requester's lost guild access", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const pending = await pendingStart(world, confirmation);
  const lookups = world.discord.requested("GET", /guilds\/\d+\/members\//).length;
  world.discord.removeGuildMember(PARTICIPANT_ID);
  world.discord.interruptSessions();
  await world.discord.readied(2);

  // Act
  pending.release();

  // Assert
  expect(await pending.answer).toContain("Try again before the review expires");
  expect(await runsOf(world.factory)).toStrictEqual([]);
  expect(world.t3.threads.launchCalls).toBe(0);
  expect(world.discord.requested("GET", /guilds\/\d+\/members\//).length).toBeGreaterThan(lookups);
});

it("completing Start preflight refreshes a public thread's current parent-channel permissions", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const pending = await pendingStart(world, confirmation);
  world.discord.hideChannelFrom(ALLOWED_CHANNEL, PARTICIPANT_ID);

  // Act
  pending.release();

  // Assert
  expect(await pending.answer).toContain("Try again before the review expires");
  expect(await runsOf(world.factory)).toStrictEqual([]);
  expect(world.t3.threads.launchCalls).toBe(0);
});

it("a Discord denial after Start preflight leaves the same consent usable when membership returns", async (c) => {
  // Arrange
  const world = await privateStartingWorld(c);
  const pending = await pendingStart(world, world.confirmation, world.replyOptions);
  world.discord.removeThreadMember(world.replyOptions.thread.id, PARTICIPANT_ID);
  pending.release();
  const firstAnswer = await pending.answer;
  world.discord.addThreadMember(world.replyOptions.thread.id, PARTICIPANT_ID);
  delete world.t3.contract.beforeInspection;

  // Act
  const answer = await confirmed(
    world.discord,
    world.confirmation,
    "610000000000000091",
    2,
    world.replyOptions,
  );

  // Assert
  expect(firstAnswer).toContain("Try again before the review expires");
  expect(answer).toBe(ANSWERS.accepted);
  expect(await runsOf(world.factory)).toHaveLength(1);
  expect(confirmations(world.discord)).toHaveLength(1);
});

it("restoring Discord membership cannot revive a consent revoked by Factory during Start preflight", async (c) => {
  // Arrange
  const world = await privateStartingWorld(c);
  const pending = await pendingStart(world, world.confirmation, world.replyOptions);
  world.discord.removeThreadMember(world.replyOptions.thread.id, PARTICIPANT_ID);
  await savedAccess(world.factory, [COLLABORATOR_ID], [world.project.id]);
  pending.release();
  const firstAnswer = await pending.answer;
  world.discord.addThreadMember(world.replyOptions.thread.id, PARTICIPANT_ID);
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id]);
  delete world.t3.contract.beforeInspection;

  // Act
  reply(world.discord, world.confirmation, "610000000000000091", world.replyOptions);
  const answer = await confirmationAnswered(world.discord, 1);

  // Assert
  expect(firstAnswer).toBe(ANSWERS.rejected);
  expect(answer).not.toBe(ANSWERS.accepted);
  expect(await runsOf(world.factory)).toStrictEqual([]);
  expect(world.t3.threads.launchCalls).toBe(0);
});

it("completing Start preflight after revocation and regrant starts nothing", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const pending = await pendingStart(world, confirmation);
  await savedAccess(world.factory, [], []);
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id]);

  // Act
  pending.release();

  // Assert
  expect(await pending.answer).toBe(ANSWERS.rejected);
  expect(await runsOf(world.factory)).toStrictEqual([]);
  expect(world.t3.threads.launchCalls).toBe(0);
});

it("a Start of a Flow that another permitted Project owns gets no review, and the model is told to use a Flow of this Project", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const other = await addedProject(world, "other-clone");
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id, other.id]);
  assertOk(
    await world.factory.changeFlowOwner(world.flow.id, {
      expectedProjectId: null,
      projectId: other.id,
    }),
  );
  world.model.script(startCall(world, START_PROMPT), {
    text: "That Flow is not for this Project.",
  });

  // Act
  world.discord.deliver(
    invocation("600000000000000001", { content: `start this:\n${START_PROMPT}` }),
  );

  // Assert
  await world.discord.createdMessages(1);
  expect(confirmations(world.discord)).toStrictEqual([]);
  expect(toolResults(world.model, 1)).toStrictEqual([
    {
      error: "flow_project_mismatch",
      message:
        "That Flow belongs to another Project, so it cannot start in this one. Use a global Flow or a Flow this Project owns from list_flows; do not choose another Project.",
    },
  ]);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("confirming a Start whose Flow moved to another Project after the review starts no Run and posts a not-accepted receipt", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const other = await addedProject(world, "other-clone");
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  assertOk(
    await world.factory.changeFlowOwner(world.flow.id, {
      expectedProjectId: null,
      projectId: other.id,
    }),
  );

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.rejected);
  await createdBesidesReports(world.discord, 3);
  expect(besidesReports(world.discord)[2]!.content).toContain(
    "Choose a global Flow or a Flow of the selected Project.",
  );
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("a prompt that is not exact text from the requester's message gets no review, and the model is told to copy it exactly", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  world.model.script(startCall(world, "Improve the search page"), { text: "Which exact text?" });

  // Act
  world.discord.deliver(
    invocation("600000000000000001", { content: `start this:\n${START_PROMPT}` }),
  );

  // Assert
  await world.discord.createdMessages(1);
  expect(world.discord.created.map((message) => message.content)).toStrictEqual([
    "Which exact text?",
  ]);
  expect(toolResults(world.model, 1)).toStrictEqual([
    {
      error: "prompt_not_exact",
      message:
        "The prompt is not exact text from the requester's message. Copy it character for character, or mark it composed so Factory labels it.",
    },
  ]);
});

it("a composed prompt is reviewed in full and labelled as written by Factory's assistant", async (c) => {
  // Arrange
  const world = await startingWorld(c);

  // Act
  await proposedStart(
    world,
    "600000000000000001",
    2,
    startCall(world, "Fix the flaky login test", { promptSource: "composed" }),
    "can you get the login test fixed?",
  );

  // Assert
  expect(world.discord.created[0]!.content).toContain(
    "⚠️ Prompt **composed by Factory's assistant, not written by you** — read all of it:\n```\nFix the flaky login test\n```",
  );
});

it("task text over 8,000 characters is refused without a review, never shortened", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  world.model.script(startCall(world, "x".repeat(8001), { promptSource: "composed" }), {
    text: "Too long.",
  });

  // Act
  world.discord.deliver(invocation("600000000000000001", { content: "start a long task" }));

  // Assert
  await world.discord.createdMessages(1);
  expect(confirmations(world.discord)).toHaveLength(0);
  expect(toolResults(world.model, 1)[0]!.error).toBe("prompt_too_long");
});

it.effect("a reply after the review's five-minute lifetime starts nothing", (c) =>
  Effect.gen(function* () {
    // Arrange
    const world = yield* clockedStartingWorld(c);
    const confirmation = yield* until(() => proposedStart(world, "600000000000000001", 2));
    yield* TestClock.adjust(5 * 60_000);

    // Act
    const answer = yield* until(async () => {
      reply(world.discord, confirmation, "610000000000000001");
      return confirmationAnswered(world.discord, 1);
    });

    // Assert
    expect(answer).toBe(ANSWERS.expired);
    const navigation = yield* world.factory.listRunNavigation();
    assert(navigation.ok);
    expect(navigation.value).toStrictEqual([]);
  }),
);

it.effect("a Start first reaching acceptance after its review expires starts nothing", (c) =>
  Effect.gen(function* () {
    // Arrange
    const world = yield* clockedStartingWorld(c);
    const confirmation = yield* until(() => proposedStart(world, "600000000000000001", 2));
    const pending = yield* until(() => pendingStart(world, confirmation));
    yield* TestClock.adjust(5 * 60_000);

    // Act
    pending.release();

    // Assert
    const answer = yield* until(() => pending.answer);
    expect(answer).toBe(ANSWERS.rejected);
    const navigation = yield* world.factory.listRunNavigation();
    assert(navigation.ok);
    expect(navigation.value).toStrictEqual([]);
    expect(world.t3.threads.launchCalls).toBe(0);
  }),
);

it.effect("a review shows as expired at its original expiry", (c) =>
  Effect.gen(function* () {
    // Arrange
    const world = yield* clockedStartingWorld(c);
    const confirmation = yield* until(() => proposedStart(world, "600000000000000001", 2));

    // Act
    yield* TestClock.adjust(5 * 60_000);

    // Assert
    expect(yield* until(() => resolved(world.discord, confirmation))).toBe("⌛ Expired");
  }),
);

it("a Discord access denial rejects the reply without consuming the consent", async (c) => {
  // Arrange
  const world = await privateStartingWorld(c);
  const { confirmation, replyOptions } = world;
  world.discord.removeThreadMember(replyOptions.thread.id, PARTICIPANT_ID);
  await confirmed(world.discord, confirmation, "610000000000000001", 1, replyOptions);
  world.discord.addThreadMember(replyOptions.thread.id, PARTICIPANT_ID);

  // Act
  const answer = await confirmed(
    world.discord,
    confirmation,
    "610000000000000002",
    2,
    replyOptions,
  );

  // Assert
  expect(confirmationAnswers(world.discord)).toStrictEqual([ANSWERS.denied]);
  expect(answer).toBe(ANSWERS.accepted);
  expect(await runsOf(world.factory)).toHaveLength(1);
});

it("revoking the requester voids their waiting review for good, even after the grant returns", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  await savedAccess(world.factory, [COLLABORATOR_ID], [world.project.id]);
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], [world.project.id]);

  // Act
  reply(world.discord, confirmation, "610000000000000001");

  // Assert
  expect(await confirmationAnswered(world.discord, 1)).toBe(ANSWERS.invalid);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("revoking the requester shows their waiting review as no longer valid", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  await savedAccess(world.factory, [COLLABORATOR_ID], [world.project.id]);

  // Assert
  expect(await resolved(world.discord, confirmation)).toBe("🚫 No longer valid");
});

it("a review voided while Chat control is Off keeps its phrase as it is after turning On again", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const voidedWhileOff = await proposedStart(world, "600000000000000001", 2);
  world.model.script(startCall(world, START_PROMPT));
  world.discord.deliver(
    invocation("600000000000000002", {
      content: `start this:\n${START_PROMPT}`,
      authorId: COLLABORATOR_ID,
    }),
  );
  await world.discord.createdMessages(4);
  const voidedWhileOn = confirmations(world.discord)[1]!;
  assert((await world.factory.setChatControlEnabled({ enabled: false })).ok);
  await savedAccess(world.factory, [COLLABORATOR_ID], [world.project.id]);
  await turnedOn(world.factory, world.discord, 2);

  // Act
  await savedAccess(world.factory, [], [world.project.id]);

  // Assert
  await world.discord.messagesWhen(() => world.discord.edits.length >= 1);
  expect(world.discord.edits.map((edit) => edit.messageId)).toStrictEqual([voidedWhileOn.id]);
  expect(reviewShows(world.discord, voidedWhileOff)).toMatch(CONFIRMATION_TEXT);
});

it("revoking the requester while their review is being posted stops it before its phrase appears", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  world.discord.faultMessages("paused");
  world.model.script(startCall(world, START_PROMPT));
  world.discord.deliver(
    invocation("600000000000000001", { content: `start this:\n${START_PROMPT}` }),
  );
  await world.discord.request("POST", MESSAGE_CREATES, 1);
  // A collaborator's message in the same thread is interpreted only after the review ends.
  world.discord.deliver(invocation("600000000000000002", { authorId: COLLABORATOR_ID }));
  await savedAccess(world.factory, [COLLABORATOR_ID], [world.project.id]);

  // Act
  world.discord.releaseMessages();

  // Assert
  await world.discord.createdMessages(2);
  expect(world.discord.created.map((message) => message.content)).toStrictEqual([
    expect.stringContaining(`📝 **Start ${world.flow.name} in `),
    "OK",
  ]);
  expect(confirmations(world.discord)).toStrictEqual([]);
});

it("replacing the Discord application retires its waiting reviews, even after switching back", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const other = { token: "other-bot-token.discord.secret", applicationId: "123456789012345679" };
  world.discord.addBot(other);
  const replaced = await world.factory.updateDiscordConnection(
    discordConnectionSave({ revision: 1, token: { kind: "replace", value: other.token } }),
  );
  assert(replaced.ok, JSON.stringify(replaced));
  await servingAgain(world.discord, 2);
  const restored = await world.factory.updateDiscordConnection(
    discordConnectionSave({ revision: 2 }),
  );
  assert(restored.ok, JSON.stringify(restored));
  await servingAgain(world.discord, 3);

  // Act
  reply(world.discord, confirmation, "610000000000000001");

  // Assert
  expect(await confirmationAnswered(world.discord, 1)).toBe(ANSWERS.invalid);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("consent survives turning Chat control Off and On again within its lifetime", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  assert((await world.factory.setChatControlEnabled({ enabled: false })).ok);
  await turnedOn(world.factory, world.discord, 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(await runsOf(world.factory)).toHaveLength(1);
});

it("rotating the same application's bot token while On keeps the waiting review confirmable", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const rotated = "rotated-bot-token.discord.secret";
  world.discord.addBot({ token: rotated, applicationId: discordBot.applicationId });
  const saved = await world.factory.updateDiscordConnection(
    discordConnectionSave({ revision: 1, token: { kind: "replace", value: rotated } }),
  );
  assert(saved.ok, JSON.stringify(saved));
  await servingAgain(world.discord, 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(await runsOf(world.factory)).toHaveLength(1);
});

it("a review presented before a backend restart is confirmed once after it", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  await world.factory.close();
  const reopened = await world.open();
  await servingAgain(world.discord, 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(await runsOf(reopened)).toStrictEqual([{ number: 1, title: "Improve search" }]);
});

it("a confirmation works while the language model fails, with no model request", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  world.model.fail(500, { error: "down" });
  const requests = world.model.requests.length;

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(world.model.requests).toHaveLength(requests);
  await world.discord.createdWhere(isStatusCard, 1);
});

it("a definitive Start rejection uses up the consent and posts a not-accepted receipt", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  assert((await world.factory.removeFlow(world.flow.id)).ok);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.rejected);
  await createdBesidesReports(world.discord, 3);
  expect(besidesReports(world.discord)[2]!.content).toMatch(
    /^❌ \*\*Start not accepted\*\* — [^\n]+(?:\n• [^\n]+)*$/,
  );
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("confirming a Start whose Agent lost its model after the review starts no Run and names the Agent that needs one", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  const block = world.flow.graph.blocks.find((entry) => entry.kind === "agent");
  assert(block?.kind === "agent" && block.agentId);
  const agent = await world.factory.getAgent(block.agentId);
  assert(agent.ok);
  const cleared = await world.factory.updateAgent(agent.value.id, {
    name: agent.value.name,
    prompt: agent.value.prompt,
    execution: null,
    exits: agent.value.exits,
    expectedRevision: agent.value.revision,
    expectedProjectId: agent.value.projectId,
    projectOverrides: [],
  });
  assert(cleared.ok, JSON.stringify(cleared));

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.rejected);
  await createdBesidesReports(world.discord, 3);
  expect(besidesReports(world.discord)[2]!.content).toContain(`${agent.value.name} needs a model.`);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("a later turn reads the proposal's accepted outcome from Factory's facts instead of proposing again", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  await world.discord.createdWhere(isStatusCard, 1);
  world.model.script({ text: "It started as Run #1." });

  // Act
  world.discord.deliver(invocation("600000000000000002", { content: "did it start?" }));

  // Assert
  await createdBesidesReports(world.discord, 3);
  expect(toolResults(world.model, 1)).toStrictEqual([
    expect.objectContaining({
      operation: "start",
      requester: PARTICIPANT_ID,
      current: {
        state: "accepted",
        outcome: expect.objectContaining({ runNumber: 1, title: "Improve search" }),
      },
    }),
  ]);
});

it("a UI-started Run gets no status card, while a chat-started Run in the same Project gets one in its originating thread", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const uiStarted = await world.factory.startTextRun({
    requestId: "ui-start-1",
    projectId: world.project.id,
    flowId: world.flow.id,
    input: "Started in Factory\nNot through chat.",
  });
  assert(uiStarted.ok, JSON.stringify(uiStarted));
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  await world.discord.createdWhere(isStatusCard, 1);
  expect(statusCardsIn(world.discord)).toStrictEqual([
    expect.objectContaining({
      channelId: THREAD,
      content: expect.stringMatching(/^\*\*Run #2 · Improve search\*\* · 🟢 Active · 🔀 /),
    }),
  ]);
});

const owedReceipt = (world: Awaited<ReturnType<typeof startingWorld>>) =>
  discordSettingsWhen(world.factory, (settings) => settings.delivery.problems.length > 0);

async function rejectedProposal(world: Awaited<ReturnType<typeof startingWorld>>) {
  const confirmation = await proposedStart(world, "600000000000000001", 2);
  assert((await world.factory.removeFlow(world.flow.id)).ok);
  return confirmation;
}

const REJECTED = "❌ **Start not accepted**";

it("a receipt create Discord performed without answering is asked again under its enforced nonce and shows once", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages("lost");

  // Act
  await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  await world.discord.request("POST", MESSAGE_CREATES, 4);
  expect(
    besidesReports(world.discord)
      .slice(2)
      .map((message) => message.content),
  ).toStrictEqual([expect.stringMatching(/^❌ \*\*Start not accepted\*\*/)]);
  const creates = world.discord
    .requested("POST", MESSAGE_CREATES)
    .map((request) => request.body as { nonce: string; enforce_nonce: boolean; content: string })
    .filter((create) => create.content.startsWith(REJECTED));
  expect(creates).toHaveLength(2);
  expect(creates[1]!.nonce).toBe(creates[0]!.nonce);
  expect(creates.map((create) => create.enforce_nonce)).toStrictEqual([true, true]);
  const settings = await world.factory.getDiscordSettings();
  assert(settings.ok);
  expect(settings.value.delivery.problems).toStrictEqual([]);
});

it("a review's last message whose create failed without proof is asked again under its nonce, shows once and confirms", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  world.discord.faultMessages("delivered", "delivered", "delivered", "failed");
  const confirmation = await proposedStart(world, "600000000000000001", 2);

  // Act
  const answer = await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  expect(answer).toBe(ANSWERS.accepted);
  expect(confirmations(world.discord)).toHaveLength(1);
  expect(await runsOf(world.factory)).toHaveLength(1);
});

it("a receipt create still unproven after its re-attempts under the nonce is not repeated and is shown in Settings as unknown", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages(...unproven("lost"));

  // Act
  await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  const settings = await owedReceipt(world);
  expect(settings.delivery.problems).toStrictEqual([
    expect.objectContaining({
      purpose: "receipt",
      state: "unknown",
      threadId: THREAD,
      parentChannelId: ALLOWED_CHANNEL,
      message:
        "Factory cannot tell whether Discord created the message. Retrying may post it twice.",
      nextAttemptAt: null,
    }),
  ]);
  expect(settings.needsAttention).toBe(true);
  expect(besidesReports(world.discord)).toHaveLength(3);
});

it("the warned Retry sends an unknown receipt once more and starts nothing", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages(...unproven("lost"));
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  const [problem] = (await owedReceipt(world)).delivery.problems;
  world.discord.nonceWindowPassed();

  // Act
  const retried = await world.factory.retryChatDelivery({
    deliveryId: problem!.id,
    duplicateRiskAccepted: true,
  });

  // Assert
  assert(retried.ok, JSON.stringify(retried));
  await createdBesidesReports(world.discord, 4);
  expect(besidesReports(world.discord)[3]!.content).toBe(besidesReports(world.discord)[2]!.content);
  const settings = await discordSettingsWhen(
    world.factory,
    (current) => current.delivery.problems.length === 0,
  );
  expect(settings.needsAttention).toBe(false);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("Retry of an unknown receipt is refused until the owner accepts a possible duplicate", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages(...unproven("lost"));
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  const [problem] = (await owedReceipt(world)).delivery.problems;

  // Act
  const retried = await world.factory.retryChatDelivery({
    deliveryId: problem!.id,
    duplicateRiskAccepted: false,
  });

  // Assert
  assert(!retried.ok);
  expect(retried.error.issues[0]?.code).toBe("chat_delivery_duplicate_risk");
  expect(besidesReports(world.discord)).toHaveLength(3);
});

it("a receipt Discord refused is shown as failed, and Retry after correction delivers it without a duplicate warning", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages("refused");
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  const [problem] = (await owedReceipt(world)).delivery.problems;

  // Act
  const retried = await world.factory.retryChatDelivery({
    deliveryId: problem!.id,
    duplicateRiskAccepted: false,
  });

  // Assert
  expect(problem!.state).toBe("failed");
  assert(retried.ok, JSON.stringify(retried));
  await createdBesidesReports(world.discord, 3);
  expect(besidesReports(world.discord)[2]!.content).toContain(REJECTED);
});

it("a rate-limited receipt is retried automatically", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages("rate-limited");

  // Act
  await confirmed(world.discord, confirmation, "610000000000000001", 1);

  // Assert
  await createdBesidesReports(world.discord, 3);
  expect(besidesReports(world.discord)[2]!.content).toContain(REJECTED);
});

it("revoking the receipt's destination cancels the owed receipt", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages("refused");
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  await owedReceipt(world);

  // Act
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], []);

  // Assert
  const settings = await world.factory.getDiscordSettings();
  assert(settings.ok);
  expect(settings.value.delivery.problems).toStrictEqual([]);
  expect(await runsOf(world.factory)).toStrictEqual([]);
});

it("a revoked receipt create interrupted by a backend stop stays unknown after restart", async (c) => {
  // Arrange
  const world = await startingWorld(c);
  const confirmation = await rejectedProposal(world);
  world.discord.faultMessages("held");
  await confirmed(world.discord, confirmation, "610000000000000001", 1);
  await world.discord.request("POST", /^\/api\/v10\/channels\/\d+\/messages$/, 3);
  await savedAccess(world.factory, [PARTICIPANT_ID, COLLABORATOR_ID], []);
  await world.factory.close();

  // Act
  const reopened = await world.open();

  // Assert
  const settings = await reopened.getDiscordSettings();
  assert(settings.ok);
  expect(settings.value.delivery.problems).toStrictEqual([
    expect.objectContaining({ state: "unknown", purpose: "receipt" }),
  ]);
  await servingAgain(world.discord, 2);
  expect(world.discord.requested("POST", /^\/api\/v10\/channels\/\d+\/messages$/)).toHaveLength(3);
  expect(await runsOf(reopened)).toStrictEqual([]);
});
