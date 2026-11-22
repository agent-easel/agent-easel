import type { Telemetry } from "../telemetry.ts";
import { createHash, randomInt } from "node:crypto";
import type { JSONValue } from "ai";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { ChatActionOperation, ChatActionReconciliation } from "@t3-factory/contracts";
import type { StartAuthorization } from "../runner/runner-start.ts";
import { failure } from "../result.ts";
import { newId } from "../ids.ts";
import { now } from "../time.ts";
import { grantedProjects } from "./access.ts";
import type { BotGuardDecision, BotGuards } from "./bot-guards.ts";
import { ACTION_REQUESTERS, type RequesterKind } from "./requesters.ts";
import type { ConversationKey } from "./conversations.ts";
import {
  createDeduplicated,
  nonceOf,
  oweDelivery,
  type ChatDeliveries,
  type Destination,
  type DiscordSender,
} from "./deliveries.ts";
import { characters } from "./interpretation.ts";
import { reviewResolutions } from "./review-resolutions.ts";
import { at } from "./status-cards.ts";

/** The mutation kinds Chat control can propose; each has one shared Factory operation. */
export type ChatOperationName = ChatActionOperation;

const CONSENT_MS = 5 * 60_000;
/** The longest complete review, all parts together, in Unicode characters. */
const REVIEW_CHARACTER_LIMIT = 32_000;

const CODE_ALPHABET = "ACDEFHJKMNPQRTWXY34679";
const CODE_LENGTH = 4;
const PHRASE_SHAPE = /^confirm [A-Za-z0-9]{4}$/i;

const phraseOf = (code: string) => `confirm ${code}`;

const newCode = () =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
    "",
  );

const confirmationText = (code: string, expiresAt: string) =>
  `🔒 To confirm, reply to this message with \`${phraseOf(code)}\` · only the requester can confirm · expires ${at(expiresAt)}`;

/** The latest expiry whose Discord timestamp has as many digits as any expiry Factory posts. */
const LONGEST_EXPIRY = new Date(9_999_999_999_000).toISOString();
const LONGEST_MENTION = `<@${"9".repeat(20)}> `;

export const exceedsReviewLimit = (review: readonly string[]) =>
  characters(
    [...review, LONGEST_MENTION, confirmationText("X".repeat(CODE_LENGTH), LONGEST_EXPIRY)].join(
      "",
    ),
  ) > REVIEW_CHARACTER_LIMIT;

/**
 * A mutation call Factory validated into an exact proposal: what would be performed, which
 * Projects it targets and the complete review Factory renders for it, as ordered message parts.
 */
export interface Proposed {
  readonly operation: ChatOperationName;
  /** The exact parameters a confirmation performs; immutable once proposed. */
  readonly parameters: JSONValue;
  readonly projectIds: readonly string[];
  readonly review: readonly string[];
  /** Compact targets the turn retains as the proposal fact. */
  readonly targets: JSONValue;
  /** A pending proposal of the same requester and thread this one corrects. */
  readonly supersedes: string | undefined;
}

/** How performing a confirmed action ended, as the shared operation reported it. */
export type ActionOutcome =
  /** Accepted: `facts` are the actual accepted facts; `originRunId` a Run this context started. */
  | { readonly kind: "accepted"; readonly facts: JSONValue; readonly originRunId?: string }
  /** A definitive local rejection that proved no effect; the attempt is used up. */
  | { readonly kind: "rejected"; readonly facts: JSONValue }
  /** Unavailable before any decision, with no effect: the consent stays live. */
  | { readonly kind: "unavailable" }
  /** Whether the operation took effect is not established yet. */
  | { readonly kind: "unknown" };

/**
 * One mutation kind's binding to its shared Factory operation. `execute` performs the exact
 * parameters under the action's stable identity; `reconcile` only reads whether that identity
 * was accepted (`unavailable` proves it was not); `receipt` renders the deterministic result, or
 * nothing when the outcome's own report (an accepted Start's status card) announces it.
 */
