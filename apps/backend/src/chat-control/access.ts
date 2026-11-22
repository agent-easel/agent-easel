import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  DiscordAccessConfiguration,
  Result,
  UpdateDiscordAccessInput,
} from "@t3-factory/contracts";
import { failure } from "../result.ts";
import { now } from "../time.ts";
import { forgetRemovedFromTest, readAccessTest } from "./access-test.ts";
import { clearConversations } from "./conversations.ts";
import type { DiscordIds, DiscordNames } from "./discord-gateway.ts";
import { applyAccessRevocation } from "./revocation.ts";

type AccessRow = { revision: number; saved_at: string | null };
type GrantRow = { channel_id: string; project_id: string | null; known: number | null };

/** The saved Access section with the granted Projects Factory still knows. */
export const readAccess = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const [row] =
      yield* sql<AccessRow>`SELECT revision,saved_at FROM chat_access_settings WHERE singleton=1`;
    const users = yield* sql<{
      user_id: string;
    }>`SELECT user_id FROM chat_access_users ORDER BY position`;
    const grants = yield* sql<GrantRow>`SELECT c.channel_id,g.project_id,p.id IS NOT NULL AS known
      FROM chat_access_channels c
      LEFT JOIN chat_access_channel_projects g ON g.channel_id=c.channel_id
      LEFT JOIN projects p ON p.id=g.project_id
      ORDER BY c.position,g.position`;
    const channels = new Map<string, string[]>();
    const unresolved = new Set<string>();
    for (const grant of grants) {
      const projects = channels.get(grant.channel_id) ?? [];
      channels.set(grant.channel_id, projects);
      if (grant.project_id === null) continue;
      projects.push(grant.project_id);
      if (grant.known !== 1) unresolved.add(grant.project_id);
    }
    const bots = yield* sql<{
      user_id: string;
    }>`SELECT user_id FROM chat_access_bots ORDER BY position`;
    const names = yield* sql<{
      kind: "user" | "channel";
      discord_id: string;
      name: string | null;
      is_bot: number | null;
    }>`SELECT kind,discord_id,name,is_bot FROM chat_discord_names`;
    const named = (kind: "user" | "channel") =>
      Object.fromEntries(
        names.filter((row) => row.kind === kind).map((row) => [row.discord_id, row.name]),
      );
    return {
      users: users.map((user) => user.user_id),
      bots: bots.map((bot) => bot.user_id),
      channels: [...channels].map(([channelId, projectIds]) => ({ channelId, projectIds })),
      unresolvedProjectIds: [...unresolved],
      userNames: named("user"),
      accountKinds: Object.fromEntries(
        names
          .filter((row) => row.kind === "user" && row.is_bot !== null)
          .map((row) => [row.discord_id, row.is_bot === 1 ? "bot" : "human"] as const),
      ),
      channelNames: named("channel"),
      test: yield* readAccessTest(sql),
      revision: row!.revision,
      savedAt: row!.saved_at,
    } satisfies DiscordAccessConfiguration;
  });

/**
 * The Factory Projects a parent channel grants to an allowed user right now: empty unless the user
 * and the channel are both listed. A granted Project Factory no longer knows grants nothing.
 */
export const grantedProjects = (
  sql: SqlClient.SqlClient,
  userId: string,
  parentChannelId: string,
) =>
  Effect.map(
    sql<{ project_id: string }>`SELECT g.project_id FROM chat_access_channel_projects g
      JOIN projects p ON p.id=g.project_id
      WHERE g.channel_id=${parentChannelId}
        AND EXISTS (SELECT 1 FROM chat_access_users WHERE user_id=${userId})
      ORDER BY g.position`,
    (rows) => rows.map((row) => row.project_id),
  );

/** The IDs of one list that Discord's latest lookup showed belong to the other kind of account. */
const wrongListIssues = (
  ids: readonly string[],
  path: "users" | "bots",
  wrongKind: "bot" | "human",
  access: DiscordAccessConfiguration,
) =>
  ids.flatMap((id, index) =>
    access.accountKinds[id] === wrongKind
      ? [
          {
            code:
              wrongKind === "bot" ? "discord_access_bot_in_users" : "discord_access_human_in_bots",
            path: `${path}[${index}]`,
            message:
              wrongKind === "bot"
                ? `${access.userNames[id] ?? id} is a bot. Move its ID to Bots, then save.`
                : `${access.userNames[id] ?? id} is not a bot. Move its ID to Users, then save.`,
          },
        ]
      : [],
  );

const STALE_EDIT = "Access changed since these edits began. Review the saved Access and try again.";

