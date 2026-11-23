import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { now } from "../time.ts";
import { channelGrants, wakeableLoop, type DiscordSender } from "./deliveries.ts";

const RESOLUTIONS = {
  confirmed: "✅ Confirmed",
  expired: "⌛ Expired",
  replaced: "↩️ Replaced",
  invalid: "🚫 No longer valid",
} as const;
type Resolution = keyof typeof RESOLUTIONS;

const EDIT_TIMEOUT = Duration.seconds(10);

type DueRow = {
  id: string;
  parent_channel_id: string;
  guild_id: string;
  thread_id: string;
  project_ids_json: string;
  confirmation_message_id: string;
  state: "presented" | "consumed" | "ended";
  ended_reason: "superseded" | "revoked" | null;
  action_state: "accepted" | "rejected" | null;
};

const resolutionOf = (row: DueRow): Resolution => {
  if (row.state === "presented") return "expired";
  if (row.state === "consumed") return row.action_state === "accepted" ? "confirmed" : "invalid";
  return row.ended_reason === "superseded" ? "replaced" : "invalid";
};

export const reviewResolutions = (sql: SqlClient.SqlClient) => {
  const loop = wakeableLoop();

  const due = (applicationId: string, at: string) =>
    sql<DueRow>`SELECT p.id,p.guild_id,p.parent_channel_id,p.thread_id,p.project_ids_json,p.confirmation_message_id,
        p.state,p.ended_reason,a.state AS action_state
      FROM chat_proposals p LEFT JOIN chat_actions a ON a.proposal_id=p.id
      WHERE p.application_id=${applicationId} AND p.resolution_settled=0 AND p.confirmation_message_id IS NOT NULL
        AND (p.state='consumed' OR (p.state='ended' AND p.ended_reason IN ('superseded','revoked'))
          OR (p.state='presented' AND p.expires_at<=${at}))
      ORDER BY p.created_at,p.rowid`;

  const resolve = (sender: DiscordSender, row: DueRow) =>
    Effect.gen(function* () {
      const claimed =
        yield* sql`UPDATE chat_proposals SET resolution_settled=1 WHERE id=${row.id} AND resolution_settled=0 RETURNING id`;
      if (claimed.length === 0) return;
      const granted = yield* channelGrants(sql, row.parent_channel_id);
      if ((JSON.parse(row.project_ids_json) as string[]).some((id) => !granted.has(id))) return;
      yield* Effect.tryPromise(() =>
        sender.edit(
          {
            guildId: row.guild_id,
            parentChannelId: row.parent_channel_id,
            threadId: row.thread_id,
          },
          row.confirmation_message_id,
          RESOLUTIONS[resolutionOf(row)],
        ),
      ).pipe(Effect.timeoutOption(EDIT_TIMEOUT), Effect.ignore);
    });

  const serve = (sender: DiscordSender) =>
    Effect.gen(function* () {
      const startedAt = yield* now;
      yield* sql`UPDATE chat_proposals SET resolution_settled=1 WHERE resolution_settled=0 AND confirmation_message_id IS NOT NULL
        AND state='presented' AND expires_at<=${startedAt}`;
      return yield* loop.run(
        Effect.gen(function* () {
          const at = yield* now;
          for (const row of yield* due(sender.applicationId, at)) yield* resolve(sender, row);
          const [next] = yield* sql<{
            expires_at: string | null;
          }>`SELECT MIN(expires_at) AS expires_at
            FROM chat_proposals WHERE application_id=${sender.applicationId} AND resolution_settled=0
              AND confirmation_message_id IS NOT NULL AND state='presented'`;
          return next?.expires_at ?? null;
        }),
      );
    });

  return {
    serve,
    changed: Effect.sync(loop.wake),
  };
};
