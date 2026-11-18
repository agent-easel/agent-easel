import { assert, expect, it } from "@effect/vitest";
import { messageEvent, PARTICIPANT_ID } from "./support/controlled-discord.ts";
import {
  afterEarlierEvents,
  ALLOWED_CHANNEL,
  chatControlWorld,
  discordBot,
  discordGuild,
  OTHER_CHANNEL,
  POSTS,
  THREADS,
  turnedOn,
} from "./support/chat-control.ts";

const SECOND_USER = "200000000000000002";
const OUTSIDER = "200000000000000099";
const DELETED_CHANNEL = "400000000000000099";

/** Operating Chat control whose Access allows two users in three channels. */
async function operating(c: Parameters<typeof chatControlWorld>[0]) {
  const world = await chatControlWorld(c);
  const access = await world.factory.updateDiscordAccess({
    revision: 1,
    users: [PARTICIPANT_ID, SECOND_USER],
    channels: [ALLOWED_CHANNEL, OTHER_CHANNEL, DELETED_CHANNEL].map((channelId) => ({
      channelId,
      projectIds: [world.project.id],
    })),
  });
  assert(access.ok, JSON.stringify(access));
  await turnedOn(world.factory, world.discord);
  return world;
}

it("the access test mentions every allowed user in each allowed channel and records the channels it can't post in", async (c) => {
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
    },
    users: { [PARTICIPANT_ID]: null, [SECOND_USER]: null },
  });
  expect(discord.created.map(({ channelId, content }) => ({ channelId, content }))).toEqual([
    {
      channelId: ALLOWED_CHANNEL,
      content: `<@${PARTICIPANT_ID}> <@${SECOND_USER}>, reply here to confirm you can use Factory.`,
    },
  ]);
  // Only the allowed users are pinged, never a role or everyone.
  expect(discord.requested("POST", POSTS).map((request) => request.body)).toMatchObject(
    Array(3).fill({ allowed_mentions: { parse: [], users: [PARTICIPANT_ID, SECOND_USER] } }),
  );
});

it("an allowed user's reply to the access test marks them Reached with a ✅ and never reaches the language model", async (c) => {
  // Arrange
  const { factory, discord, model } = await operating(c);
  const sent = await factory.sendDiscordAccessTest();
  assert(sent.ok, JSON.stringify(sent));
  const test = discord.created[0]!;
  const reply = (id: string, authorId: string) =>
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
