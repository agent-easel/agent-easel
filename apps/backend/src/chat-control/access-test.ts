import { DiscordAPIError, RESTJSONErrorCodes, Routes, type Client } from "discord.js";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { DiscordAccessTest, DiscordAccessTestPost, Result } from "@t3-factory/contracts";
import { failure } from "../result.ts";
import { now } from "../time.ts";

const REQUEST = "reply here to confirm you can use Factory.";
const MESSAGE_LIMIT = 2000;

/** The test's text: every allowed user mentioned, split across messages within Discord's length. */
function accessTestMessages(users: readonly string[]) {
  const messages: string[] = [];
  let mentions = "";
  for (const mention of users.map((id) => `<@${id}>`)) {
    const next = mentions ? `${mentions} ${mention}` : mention;
    if (`${next}, ${REQUEST}`.length > MESSAGE_LIMIT) {
      messages.push(`${mentions}, ${REQUEST}`);
      mentions = mention;
    } else mentions = next;
  }
  messages.push(`${mentions}, ${REQUEST}`);
  return messages;
}

/** What one refused post means for the channel: Discord does not know it, or refused the bot. */
const refusal = (error: unknown): DiscordAccessTestPost =>
  error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel
    ? "unknown-channel"
    : "cant-post";

/**
 * Posts the access test in every saved allowed channel, mentioning every saved allowed user, and
 * replaces the previous test: everyone it asks is Waiting again. Only the mentioned users are
 * pinged; the message mentions no role or everyone.
 */
export const sendAccessTest = (sql: SqlClient.SqlClient, client: Client<true>) =>
  Effect.gen(function* (): Effect.fn.Return<Result<undefined>, unknown> {
    const users = (yield* sql<{
      user_id: string;
    }>`SELECT user_id FROM chat_access_users ORDER BY position`).map((row) => row.user_id);
    const channels = (yield* sql<{
      channel_id: string;
    }>`SELECT channel_id FROM chat_access_channels ORDER BY position`).map((row) => row.channel_id);
    if (users.length === 0 || channels.length === 0)
      return failure("validation", "Save an allowed user and channel, then send the access test.");
    const texts = accessTestMessages(users);
    const posts: { channelId: string; outcome: DiscordAccessTestPost; messageIds: string[] }[] = [];
    for (const channelId of channels) {
      const messageIds: string[] = [];
      let outcome: DiscordAccessTestPost = "posted";
      for (const content of texts) {
        const posted = yield* Effect.result(
          Effect.tryPromise(
            () =>
              client.rest.post(Routes.channelMessages(channelId), {
                body: { content, allowed_mentions: { parse: [], users } },
              }) as Promise<{ id: string }>,
          ),
        );
        if (posted._tag === "Failure") {
          outcome = refusal(posted.failure.cause);
          break;
        }
        messageIds.push(posted.success.id);
      }
      posts.push({ channelId, outcome, messageIds });
    }
    const sentAt = yield* now;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM chat_access_test_messages`;
        yield* sql`DELETE FROM chat_access_test_channels`;
        yield* sql`DELETE FROM chat_access_test_users`;
        for (const post of posts) {
          yield* sql`INSERT INTO chat_access_test_channels (channel_id,outcome,sent_at) VALUES (${post.channelId},${post.outcome},${sentAt})`;
          for (const messageId of post.messageIds)
            yield* sql`INSERT INTO chat_access_test_messages (message_id,channel_id) VALUES (${messageId},${post.channelId})`;
        }
        for (const userId of users)
          yield* sql`INSERT INTO chat_access_test_users (user_id) VALUES (${userId})`;
      }),
    );
    return { ok: true, value: undefined };
  });

/** Whether `messageId` is one of the latest test's messages in `channelId`. */
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