/**
 * Commits the whole Access section as one revision. Authorization reads the committed rows on every
 * event, so a save, including a revocation, is in effect for all later admission and publication
 * by the time it returns. Returns the proposals the save ended.
 */
export const updateAccess = (sql: SqlClient.SqlClient, input: UpdateDiscordAccessInput) =>
  sql.withTransaction(
    Effect.gen(function* (): Effect.fn.Return<Result<readonly string[]>, unknown> {
      const [row] =
        yield* sql<AccessRow>`SELECT revision,saved_at FROM chat_access_settings WHERE singleton=1`;
      if (row!.revision !== input.revision) return failure("conflict", STALE_EDIT);
      const before = yield* readAccess(sql);
      const known = new Set(
        (yield* sql<{ id: string }>`SELECT id FROM projects`).map((project) => project.id),
      );
      // A Project Factory no longer knows may stay granted as it was, but cannot be newly granted.
      const issues = input.channels.flatMap((channel, index) =>
        channel.projectIds.flatMap((projectId, position) =>
          known.has(projectId) ||
          before.channels.some(
            (saved) =>
              saved.channelId === channel.channelId && saved.projectIds.includes(projectId),
          )
            ? []
            : [
                {
                  code: "discord_access_project",
                  path: `channels[${index}].projectIds[${position}]`,
                  message: "Factory has no Project with this ID. Choose one of Factory's Projects.",
                },
              ],
        ),
      );
      if (issues.length > 0) return failure("validation", "Choose Projects Factory knows.", issues);
      // Discord's own user data decides: a known bot never gets a user's place, nor a human a bot's.
      const wrongList = [
        ...wrongListIssues(input.users, "users", "bot", before),
        ...wrongListIssues(input.bots, "bots", "human", before),
      ];
      if (wrongList.length > 0)
        return failure("validation", "Move each ID to its own list.", wrongList);
      // Narrowing or removing a channel's Project scope clears its whole shared conversations,
      // mixed-Project prose included; an expansion keeps them, and a regrant restores nothing.
      yield* clearConversations(sql, {
        parentChannelIds: before.channels.flatMap((saved) => {
          const kept = input.channels.find((channel) => channel.channelId === saved.channelId);
          return kept && saved.projectIds.every((id) => kept.projectIds.includes(id))
            ? []
            : [saved.channelId];
        }),
      });
      // Revoked consent never returns, and a revoked destination's owed messages are cancelled.
      const ended = yield* applyAccessRevocation(sql, input);
      const savedAt = yield* now;
      yield* sql`DELETE FROM chat_access_channel_projects`;
      yield* sql`DELETE FROM chat_access_channels`;
      yield* sql`DELETE FROM chat_access_users`;
      for (const [position, userId] of input.users.entries())
        yield* sql`INSERT INTO chat_access_users (user_id,position) VALUES (${userId},${position})`;
      yield* sql`DELETE FROM chat_access_bots`;
      for (const [position, botId] of input.bots.entries())
        yield* sql`INSERT INTO chat_access_bots (user_id,position) VALUES (${botId},${position})`;
      for (const [position, channel] of input.channels.entries()) {
        yield* sql`INSERT INTO chat_access_channels (channel_id,position) VALUES (${channel.channelId},${position})`;
        for (const [index, projectId] of channel.projectIds.entries())
          yield* sql`INSERT INTO chat_access_channel_projects (channel_id,project_id,position) VALUES (${channel.channelId},${projectId},${index})`;
      }
      yield* forgetRemovedFromTest(sql);
      yield* sql`UPDATE chat_access_settings SET revision=revision+1,saved_at=${savedAt} WHERE singleton=1`;
      return { ok: true, value: ended };
    }),
  );

/** The allowed user and channel IDs, for a name lookup. */
export const accessIds = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const users = yield* sql<{
      id: string;
    }>`SELECT user_id AS id FROM chat_access_users UNION SELECT user_id FROM chat_access_bots`;
    const channels = yield* sql<{ id: string }>`SELECT channel_id AS id FROM chat_access_channels`;
    return {
      users: users.map((row) => row.id),
      channels: channels.map((row) => row.id),
    } satisfies DiscordIds;
  });

/** Replaces the recorded names with the latest lookup. */
export const recordNames = (sql: SqlClient.SqlClient, names: DiscordNames) =>
  sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM chat_discord_names`;
      for (const [kind, entries] of [
        ["user", names.users],
        ["channel", names.channels],
      ] as const)
        for (const [id, name] of entries) {
          const isBot = kind === "user" && name !== null ? Number(names.bots.has(id)) : null;
          yield* sql`INSERT INTO chat_discord_names (kind,discord_id,name,is_bot) VALUES (${kind},${id},${name},${isBot})`;
        }
    }),
  );
