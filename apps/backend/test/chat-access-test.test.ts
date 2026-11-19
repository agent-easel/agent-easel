import { assert, expect, it } from "@effect/vitest";
import { messageEvent, PARTICIPANT_ID } from "./support/controlled-discord.ts";
import {
  afterEarlierEvents,
  ALLOWED_CHANNEL,
  chatControlWorld,
  discordBot,
  discordGuild,
  FORUM_CHANNEL,
  OTHER_CHANNEL,
  POSTS,
  THREADS,
  turnedOn,
} from "./support/chat-control.ts";

const SECOND_USER = "200000000000000002";
const OUTSIDER = "200000000000000099";
const DELETED_CHANNEL = "400000000000000099";
const UNGRANTED_CHANNEL = "400000000000000098";
const BOT_MENTION = `<@${discordBot.applicationId}>`;
const FORUM_POSTS = new RegExp(`^/api/v10/channels/${FORUM_CHANNEL}/threads$`);

/**
 * Operating Chat control whose Access allows two users in four granting channels, a forum among
 * them, and one channel that grants nothing.
 */
async function operating(c: Parameters<typeof chatControlWorld>[0]) {
  const world = await chatControlWorld(c);
  const access = await world.factory.updateDiscordAccess({
    revision: 1,
    users: [PARTICIPANT_ID, SECOND_USER],
    channels: [
      ...[ALLOWED_CHANNEL, OTHER_CHANNEL, DELETED_CHANNEL, FORUM_CHANNEL].map((channelId) => ({
        channelId,
        projectIds: [world.project.id],
      })),
      { channelId: UNGRANTED_CHANNEL, projectIds: [] },
    ],
  });
  assert(access.ok, JSON.stringify(access));
  await turnedOn(world.factory, world.discord);
  return world;
}

/** A reply to the access test message `test` in the allowed channel. */
const testReply = (test: { id: string; content: string }, id: string, authorId: string) =>
  messageEvent({
    bot: discordBot,
    guildId: discordGuild.id,
    channelId: ALLOWED_CHANNEL,
    id,
    authorId,
    content: "here",
    mention: false,
    replyTo: {
      id: test.id,
      channelId: ALLOWED_CHANNEL,
      authorId: discordBot.applicationId,
      authorIsBot: true,
      content: test.content,
    },
  });

it("the access test mentions every allowed user in each granting channel and records the channels it can't post in", async (c) => {
  // Arrange
  const { factory, discord } = await operating(c);
  discord.setPostingDenied(OTHER_CHANNEL, true);

  // Act
  const sent = await factory.sendDiscordAccessTest();

  // Assert
  assert(sent.ok, JSON.stringify(sent));
  expect(sent.value.access.test).toEqual({
    sentAt: expect.any(String),
    channels: {
      [ALLOWED_CHANNEL]: "posted",
      [OTHER_CHANNEL]: "cant-post",
      [DELETED_CHANNEL]: "unknown-channel",
      [FORUM_CHANNEL]: "posted",
    },
    users: { [PARTICIPANT_ID]: null, [SECOND_USER]: null },
  });
  const mentions = `<@${PARTICIPANT_ID}> <@${SECOND_USER}>`;
  expect(discord.created.map(({ content }) => content)).toEqual([
    `${mentions}, reply here to confirm you can use Factory.`,
    `${mentions}, mention ${BOT_MENTION} in this post to confirm you can use Factory.`,
  ]);
  expect(discord.created[0]!.channelId).toBe(ALLOWED_CHANNEL);
  // Only the allowed users are pinged, never a role or everyone.
  const allowed_mentions = { parse: [], users: [PARTICIPANT_ID, SECOND_USER] };
  expect(discord.requested("POST", POSTS).map((request) => request.body)).toMatchObject(
    Array(2).fill({ allowed_mentions }),
  );
  expect(discord.requested("POST", FORUM_POSTS).map((request) => request.body)).toMatchObject([
    { name: "Factory access test", message: { allowed_mentions } },
  ]);
  // A channel that grants no Project admits no reply, so the test asks nobody there.
  expect(
    discord.requests.filter(
      (request) => request.method === "POST" && request.path.includes(UNGRANTED_CHANNEL),
    ),
  ).toEqual([]);
});

it("an allowed user's reply to the access test marks them Reached with a ✅ and never reaches the language model", async (c) => {
  // Arrange
  const { factory, discord, model } = await operating(c);
  const sent = await factory.sendDiscordAccessTest();
  assert(sent.ok, JSON.stringify(sent));
  const test = discord.created[0]!;
  const reply = (id: string, authorId: string) => testReply(test, id, authorId);

  // Act
  discord.deliver(reply("300000000000000001", OUTSIDER));
  discord.deliver(reply("300000000000000002", PARTICIPANT_ID));
  await afterEarlierEvents(discord, "300000000000000003");

  // Assert
  const settings = await factory.getDiscordSettings();
  assert(settings.ok);
  expect(settings.value.access.test?.users).toEqual({
    [PARTICIPANT_ID]: expect.any(String),
    [SECOND_USER]: null,
  });
  expect(discord.reactions).toEqual([
    { channelId: ALLOWED_CHANNEL, messageId: "300000000000000002", emoji: "✅" },
  ]);
  // Only the later ordinary invocation opened a thread and asked the model.
  expect(discord.requested("POST", THREADS).map((request) => request.path)).toEqual([
    `/api/v10/channels/${ALLOWED_CHANNEL}/messages/300000000000000003/threads`,
  ]);
  await model.requested(1);
  expect(model.requests).toHaveLength(1);
});

