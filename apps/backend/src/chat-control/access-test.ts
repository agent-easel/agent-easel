import { ChannelType, DiscordAPIError, RESTJSONErrorCodes, Routes, type Client } from "discord.js";
import * as Effect from "effect/Effect";
import type * as Cause from "effect/Cause";
import type * as Attempt from "effect/Result";
import type * as SqlClient from "effect/sql/SqlClient";
import type { DiscordAccessTest, DiscordAccessTestPost, Result } from "@t3-factory/contracts";
import { failure } from "../result.ts";
import { now } from "../time.ts";

const REQUEST = "reply here to confirm you can use Factory.";
const MESSAGE_LIMIT = 2000;
const FORUM_POST_NAME = "Factory access test";

/**
 * The test's next message: as many of `users` as fit within Discord's length, mentioned in order.
 * The rest wait for a later message.
 */
function nextMessage(users: readonly string[], request: string) {
  let mentioned = 1;
  let mentions = `<@${users[0]}>`;
  for (const userId of users.slice(1)) {
    const next = `${mentions} <@${userId}>`;
    if (`${next}, ${request}`.length > MESSAGE_LIMIT) break;
    mentions = next;
    mentioned += 1;
  }
  return { content: `${mentions}, ${request}`, mentioned: users.slice(0, mentioned) };
}

/** What one refused request means for the channel: Discord does not know it, or refused the bot. */
const refusal = (error: unknown): DiscordAccessTestPost =>
  error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel
    ? "unknown-channel"
    : "cant-post";

/**
 * The test's users the committed Access still allows, or none when `channelId` no longer grants a
 * Project: an Access save while the test is being posted applies to every later request.
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

/** How the test asks in `channelId`, which Discord looks up: a forum takes no messages outside its posts. */
const channelRequest = (client: Client<true>, channelId: string) =>
  Effect.map(
    Effect.tryPromise(() => client.channels.fetch(channelId)),
    (channel) =>
      channel?.type === ChannelType.GuildForum
        ? {
            forum: true,
            request: `mention <@${client.user.id}> in this post to confirm you can use Factory.`,
          }
        : { forum: false, request: REQUEST },
  );

/**
 * Sends one of the test's messages, pinging only `users`. In a forum the first message starts the
 * test's forum post and later ones go into that post's thread `post`; elsewhere each goes to the
 * channel.
 */
const sendMessage = (
  client: Client<true>,
  channelId: string,
  forum: boolean,
  post: string | null,
  content: string,
  users: readonly string[],
) => {
  const allowed_mentions = { parse: [], users };
  return Effect.tryPromise(
    () =>
      (forum && post === null
        ? client.rest.post(Routes.threads(channelId), {
            body: { name: FORUM_POST_NAME, message: { content, allowed_mentions } },
          })
        : client.rest.post(Routes.channelMessages(post ?? channelId), {
            body: { content, allowed_mentions },
          })) as Promise<{ id: string }>,
  );
};

/**
 * Posts the test in one channel and records each message the moment Discord accepts it, so a
 * reply to it is an answer even while later channels are still being posted in. A forum gets one
 * forum post: a thread whose ID its starter message shares, which identifies the test there.
 * Each message is composed from the Access committed just before it is sent, since an Access save
 * may land during the channel lookup or an earlier message. Null when Access left no one to ask
 * before anything was posted.
 */
const postInChannel = (
  sql: SqlClient.SqlClient,
  client: Client<true>,
  channelId: string,
  users: readonly string[],
) =>
  Effect.gen(function* (): Effect.fn.Return<DiscordAccessTestPost | null, unknown> {
    let unasked = yield* committedRecipients(sql, channelId, users);
    if (unasked.length === 0) return null;
    const channel = yield* Effect.result(channelRequest(client, channelId));
    if (channel._tag === "Failure") return refusal(channel.failure.cause);
    const { forum, request } = channel.success;
    let sent = false;
    let post: string | null = null;
    while (true) {
      unasked = yield* committedRecipients(sql, channelId, unasked);
      if (unasked.length === 0) return sent ? "posted" : null;
      const { content, mentioned } = nextMessage(unasked, request);
      unasked = unasked.slice(mentioned.length);
      const posted: Attempt.Result<{ readonly id: string }, Cause.UnknownError> =
        yield* Effect.result(sendMessage(client, channelId, forum, post, content, mentioned));
      if (posted._tag === "Failure") return refusal(posted.failure.cause);
      sent = true;
      // A forum post's later messages go into its thread, which alone identifies the test there.
      if (post !== null) continue;
      if (forum) post = posted.success.id;
      yield* sql`INSERT INTO chat_access_test_messages (message_id,channel_id)
        SELECT ${posted.success.id},${channelId}
        WHERE EXISTS (SELECT 1 FROM chat_access_channels WHERE channel_id=${channelId})`;
    }
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
      const outcome = yield* postInChannel(sql, client, channelId, asked.users);
      if (outcome !== null) posts.push({ channelId, outcome });
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