export interface ChatOperation {
  readonly name: ChatOperationName;
  readonly execute: (
    actionId: string,
    parameters: JSONValue,
    authorization: StartAuthorization,
  ) => Effect.Effect<ActionOutcome, unknown>;
  readonly reconcile: (
    actionId: string,
    parameters: JSONValue,
  ) => Effect.Effect<ActionOutcome, unknown>;
  readonly receipt: (
    outcome: Extract<ActionOutcome, { facts: JSONValue }>,
    parameters: JSONValue,
  ) => string | undefined;
  readonly summary: (outcome: Extract<ActionOutcome, { facts: JSONValue }>) => string;
  /** The primary target whose newer proposal corrects an older one: a Project, occurrence or Run. */
  readonly target: (parameters: JSONValue) => string;
}

/** Where and for whom a proposal was made, from the admitted invocation. */
interface ProposalContext {
  readonly conversation: ConversationKey;
  readonly requesterId: string;
  readonly requesterKind: RequesterKind;
  readonly generation: number;
  readonly messageId: string;
  readonly toolCallId: string;
}

type ProposalState = "preparing" | "presented" | "accepting" | "consumed" | "ended";

type ProposalRow = {
  id: string;
  application_id: string;
  guild_id: string;
  parent_channel_id: string;
  thread_id: string;
  requester_id: string;
  operation: ChatOperationName;
  parameters_json: string;
  project_ids_json: string;
  state: ProposalState;
  ended_reason: "failed" | "superseded" | "revoked" | "application" | null;
  expires_at: string | null;
  confirmation_code: string | null;
  confirmation_message_id: string | null;
};

type ActionRow = {
  id: string;
  proposal_id: string;
  state: "accepting" | "accepted" | "rejected";
  started_at: string;
  outcome_json: string | null;
};

/** A proposal's current state as later turns see it: content-free facts, never a full review. */
export type ProposalStatus =
  | { readonly state: "awaiting-confirmation"; readonly expiresAt: string }
  | { readonly state: "expired" | "confirming" | "no-longer-valid" | "not-presented" }
  | { readonly state: "accepted" | "rejected"; readonly outcome: JSONValue };

export interface ConfirmationReply {
  readonly proposalId: string | undefined;
  readonly authorId: string;
  readonly threadId: string;
  readonly applicationId: string;
  readonly text: string;
  readonly repliedTo: string | undefined;
  /** Whether that session still operates: Chat control On and the session not released. */
  readonly operating: () => boolean;
  readonly access: Effect.Effect<"permitted" | "denied" | "unavailable", unknown>;
  /** Whether the last affirmative check still has qualified evidence; no external I/O. */
  readonly accessCurrent: () => boolean;
}

const REPLIES = {
  notYours:
    "🔒 Only the person who asked for this review can confirm it. Ask Factory for your own.",
  notReply:
    "↪️ Nothing was done. To confirm, reply to the review's last message with its exact confirmation phrase.",
  wrongPhrase:
    "🔤 That is not this review's confirmation phrase, so nothing was done. Reply with the exact phrase before the review expires.",
  invalid: "🚫 This confirmation is no longer valid. Ask Factory for a new review.",
  expired: "⌛ This review expired, so nothing was done. Ask Factory for a new review.",
  denied: "🚫 Chat control does not accept this confirmation from you here.",
  unavailable:
    "⚠️ Factory could not confirm your access to this thread, so nothing was done. Try again before the review expires.",
  confirming: "⏳ Factory is already working on this confirmation.",
  notNow:
    "⚠️ Factory could not act on this right now and did nothing. Try again before the review expires.",
  unknown:
    "❓ Factory cannot tell yet whether this was accepted. It will not perform it again; the result follows here once Factory knows.",
} as const;

type ConfirmationAnswer =
  | { readonly kind: "reply"; readonly text: string }
  | { readonly kind: "decided" };

const replied = (text: string): ConfirmationAnswer => ({ kind: "reply", text });