it("a reply to a test message answers the test while later channels are still posting, and still after Send again", async (c) => {
  // Arrange
  const { factory, discord, model } = await operating(c);
  // The allowed channel's post is accepted at once; the next channel's waits.
  discord.faultMessages("delivered", "paused");
  const sending = factory.sendDiscordAccessTest();
  await discord.request("POST", POSTS, 2);
  const first = discord.created[0]!;

  // Act
  discord.deliver(testReply(first, "300000000000000001", PARTICIPANT_ID));
  await afterEarlierEvents(discord, "300000000000000002");
  discord.releaseMessages();
  assert((await sending).ok);
  const resent = await factory.sendDiscordAccessTest();
  assert(resent.ok, JSON.stringify(resent));
  discord.deliver(testReply(first, "300000000000000003", SECOND_USER));
  await afterEarlierEvents(discord, "300000000000000004");

  // Assert
  expect(discord.reactions.map((reaction) => reaction.messageId)).toEqual([
    "300000000000000001",
    "300000000000000003",
  ]);
  // Send again asked the participant again; the late reply to the first test still answered.
  const settings = await factory.getDiscordSettings();
  assert(settings.ok);
  expect(settings.value.access.test?.users).toEqual({
    [PARTICIPANT_ID]: null,
    [SECOND_USER]: expect.any(String),
  });
  // Only the two ordinary invocations opened threads and asked the model.
  expect(discord.requested("POST", THREADS).map((request) => request.path)).toEqual([
    `/api/v10/channels/${ALLOWED_CHANNEL}/messages/300000000000000002/threads`,
    `/api/v10/channels/${ALLOWED_CHANNEL}/messages/300000000000000004/threads`,
  ]);
  await model.requested(2);
  expect(model.requests).toHaveLength(2);
});

it("mentioning the bot in a forum channel's access test post marks the user Reached and never reaches the language model", async (c) => {
  // Arrange
  const { factory, discord, model } = await operating(c);
  assert((await factory.sendDiscordAccessTest()).ok);
  const post = discord.created.find((message) => message.content.includes("in this post"))!;

  // Act
  discord.deliver(
    messageEvent({
      bot: discordBot,
      guildId: discordGuild.id,
      channelId: post.channelId,
      id: "300000000000000001",
      authorId: SECOND_USER,
      content: "here",
    }),
  );
  await afterEarlierEvents(discord, "300000000000000002");

  // Assert
  const settings = await factory.getDiscordSettings();
  assert(settings.ok);
  expect(settings.value.access.test?.users).toEqual({
    [PARTICIPANT_ID]: null,
    [SECOND_USER]: expect.any(String),
  });
  expect(discord.reactions).toEqual([
    { channelId: post.channelId, messageId: "300000000000000001", emoji: "✅" },
  ]);
  await model.requested(1);
  expect(model.requests).toHaveLength(1);
});

it("the access test is refused while Off and its last results stay readable", async (c) => {
  // Arrange
  const { factory, discord } = await operating(c);
  assert((await factory.sendDiscordAccessTest()).ok);
  const off = await factory.setChatControlEnabled({ enabled: false });
  assert(off.ok, JSON.stringify(off));
  const posted = discord.created.length;

  // Act
  const refused = await factory.sendDiscordAccessTest();

  // Assert
  expect(refused).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(off.value.access.test?.channels[ALLOWED_CHANNEL]).toBe("posted");
  expect(discord.created).toHaveLength(posted);
});

it("an Access save drops the access test results of the channels and users it removes", async (c) => {
  // Arrange
  const { factory } = await operating(c);
  const sent = await factory.sendDiscordAccessTest();
  assert(sent.ok, JSON.stringify(sent));

  // Act
  const saved = await factory.updateDiscordAccess({
    revision: sent.value.access.revision,
    users: [PARTICIPANT_ID],
    channels: [{ channelId: ALLOWED_CHANNEL, projectIds: [] }],
  });

  // Assert
  assert(saved.ok, JSON.stringify(saved));
  expect(saved.value.access.test).toMatchObject({
    channels: { [ALLOWED_CHANNEL]: "posted" },
    users: { [PARTICIPANT_ID]: null },
  });
  expect(Object.keys(saved.value.access.test!.channels)).toHaveLength(1);
  expect(Object.keys(saved.value.access.test!.users)).toHaveLength(1);
});

