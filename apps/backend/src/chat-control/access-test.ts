import { ChannelType, DiscordAPIError, RESTJSONErrorCodes, Routes, type Client } from "discord.js";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { DiscordAccessTest, DiscordAccessTestPost, Result } from "@t3-factory/contracts";
import { failure } from "../result.ts";
import { now } from "../time.ts";

const REQUEST = "reply here to confirm you can use Factory.";
const MESSAGE_LIMIT = 2000;
const FORUM_POST_NAME = "Factory access test";

/** The test's text: every allowed user mentioned, split across messages within Discord's length. */
function accessTestMessages(users: readonly string[], request: string) {
  const messages: string[] = [];
  let mentions = "";
  for (const mention of users.map((id) => `<@${id}>`)) {
    const next = mentions ? `${mentions} ${mention}` : mention;
    if (`${next}, ${request}`.length > MESSAGE_LIMIT) {
      messages.push(`${mentions}, ${request}`);
      mentions = mention;
    } else mentions = next;
  }
  messages.push(`${mentions}, ${request}`);
  return messages;
}

/** What one refused request means for the channel: Discord does not know it, or refused the bot. */
const refusal = (error: unknown): DiscordAccessTestPost =>
  error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel
    ? "unknown-channel"
    : "cant-post";

/**
 * Posts the test in one channel and records each message the moment Discord accepts it, so a
 * reply to it is an answer even while later channels are still being posted in. A forum gets one
 * forum post: a thread whose ID its starter message shares, which identifies the test there.
 */
const postInChannel = (
  sql: SqlClient.SqlClient,
  client: Client<true>,
  channelId: string,
  users: readonly string[],
) =>
  Effect.gen(function* (): Effect.fn.Return<DiscordAccessTestPost, unknown> {
    const channel = yield* Effect.result(Effect.tryPromise(() => client.channels.fetch(channelId)));
    if (channel._tag === "Failure") return refusal(channel.failure.cause);
    const forum = channel.success?.type === ChannelType.GuildForum;
    const request = forum
      ? `mention <@${client.user.id}> in this post to confirm you can use Factory.`
      : REQUEST;
    const allowed_mentions = { parse: [], users };
    let target = channelId;
    for (const [index, content] of accessTestMessages(users, request).entries()) {
      const startsPost = forum && index === 0;
      const posted = yield* Effect.result(
        Effect.tryPromise(
          () =>
            (startsPost
              ? client.rest.post(Routes.threads(channelId), {
                  body: { name: FORUM_POST_NAME, message: { content, allowed_mentions } },
                })
              : client.rest.post(Routes.channelMessages(target), {
                  body: { content, allowed_mentions },
                })) as Promise<{ id: string }>,
        ),
      );
      if (posted._tag === "Failure") return refusal(posted.failure.cause);
      // A forum post's later messages go into its thread, which alone identifies the test there.
      if (forum && !startsPost) continue;
      if (startsPost) target = posted.success.id;
      yield* sql`INSERT INTO chat_access_test_messages (message_id,channel_id)
        SELECT ${posted.success.id},${channelId}
        WHERE EXISTS (SELECT 1 FROM chat_access_channels WHERE channel_id=${channelId})`;
    }
    return "posted";
  });

/**
 * The test's users the committed Access still allows, or none when `channelId` no longer grants a
 * Project: an Access save while the test is being posted applies to every later post.
 */
const committedRecipients = (
  sql: SqlClient.SqlClient,
  channelId: string,
  users: readonly string[],
) =>
  Effect.gen(function* () {
    const granting = yield* sql`SELECT 1 FROM chat_access_channel_projects g
      JOIN projects p ON p.id=g.project_id WHERE g.channel_id=${channelId}`;
    if (granting.length === 0) return [];
    const allowed = new Set(
      (yield* sql<{ user_id: string }>`SELECT user_id FROM chat_access_users`).map(
        (row) => row.user_id,
      ),
    );
    return users.filter((userId) => allowed.has(userId));
  });

/**
 * Posts the access test in every saved allowed channel that grants a Project, mentioning every
 * saved allowed user, and replaces the previous test: everyone it asks is Waiting again. Only the
 * mentioned users are pinged; the message mentions no role or everyone. Earlier tests' messages
 * stay recognised, so a late reply to them still answers instead of reaching ordinary admission.
 * Each post and recorded result honours the Access committed at that moment, so an Access save
 * during the test neither reaches revoked recipients nor restores the results it dropped.
 */