const PREPARATION_FAILED =
  "⚠️ Factory could not post the complete review, so it cannot be confirmed. Ask again for a new review.";

const identityOf = (context: ProposalContext, proposed: Proposed) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        context.conversation.applicationId,
        context.conversation.threadId,
        context.requesterId,
        proposed.operation,
        proposed.parameters,
      ]),
    )
    .digest("hex");

const destinationOf = (row: ProposalRow): Destination => ({
  guildId: row.guild_id,
  parentChannelId: row.parent_channel_id,
  threadId: row.thread_id,
});

const outcomeAnswer = (kind: ActionOutcome["kind"]): ConfirmationAnswer => {
  if (kind === "unavailable") return replied(REPLIES.notNow);
  if (kind === "unknown") return replied(REPLIES.unknown);
  return { kind: "decided" };
};

function replyRefusal(
  row: ProposalRow | undefined,
  reply: ConfirmationReply,
): keyof typeof REPLIES | "repeated" | undefined {
  if (!row || row.application_id !== reply.applicationId || row.thread_id !== reply.threadId)
    return "invalid";
  if (row.requester_id !== reply.authorId) return "notYours";
  if (row.confirmation_message_id === null) return row.state === "preparing" ? "notNow" : "invalid";
  if (reply.repliedTo !== row.confirmation_message_id) return "notReply";
  if (row.state === "accepting" || row.state === "consumed") return "repeated";
  if (row.state !== "presented" || row.confirmation_code === null) return "invalid";
  return reply.text === phraseOf(row.confirmation_code) ? undefined : "wrongPhrase";
}

type StatusRow = ProposalRow & {
  action_state: ActionRow["state"] | null;
  outcome_json: string | null;
};

/** A proposal's state for later turns at epoch milliseconds `at`. */
function statusOf(row: StatusRow, at: number): ProposalStatus {
  switch (row.state) {
    case "consumed":
      return {
        state: row.action_state as "accepted" | "rejected",
        outcome: JSON.parse(row.outcome_json!) as JSONValue,
      };
    case "accepting":
      return { state: "confirming" };
    case "ended":
      return { state: row.ended_reason === "failed" ? "not-presented" : "no-longer-valid" };
    case "preparing":
      return { state: "not-presented" };
    case "presented":
      return at >= Date.parse(row.expires_at!)
        ? { state: "expired" }
        : { state: "awaiting-confirmation", expiresAt: row.expires_at! };
  }
}