it("an Access save while the access test is posting applies to the later posts and the recorded results", async (c) => {
  // Arrange
  const { factory, discord, project } = await operating(c);
  const before = await factory.getDiscordSettings();
  assert(before.ok, JSON.stringify(before));
  // The allowed channel's post waits for Discord.
  discord.faultMessages("paused");
  const sending = factory.sendDiscordAccessTest();
  await discord.request("POST", POSTS, 1);

  // Act
  const saved = await factory.updateDiscordAccess({
    revision: before.value.access.revision,
    users: [PARTICIPANT_ID],
    channels: [DELETED_CHANNEL, FORUM_CHANNEL].map((channelId) => ({
      channelId,
      projectIds: [project.id],
    })),
  });
  discord.releaseMessages();
  const sent = await sending;

  // Assert
  assert(saved.ok, JSON.stringify(saved));
  assert(sent.ok, JSON.stringify(sent));
  // The revoked channels' results stay dropped; only the revoked user's mention is gone later.
  expect(sent.value.access.test).toEqual({
    sentAt: expect.any(String),
    channels: { [DELETED_CHANNEL]: "unknown-channel", [FORUM_CHANNEL]: "posted" },
    users: { [PARTICIPANT_ID]: null },
  });
  expect(
    discord.requests.filter(
      (request) => request.method === "POST" && request.path.includes(OTHER_CHANNEL),
    ),
  ).toEqual([]);
  expect(discord.requested("POST", FORUM_POSTS).map((request) => request.body)).toMatchObject([
    { message: { allowed_mentions: { parse: [], users: [PARTICIPANT_ID] } } },
  ]);
});

it("an Access save during the access test's channel lookup applies to the post that follows it", async (c) => {
  // Arrange
  const { factory, discord, project } = await operating(c);
  // A channel the Gateway has not announced, so Factory looks it up before posting there.
  const lookedUp = "400000000000000097";
  discord.addGuild({
    id: "400000000000000096",
    name: "Late",
    channels: [{ id: lookedUp, name: "late" }],
  });
  const settings = await factory.getDiscordSettings();
  assert(settings.ok, JSON.stringify(settings));
  const channels = [{ channelId: lookedUp, projectIds: [project.id] }];
  const access = await factory.updateDiscordAccess({
    revision: settings.value.access.revision,
    users: [PARTICIPANT_ID, SECOND_USER],
    channels,
  });
  assert(access.ok, JSON.stringify(access));
  discord.pauseChannelLookups();
  const sending = factory.sendDiscordAccessTest();
  await discord.request("GET", new RegExp(`^/api/v10/channels/${lookedUp}$`));

  // Act
  const saved = await factory.updateDiscordAccess({
    revision: access.value.access.revision,
    users: [PARTICIPANT_ID],
    channels,
  });
  discord.releaseMessages();
  const sent = await sending;

  // Assert
  assert(saved.ok, JSON.stringify(saved));
  assert(sent.ok, JSON.stringify(sent));
  expect(discord.requested("POST", POSTS).map((request) => request.body)).toEqual([
    {
      content: `<@${PARTICIPANT_ID}>, reply here to confirm you can use Factory.`,
      allowed_mentions: { parse: [], users: [PARTICIPANT_ID] },
    },
  ]);
});

it("an Access save between the access test's split messages applies to the later messages", async (c) => {
  // Arrange
  const { factory, discord, project } = await operating(c);
  // More allowed users than one message can mention, so the channel gets two messages.
  const users = Array.from({ length: 100 }, (_, index) =>
    String(210000000000000000n + BigInt(index)),
  );
  const settings = await factory.getDiscordSettings();
  assert(settings.ok, JSON.stringify(settings));
  const channels = [{ channelId: ALLOWED_CHANNEL, projectIds: [project.id] }];
  const access = await factory.updateDiscordAccess({
    revision: settings.value.access.revision,
    users,
    channels,
  });
  assert(access.ok, JSON.stringify(access));
  discord.faultMessages("paused");
  const sending = factory.sendDiscordAccessTest();
  await discord.request("POST", POSTS, 1);
  // The first message mentions the first 88 users; the save revokes users from both messages.
  const kept = [...users.slice(0, 10), ...users.slice(90)];

  // Act
  const saved = await factory.updateDiscordAccess({
    revision: access.value.access.revision,
    users: kept,
    channels,
  });
  discord.releaseMessages();
  const sent = await sending;

  // Assert
  assert(saved.ok, JSON.stringify(saved));
  assert(sent.ok, JSON.stringify(sent));
  const posts = discord
    .requested("POST", POSTS)
    .map((request) => request.body as { allowed_mentions: { users: string[] } });
  expect(posts).toHaveLength(2);
  // The first message was in flight before the save; the second mentions only those still allowed.
  expect(posts[0]!.allowed_mentions.users).toEqual(users.slice(0, 88));
  expect(posts[1]).toEqual({
    content: `${users
      .slice(90)
      .map((userId) => `<@${userId}>`)
      .join(" ")}, reply here to confirm you can use Factory.`,
    allowed_mentions: { parse: [], users: users.slice(90) },
  });
});