export const sendAccessTest = (sql: SqlClient.SqlClient, client: Client<true>) =>
  Effect.gen(function* (): Effect.fn.Return<Result<undefined>, unknown> {
    const asked = yield* sql.withTransaction(
      Effect.gen(function* () {
        const users = (yield* sql<{
          user_id: string;
        }>`SELECT user_id FROM chat_access_users ORDER BY position`).map((row) => row.user_id);
        // A channel granting no Project Factory knows admits no reply, so it is not asked.
        const channels = (yield* sql<{
          channel_id: string;
        }>`SELECT c.channel_id FROM chat_access_channels c
          WHERE EXISTS (SELECT 1 FROM chat_access_channel_projects g JOIN projects p ON p.id=g.project_id
            WHERE g.channel_id=c.channel_id)
          ORDER BY c.position`).map((row) => row.channel_id);
        if (users.length === 0 || channels.length === 0) return null;
        yield* sql`DELETE FROM chat_access_test_users`;
        for (const userId of users)
          yield* sql`INSERT INTO chat_access_test_users (user_id) VALUES (${userId})`;
        return { users, channels };
      }),
    );
    if (asked === null)
      return failure(
        "validation",
        "Save an allowed user and a channel that grants a Project, then send the access test.",
      );
    const posts: { channelId: string; outcome: DiscordAccessTestPost }[] = [];
    for (const channelId of asked.channels) {
      const recipients = yield* committedRecipients(sql, channelId, asked.users);
      if (recipients.length === 0) continue;
      posts.push({ channelId, outcome: yield* postInChannel(sql, client, channelId, recipients) });
    }
    const sentAt = yield* now;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM chat_access_test_channels`;
        for (const post of posts)
          yield* sql`INSERT INTO chat_access_test_channels (channel_id,outcome,sent_at)
            SELECT ${post.channelId},${post.outcome},${sentAt}
            WHERE EXISTS (SELECT 1 FROM chat_access_channels WHERE channel_id=${post.channelId})`;
      }),
    );
    return { ok: true, value: undefined };
  });

/**
 * Whether `messageId` is one of the test's messages in `channelId`, this test's or an earlier
 * one's; a forum's test is identified by its post's thread.
 */
export const isAccessTestMessage = (
  sql: SqlClient.SqlClient,
  channelId: string,
  messageId: string,
) =>
  Effect.map(
    sql`SELECT 1 FROM chat_access_test_messages WHERE message_id=${messageId} AND channel_id=${channelId}`,
    (rows) => rows.length > 0,
  );

/** Records that an allowed user answered the test; the latest answer's time is kept. */
export const recordReached = (sql: SqlClient.SqlClient, userId: string) =>
  Effect.gen(function* () {
    const reachedAt = yield* now;
    yield* sql`INSERT INTO chat_access_test_users (user_id,reached_at) VALUES (${userId},${reachedAt})
      ON CONFLICT (user_id) DO UPDATE SET reached_at=excluded.reached_at`;
  });

/** Drops the test's results for channels and users the saved Access no longer lists. */
export const forgetRemovedFromTest = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* sql`DELETE FROM chat_access_test_messages WHERE channel_id NOT IN (SELECT channel_id FROM chat_access_channels)`;
    yield* sql`DELETE FROM chat_access_test_channels WHERE channel_id NOT IN (SELECT channel_id FROM chat_access_channels)`;
    yield* sql`DELETE FROM chat_access_test_users WHERE user_id NOT IN (SELECT user_id FROM chat_access_users)`;
  });

/** The latest access test, or null before one was sent to a channel Access still lists. */
export const readAccessTest = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const channels = yield* sql<{
      channel_id: string;
      outcome: DiscordAccessTestPost;
      sent_at: string;
    }>`SELECT channel_id,outcome,sent_at FROM chat_access_test_channels`;
    if (channels.length === 0) return null;
    const users = yield* sql<{
      user_id: string;
      reached_at: string | null;
    }>`SELECT user_id,reached_at FROM chat_access_test_users`;
    return {
      sentAt: channels[0]!.sent_at,
      channels: Object.fromEntries(channels.map((row) => [row.channel_id, row.outcome])),
      users: Object.fromEntries(users.map((row) => [row.user_id, row.reached_at])),
    } satisfies DiscordAccessTest;
  });