export function makeChatActions(
  sql: SqlClient.SqlClient,
  operations: readonly ChatOperation[],
  deliveries: ChatDeliveries,
  /** Told after a committed origin, so its Run's status card is captured now. */
  originRecorded: (runId: string) => void,
  /** Told after a Human answer review became confirmable, failed or ended, so the Run's own answer
   * form shows whether a Discord confirmation is waiting. */
  answerReviewChanged: (runId: string) => void,
  telemetry: Telemetry,
  botGuards: BotGuards,
) {
  const byName = new Map(operations.map((operation) => [operation.name, operation]));
  const resolutions = reviewResolutions(sql);
  /** Actions this process is performing right now. */
  const performing = new Set<string>();

  const proposal = (id: string) =>
    Effect.map(sql<ProposalRow>`SELECT * FROM chat_proposals WHERE id=${id}`, ([row]) => row);
  const actionOf = (proposalId: string) =>
    Effect.map(
      sql<ActionRow>`SELECT * FROM chat_actions WHERE proposal_id=${proposalId}`,
      ([row]) => row,
    );
  const expired = (row: ProposalRow) =>
    Effect.map(
      Clock.currentTimeMillis,
      (at) => row.expires_at !== null && at >= Date.parse(row.expires_at),
    );

  const scopeGranted = (row: ProposalRow) =>
    Effect.map(
      grantedProjects(
        sql,
        row.requester_id,
        row.parent_channel_id,
        ACTION_REQUESTERS[row.operation],
      ),
      (granted) =>
        (JSON.parse(row.project_ids_json) as string[]).every((id) => granted.includes(id)),
    );

  /**
   * Records a proposal, or finds the identical one still waiting for this requester here: same
   * requester, context, operation and exact parameters keep their identity and expiry. Otherwise
   * it corrects every pending proposal of the same requester, context and operation for the same
   * primary target, whatever the model said, and the one `supersedes` names: they end as
   * superseded before the new review is presented. Expired and confirmed proposals stay as they are.
   */
  const open = (proposed: Proposed, context: ProposalContext) =>
    sql
      .withTransaction(
        Effect.gen(function* (): Effect.fn.Return<
          | { readonly kind: "new"; readonly id: string }
          | { readonly kind: "pending"; readonly id: string; readonly expiresAt: string }
          | { readonly kind: "bot-pending" }
          | { readonly kind: "bot-rate"; readonly decision: Exclude<BotGuardDecision, "allow"> },
          unknown
        > {
          const identity = identityOf(context, proposed);
          const at = yield* now;
          const { conversation } = context;
          if (context.requesterKind === "bot") {
            const [pendingStart] = yield* sql<{ id: string }>`SELECT id FROM chat_proposals
              WHERE application_id=${conversation.applicationId} AND thread_id=${conversation.threadId}
                AND requester_id=${context.requesterId} AND operation='start'
                AND (state IN ('preparing','accepting') OR (state='presented' AND expires_at>${at}))
              LIMIT 1`;
            if (pendingStart) return { kind: "bot-pending" };
            const decision = botGuards.rate(context.requesterId, Date.parse(at), "proposal");
            if (decision !== "allow") return { kind: "bot-rate", decision };
          }
          const [pending] = yield* sql<{
            id: string;
            expires_at: string;
          }>`SELECT id,expires_at FROM chat_proposals WHERE identity=${identity}
            AND state IN ('presented','accepting') AND expires_at>${at} ORDER BY expires_at DESC LIMIT 1`;
          if (pending) return { kind: "pending", id: pending.id, expiresAt: pending.expires_at };
          const operation = byName.get(proposed.operation)!;
          const target = operation.target(proposed.parameters);
          const live = yield* sql<{
            id: string;
            parameters_json: string;
          }>`SELECT id,parameters_json FROM chat_proposals WHERE application_id=${conversation.applicationId}
            AND thread_id=${conversation.threadId} AND requester_id=${context.requesterId}
            AND operation=${proposed.operation} AND identity<>${identity}
            AND (state='preparing' OR (state='presented' AND expires_at>${at}))`;
          const corrected = live
            .filter(
              (row) =>
                row.id === proposed.supersedes ||
                operation.target(JSON.parse(row.parameters_json) as JSONValue) === target,
            )
            .map((row) => row.id);
          if (corrected.length > 0)
            yield* sql`UPDATE chat_proposals SET state='ended',ended_reason='superseded' WHERE id IN ${sql.in(corrected)}`;
          const id = yield* newId;
          const taken = new Set(
            (yield* sql<{
              confirmation_code: string;
            }>`SELECT confirmation_code FROM chat_proposals WHERE application_id=${conversation.applicationId}
              AND thread_id=${conversation.threadId} AND confirmation_code IS NOT NULL
              AND state IN ('preparing','presented','accepting')`).map(
              (row) => row.confirmation_code,
            ),
          );
          let code = newCode();
          while (taken.has(code)) code = newCode();
          yield* sql`INSERT INTO chat_proposals (id,application_id,guild_id,parent_channel_id,thread_id,requester_id,operation,parameters_json,identity,project_ids_json,generation,message_id,tool_call_id,state,created_at,confirmation_code)
            VALUES (${id},${conversation.applicationId},${conversation.guildId},${conversation.parentChannelId},${conversation.threadId},${context.requesterId},
              ${proposed.operation},${JSON.stringify(proposed.parameters)},${identity},${JSON.stringify(proposed.projectIds)},
              ${context.generation},${context.messageId},${context.toolCallId},'preparing',${at},${code})`;
          return { kind: "new", id };
        }),
      )
      .pipe(Effect.tap(() => resolutions.changed));

  /** Hints the Runs whose occurrences committed Human answer proposals name. */
  const answerRunsChanged = (ids: readonly string[]) =>
    ids.length === 0
      ? Effect.void
      : Effect.map(
          sql<{ run_id: string }>`SELECT DISTINCT h.run_id FROM chat_proposals p
            JOIN human_occurrences h ON h.id=json_extract(p.parameters_json,'$.occurrenceId')
            WHERE p.id IN ${sql.in(ids)} AND p.operation='human-answer'`,
          (rows) => {
            for (const row of rows) answerReviewChanged(row.run_id);
          },
        );

  const fail = (id: string) =>
    Effect.andThen(
      sql`UPDATE chat_proposals SET state='ended',ended_reason='failed' WHERE id=${id} AND state IN ('preparing','presented')`,
      answerRunsChanged([id]),
    );

  /** Whether the proposal is still being prepared and current Access still grants its targets. */
  const stillPreparing = (id: string, proposed: Proposed) =>
    Effect.gen(function* () {
      const row = yield* proposal(id);
      if (row?.state !== "preparing") return false;
      const granted = yield* grantedProjects(
        sql,
        row.requester_id,
        row.parent_channel_id,
        ACTION_REQUESTERS[row.operation],
      );
      return proposed.projectIds.every((projectId) => granted.includes(projectId));
    });

  const present = (
    id: string,
    proposed: Proposed,
    sender: DiscordSender,
    destination: Destination,
    permitted: Effect.Effect<boolean, unknown>,
  ) =>
    Effect.gen(function* (): Effect.fn.Return<"presented" | "failed" | "withdrawn", unknown> {
      const create = (text: string, nonce: string, requesterId?: string) =>
        createDeduplicated(
          sender,
          destination,
          text,
          { nonce: nonceOf("review", id, nonce) },
          Effect.succeed(requesterId === undefined ? {} : { requesterId }),
        );
      const failed = Effect.gen(function* () {
        yield* fail(id);
        yield* create(PREPARATION_FAILED, "failed");
        return "failed" as const;
      });
      const withdrawn = Effect.as(fail(id), "withdrawn" as const);
      for (const [index, part] of proposed.review.entries()) {
        if (!((yield* stillPreparing(id, proposed)) && (yield* permitted))) return yield* withdrawn;
        if (!("messageId" in (yield* create(part, `part ${index}`)))) return yield* failed;
      }
      if (!((yield* stillPreparing(id, proposed)) && (yield* permitted))) return yield* withdrawn;
      const expiresAt = new Date((yield* Clock.currentTimeMillis) + CONSENT_MS).toISOString();
      const row = (yield* proposal(id))!;
      const last = yield* create(
        confirmationText(row.confirmation_code!, expiresAt),
        "confirmation",
        row.requester_id,
      );
      if (!("messageId" in last)) return yield* failed;
      const usable = yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE chat_proposals SET confirmation_message_id=${last.messageId} WHERE id=${id}`;
          if (!(yield* stillPreparing(id, proposed))) return false;
          yield* sql`UPDATE chat_proposals SET state='presented',expires_at=${expiresAt} WHERE id=${id}`;
          return true;
        }),
      );
      yield* resolutions.changed;
      if (!usable) return yield* withdrawn;
      yield* answerRunsChanged([id]);
      return "presented";
    }).pipe(Effect.onInterrupt(() => fail(id)));

  /** Commits a decided outcome: consumption, the action's result, origin and owed receipt. */
  const decide = (row: ProposalRow, actionId: string, outcome: ActionOutcome) =>
    Effect.gen(function* () {
      const operation = byName.get(row.operation)!;
      const parameters = JSON.parse(row.parameters_json) as JSONValue;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const decidedAt = yield* now;
          if (outcome.kind === "unavailable") {
            yield* sql`DELETE FROM chat_actions WHERE id=${actionId} AND state='accepting'`;
            yield* sql`UPDATE chat_proposals SET state='presented' WHERE id=${row.id} AND state='accepting'`;
            return;
          }
          if (outcome.kind === "unknown") return;
          yield* sql`UPDATE chat_actions SET state=${outcome.kind},decided_at=${decidedAt},outcome_json=${JSON.stringify(outcome.facts)}
              WHERE id=${actionId} AND state='accepting'`;
          yield* sql`UPDATE chat_proposals SET state='consumed',ended_reason=NULL,resolution_settled=0 WHERE id=${row.id}`;
          if (outcome.kind === "accepted" && outcome.originRunId !== undefined)
            yield* sql`INSERT INTO chat_run_origins (run_id,application_id,guild_id,parent_channel_id,thread_id,action_id,recorded_at)
                VALUES (${outcome.originRunId},${row.application_id},${row.guild_id},${row.parent_channel_id},${row.thread_id},${actionId},${decidedAt})
                ON CONFLICT DO NOTHING`;
          const receipt = operation.receipt(outcome, parameters);
          if (receipt !== undefined)
            yield* oweDelivery(sql, {
              purpose: "receipt",
              actionId,
              destination: destinationOf(row),
              projectIds: JSON.parse(row.project_ids_json) as string[],
              text: receipt,
            });
        }),
      );
      if (outcome.kind === "accepted" && outcome.originRunId !== undefined) {
        botGuards.resetThread(row.thread_id);
        originRecorded(outcome.originRunId);
      }
      if (outcome.kind === "accepted" || outcome.kind === "rejected") {
        yield* deliveries.wake;
        yield* resolutions.changed;
      }
    });

  const acceptance = (row: ProposalRow, reply: ConfirmationReply): StartAuthorization => {
    const local = Effect.gen(function* () {
      const current = (yield* proposal(row.id))!;
      if (current.state !== "accepting")
        return failure("validation", "This confirmation is no longer valid.");
      if (yield* expired(current))
        return failure("validation", "This review expired before Factory accepted the Start.");
      const [state] = yield* sql<{
        enabled: number;
        application_id: string | null;
      }>`SELECT enabled,application_id FROM chat_control_state WHERE singleton=1`;
      if (!state!.enabled || !reply.operating())
        return failure("conflict", "Chat control is Off. Nothing was started.");
      if (state!.application_id !== current.application_id)
        return failure(
          "validation",
          "The Discord application changed before Factory accepted the Start.",
        );
      if (!(yield* scopeGranted(current)))
        return failure("validation", "Access no longer permits this Start.");
      return { ok: true as const, value: undefined };
    });
    return {
      check: Effect.gen(function* () {
        const allowed = yield* local;
        if (!allowed.ok) return allowed;
        if (!reply.operating())
          return failure("conflict", "Chat control is Off. Nothing was started.");
        // A denied or unresolved Discord check refuses this attempt, not the live consent.
        const access = yield* reply.access;
        if (access === "unavailable")
          return failure("conflict", "Discord access could not be confirmed. Nothing was started.");
        if (access === "denied")
          return failure("conflict", "Discord no longer permits this confirmation.");
        return { ok: true as const, value: undefined };
      }),
      commit: () =>
        Effect.gen(function* () {
          const allowed = yield* local;
          if (!allowed.ok) return allowed;
          return reply.accessCurrent()
            ? allowed
            : failure("conflict", "Discord access changed before Factory accepted the Start.");
        }),
    };
  };

  /** Performs a consumed proposal under its action identity, outside any transaction. */
  const perform = (row: ProposalRow, actionId: string, reply: ConfirmationReply) =>
    Effect.gen(function* () {
      performing.add(actionId);
      const operation = byName.get(row.operation)!;
      const parameters = JSON.parse(row.parameters_json) as JSONValue;
      if (row.operation === "start" || row.operation === "human-answer") {
        yield* telemetry.record("chat_control.used", {
          platform: "discord",
          command: row.operation === "start" ? "start_run" : "human_reply",
        });
      }
      const executed = yield* Effect.result(
        operation.execute(actionId, parameters, acceptance(row, reply)),
      );
      const outcome: ActionOutcome =
        executed._tag === "Success"
          ? executed.success
          : yield* Effect.orElseSucceed(operation.reconcile(actionId, parameters), () => ({
              kind: "unknown" as const,
            }));
      yield* decide(row, actionId, outcome);
      return outcome;
    }).pipe(
      Effect.uninterruptible,
      Effect.ensuring(Effect.sync(() => performing.delete(actionId))),
    );

  /** Reconciles an attempt whose outcome this process does not know, by its identity alone. */
  const reconcileAction = (row: ProposalRow, action: ActionRow) =>
    Effect.gen(function* () {
      const operation = byName.get(row.operation)!;
      const outcome = yield* Effect.orElseSucceed(
        operation.reconcile(action.id, JSON.parse(row.parameters_json) as JSONValue),
        () => ({ kind: "unknown" as const }),
      );
      yield* decide(row, action.id, outcome);
      return outcome;
    });

  const repeatedReply = (row: ProposalRow, reply: ConfirmationReply) =>
    Effect.gen(function* (): Effect.fn.Return<ConfirmationAnswer, unknown> {
      const action = yield* actionOf(row.id);
      if (!action) return replied(REPLIES.invalid);
      const reconciled =
        action.state === "accepting" && !performing.has(action.id)
          ? yield* reconcileAction(row, action)
          : undefined;
      if ((yield* reply.access) !== "permitted") return replied(REPLIES.denied);
      if (action.state === "accepting")
        return reconciled === undefined
          ? replied(REPLIES.confirming)
          : outcomeAnswer(reconciled.kind);
      const operation = byName.get(row.operation)!;
      return replied(
        `You already confirmed this review. ${operation.summary({
          kind: action.state,
          facts: JSON.parse(action.outcome_json!) as JSONValue,
        })}`,
      );
    });

  /** Takes the consent for one attempt, if it is still live and its scope still holds. */
  const take = (row: ProposalRow) =>
    sql.withTransaction(
      Effect.gen(function* (): Effect.fn.Return<
        { readonly actionId: string } | { readonly refused: keyof typeof REPLIES },
        unknown
      > {
        const current = (yield* proposal(row.id))!;
        if (current.state === "accepting" || current.state === "consumed")
          return { refused: "confirming" };
        if (current.state !== "presented") return { refused: "invalid" };
        if (yield* expired(current)) return { refused: "expired" };
        if (!(yield* scopeGranted(current))) return { refused: "denied" };
        const [operating] = yield* sql<{
          application_id: string | null;
        }>`SELECT application_id FROM chat_control_state WHERE singleton=1`;
        if (operating?.application_id !== current.application_id) return { refused: "invalid" };
        const actionId = yield* newId;
        const startedAt = yield* now;
        yield* sql`UPDATE chat_proposals SET state='accepting' WHERE id=${current.id} AND state='presented'`;
        yield* sql`INSERT INTO chat_actions (id,proposal_id,state,started_at) VALUES (${actionId},${current.id},'accepting',${startedAt})`;
        return { actionId };
      }),
    );

  const confirmationTarget = (
    applicationId: string,
    threadId: string,
    repliedTo: string | undefined,
    text: string,
  ) =>
    Effect.gen(function* () {
      const code = PHRASE_SHAPE.test(text) ? text.slice(text.indexOf(" ") + 1) : undefined;
      if (repliedTo === undefined && code === undefined) return undefined;
      const [row] = yield* sql<{
        id: string;
        requester_id: string;
        operation: ChatOperationName;
        state: ProposalState;
        expires_at: string | null;
        confirmation_code: string | null;
        confirmation_message_id: string | null;
      }>`SELECT id,requester_id,operation,state,expires_at,confirmation_code,confirmation_message_id
        FROM chat_proposals
        WHERE application_id=${applicationId} AND thread_id=${threadId}
          AND (confirmation_message_id=${repliedTo ?? null} OR confirmation_code=${code ?? null})
        ORDER BY confirmation_message_id=${repliedTo ?? null} DESC,created_at DESC LIMIT 1`;
      if (!row && code === undefined) return undefined;
      const botCanConfirm =
        row?.operation === "start" &&
        row.state === "presented" &&
        row.confirmation_message_id === repliedTo &&
        row.confirmation_code !== null &&
        text === phraseOf(row.confirmation_code) &&
        row.expires_at! > (yield* now);
      return { proposalId: row?.id, requesterId: row?.requester_id, botCanConfirm };
    });

  const confirm = (reply: ConfirmationReply) =>
    Effect.gen(function* (): Effect.fn.Return<ConfirmationAnswer, unknown> {
      const row = reply.proposalId === undefined ? undefined : yield* proposal(reply.proposalId);
      const refused = replyRefusal(row, reply);
      if (refused === "repeated") return yield* repeatedReply(row!, reply);
      if (refused) return replied(REPLIES[refused]);
      if (yield* expired(row!)) return replied(REPLIES.expired);
      const access = yield* reply.access;
      if (access !== "permitted") return replied(REPLIES[access]);
      // Chat control turned Off meanwhile: nothing is consumed and the consent stays live.
      if (!reply.operating()) return replied(REPLIES.notNow);
      const taken = yield* take(row!);
      if (!("refused" in taken))
        return outcomeAnswer((yield* perform(row!, taken.actionId, reply)).kind);
      return taken.refused === "confirming"
        ? yield* repeatedReply(row!, reply)
        : replied(REPLIES[taken.refused]);
    });

  const recover = Effect.gen(function* () {
    yield* sql`UPDATE chat_proposals SET state='ended',ended_reason='failed' WHERE state='preparing'`;
    const open = yield* sql<ActionRow>`SELECT * FROM chat_actions WHERE state='accepting'`;
    for (const action of open) {
      const row = (yield* proposal(action.proposal_id))!;
      yield* reconcileAction(row, action);
    }
  });

  /** The current state of proposals later turns refer to. */
  const statuses = (ids: readonly string[]) =>
    Effect.gen(function* () {
      if (ids.length === 0) return new Map<string, ProposalStatus>();
      const at = yield* Clock.currentTimeMillis;
      const rows =
        yield* sql<StatusRow>`SELECT p.*,a.state AS action_state,a.outcome_json FROM chat_proposals p
          LEFT JOIN chat_actions a ON a.proposal_id=p.id WHERE p.id IN ${sql.in(ids)}`;
      return new Map(rows.map((row) => [row.id, statusOf(row, at)]));
    });

  /** Attempts whose outcome is still being reconciled, for Settings. */
  const reconciling = Effect.map(
    sql<ActionRow & { operation: ChatOperationName }>`SELECT a.*,p.operation FROM chat_actions a
        JOIN chat_proposals p ON p.id=a.proposal_id WHERE a.state='accepting' ORDER BY a.started_at`,
    (rows): ChatActionReconciliation[] =>
      rows
        .filter((row) => !performing.has(row.id))
        .map((row) => ({ id: row.id, operation: row.operation, startedAt: row.started_at })),
  );

  return {
    open,
    present,
    fail,
    confirmationTarget,
    confirm,
    recover,
    statuses,
    reconciling,
    serveResolutions: resolutions.serve,
    /** Something outside this module may have made reviews unusable, e.g. an Access save. */
    resolutionsChanged: resolutions.changed,
    /** Proposals that something outside this module ended, after it committed. */
    proposalsEnded: answerRunsChanged,
  };
}

export type ChatActions = ReturnType<typeof makeChatActions>;
