import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  DiscordAPIError,
  InteractionContextType,
  MessageFlags,
  MessageType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type Message,
  type ThreadChannel,
} from "discord.js";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import type * as SqlClient from "effect/sql/SqlClient";
import { isSqlError } from "effect/sql/SqlError";
import type { DiscordCommandSetup } from "@t3-factory/contracts";
import { now } from "../time.ts";
import { grantedProjects } from "./access.ts";
import type { RequesterKind } from "./requesters.ts";
import { isAccessTestMessage, recordReached } from "./access-test.ts";
import type { ChatActions } from "./actions.ts";
import { BOT_LOOP_REFUSAL, BOT_RATE_REFUSAL, type BotGuards } from "./bot-guards.ts";
import type { ConversationGenerations, ConversationKey } from "./conversations.ts";
import {
  BUSY_REPLY,
  type AdmittedInvocation,
  type Interpreter,
  type ReplyTarget,
  type Reservation,
} from "./interpretation.ts";
import type { EvidenceToken, RequesterEvidence } from "./requester-evidence.ts";

/** The message an event replied to, exactly as that event's payload carried it. */
export interface ReferencedMessage {
  /** Discord's reference type: 0 is a reply, 1 a forward. */
  readonly referenceType: number;
  /** Null when Discord could not supply the message, for example because it was deleted. */
  readonly message: {
    readonly id: string;
    readonly channel_id: string;
    readonly type: number;
    readonly content: string;
    readonly author: { readonly id: string; readonly bot?: boolean; readonly system?: boolean };
    readonly webhook_id?: string;
  } | null;
}

/** What admission needs from the operating session. */
interface IngressSession {
  readonly sql: SqlClient.SqlClient;
  readonly client: Client<true>;
  readonly applicationId: string;
  readonly evidence: RequesterEvidence;
  readonly generations: ConversationGenerations;
  /** Whether this session still admits work: Chat control is On and the session not released. */
  readonly operating: () => boolean;
  /** Creates the public thread for a parent-channel invocation; returns its ID. */
  readonly startThread: (channelId: string, messageId: string) => Promise<string>;
  /** Hands a message to Chat SDK and waits for its admission callback, if invoked, to finish. */
  readonly handOff: (threadId: string, message: Message) => Promise<void>;
  readonly encodeThreadId: (key: ConversationKey) => string;
  /** Publishes one Factory message in the conversation's thread, mentioning nobody. */
  readonly post: (key: ConversationKey, text: string) => Promise<unknown>;
  /** The reply target the current MESSAGE_CREATE payload carried, taken once. */
  readonly referenced: (messageId: string) => ReferencedMessage | undefined;
  readonly confirmations: Pick<ChatActions, "confirmationTarget" | "confirm">;
  readonly botGuards: BotGuards;
  readonly publishedDelivery: (
    threadId: string,
    messageId: string,
  ) => Effect.Effect<{ readonly runId: string | null } | undefined, unknown>;
}

const RESET_REPLIES = {
  cleared:
    "Factory cleared this thread's Chat control conversation. Later requests here start fresh; Discord messages and work Factory already accepted are unchanged.",
  "not-thread": "Use /factory reset inside a Chat control thread.",
  denied: "Chat control does not accept this command from you here.",
  unavailable:
    "Factory could not confirm your access to this thread, so nothing was cleared. Try again.",
} as const;

/**
 * The only command Factory registers. Discord creates or updates it by name and leaves the
 * application's other commands untouched, since the application may also serve other software.
 */
const FACTORY_COMMAND = {
  name: "factory",
  description: "Factory Chat control",
  type: ApplicationCommandType.ChatInput,
  contexts: [InteractionContextType.Guild],
  integration_types: [ApplicationIntegrationType.GuildInstall],
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "reset",
      description: "Clear this thread's shared Chat control conversation",
    },
  ],
};

/** Registers `/factory reset` for the verified application through Discord's REST API. */
export const registerCommands = (client: Client<true>, applicationId: string) =>
  Effect.gen(function* () {
    const registered = yield* Effect.result(
      Effect.tryPromise(() =>
        client.rest.post(Routes.applicationCommands(applicationId), { body: FACTORY_COMMAND }),
      ),
    );
    const occurredAt = yield* now;
    if (registered._tag === "Success")
      return {
        outcome: "registered",
        message: "Discord accepted /factory reset for this application.",
        occurredAt,
      } satisfies DiscordCommandSetup;
    const error = registered.failure.cause;
    return {
      outcome: "failed",
      message:
        error instanceof DiscordAPIError
          ? `Discord answered HTTP ${error.status} when Factory registered /factory reset.`
          : "Factory could not reach Discord to register /factory reset.",
      occurredAt,
    } satisfies DiscordCommandSetup;
  });

type Access = "permitted" | "denied" | "unavailable";

function messageRequester(message: Message<true>, botUserId: string): RequesterKind | undefined {
  if (message.webhookId !== null || message.system || message.author.id === botUserId)
    return undefined;
  if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return undefined;
  return message.author.bot ? "bot" : "human";
}

function explicitInvocation(message: Message<true>, botUserId: string, kind: RequesterKind) {
  const invoked =
    message.mentions.users.has(botUserId) ||
    message.mentions.repliedUser?.id === botUserId ||
    (kind === "bot" && message.type === MessageType.Reply);
  if (!invoked) return undefined;
  const named = new RegExp(`<@!?${botUserId}>`).test(message.content);
  const channel = message.channel;
  if (channel.isThread())
    return channel.parentId ? { thread: channel, parentId: channel.parentId, named } : undefined;
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement
    ? { thread: null, parentId: channel.id, named }
    : undefined;
}

/** Discord affirmatively answered that the user is not a member; anything else is unresolved. */
const unknownMember = (error: unknown) =>
  error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember;

// Discord redelivers events only within a resumed session, far sooner than this; it matches the
// longest a conversation generation lasts.
const MARKER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Factory's policy gate for one operating session. Every Discord message and interaction passes
 * here before anything else happens: a thread is created, a conversation opened, Chat SDK
 * involved or anything published only for an explicit invocation by an allowed human user in an
 * allowed parent channel (or its thread) that grants at least one Factory Project, with current
 * evidence of the requester's access.
 */
export function makeIngress(session: IngressSession, interpreter: Interpreter) {
  const { sql, client, applicationId, evidence, generations } = session;
  const botUserId = client.user.id;
  /** Admitted messages on their way through Chat SDK to Factory's handler. */
  const pending = new Map<
    string,
    { readonly invocation: AdmittedInvocation; readonly reservation: Reservation | "busy" }
  >();

  /** Records a Discord event once; false when Factory already took this delivery. */
  const firstDelivery = (eventId: string) =>
    Effect.gen(function* () {
      const receivedAt = yield* now;
      const expired = new Date(Date.parse(receivedAt) - MARKER_RETENTION_MS).toISOString();
      yield* sql`DELETE FROM chat_ingress_events WHERE received_at<${expired}`;
      const rows = yield* sql`INSERT INTO chat_ingress_events (application_id,event_id,received_at)
        VALUES (${applicationId},${eventId},${receivedAt}) ON CONFLICT DO NOTHING RETURNING event_id`;
      return rows.length > 0;
    });

  const permittedProjects = (userId: string, kind: RequesterKind, parentChannelId: string) =>
    Effect.map(
      grantedProjects(sql, userId, parentChannelId, kind),
      (projects) => projects.length > 0,
    );

  /** Whether a private thread's member list includes the user, asked of Discord directly. */
  const privateThreadMember = (thread: ThreadChannel, userId: string) =>
    Effect.gen(function* (): Effect.fn.Return<Access, unknown> {
      const member = yield* Effect.result(
        Effect.tryPromise(() =>
          thread.members.fetch({ member: userId, force: true, cache: false }),
        ),
      );
      if (member._tag === "Success") return "permitted";
      return unknownMember(member.failure.cause) ? "denied" : "unavailable";
    });

  /**
   * A targeted refresh of the requester's access to the conversation's thread, for work whose
   * evidence a connection gap or change made stale: the member's current permissions on the
   * thread and, for a private thread, its membership.
   */
  const refreshedAccess = (conversation: ConversationKey, userId: string) =>
    Effect.gen(function* (): Effect.fn.Return<Access, unknown> {
      const guild = client.guilds.cache.get(conversation.guildId);
      const channel = yield* Effect.result(
        Effect.tryPromise(() => client.channels.fetch(conversation.threadId, { force: true })),
      );
      if (!guild || channel._tag === "Failure" || !channel.success?.isThread())
        return "unavailable";
      const thread = channel.success;
      const parent = yield* Effect.result(
        Effect.tryPromise(() =>
          client.channels.fetch(conversation.parentChannelId, { force: true }),
        ),
      );
      if (
        parent._tag === "Failure" ||
        !parent.success ||
        (parent.success.type !== ChannelType.GuildText &&
          parent.success.type !== ChannelType.GuildAnnouncement &&
          parent.success.type !== ChannelType.GuildForum)
      )
        return "unavailable";
      const member = yield* Effect.result(
        Effect.tryPromise(() => guild.members.fetch({ user: userId, force: true, cache: false })),
      );
      if (member._tag === "Failure")
        return unknownMember(member.failure.cause) ? "denied" : "unavailable";
      if (!thread.permissionsFor(member.success)?.has(PermissionFlagsBits.ViewChannel))
        return "denied";
      return thread.type === ChannelType.PrivateThread
        ? yield* privateThreadMember(thread, userId)
        : "permitted";
    });

  /**
   * Whether admitted work may still dispatch or publish: On, current policy and generation, and
   * current evidence of the requester's access. Private-thread membership is refreshed on every
   * check: without Server Members intent, other-user removal events are not reliable evidence.
   */
  const permitted = (
    conversation: ConversationKey,
    requesterId: string,
    requesterKind: RequesterKind,
    generation: number,
    initial: EvidenceToken,
    privateThread: boolean,
  ) => {
    let token = initial;
    return Effect.gen(function* () {
      if (!session.operating()) return false;
      if (!(yield* permittedProjects(requesterId, requesterKind, conversation.parentChannelId)))
        return false;
      if (!(yield* generations.isCurrent(conversation, generation))) return false;
      if (evidence.isCurrent(token) && !privateThread) return true;
      const refreshed = evidence.token(conversation.guildId);
      if ((yield* refreshedAccess(conversation, requesterId)) !== "permitted") return false;
      if (!evidence.isCurrent(refreshed)) return false;
      token = refreshed;
      return (
        session.operating() &&
        (yield* permittedProjects(requesterId, requesterKind, conversation.parentChannelId)) &&
        (yield* generations.isCurrent(conversation, generation))
      );
    });
  };

  /**
   * The human message the invoker selected by replying to it, as the event supplied it, or the
   * Run a replied-to Factory message identifies.
   */
  const replyTarget = (message: Message<true>, threadId: string) =>
    Effect.gen(function* (): Effect.fn.Return<ReplyTarget, unknown> {
      const reference = session.referenced(message.id);
      if (message.type !== MessageType.Reply || !reference || reference.referenceType !== 0)
        return { kind: "none" };
      const target = reference.message;
      if (!target) return { kind: "unusable" };
      // Replying to the bot is how it was invoked; bot prose is never imported as a quote. A
      // Factory message of this thread may identify a Run, which is then read afresh.
      if (target.author.id === botUserId) {
        const ordinary =
          target.channel_id === threadId &&
          target.webhook_id === undefined &&
          (target.type === MessageType.Default || target.type === MessageType.Reply);
        const delivery = ordinary
          ? yield* session.publishedDelivery(threadId, target.id)
          : undefined;
        return delivery?.runId ? { kind: "run", runId: delivery.runId } : { kind: "none" };
      }
      return selectedReply(target, threadId);
    });

  const selectedReply = (
    target: NonNullable<ReferencedMessage["message"]>,
    threadId: string,
  ): ReplyTarget => {
    if (
      target.channel_id !== threadId ||
      target.author.bot === true ||
      target.author.system === true ||
      target.webhook_id !== undefined ||
      (target.type !== MessageType.Default && target.type !== MessageType.Reply)
    )
      return { kind: "unusable" };
    return { kind: "selected", reply: { authorId: target.author.id, text: target.content } };
  };

  /**
   * An answer to the access test: in a parent channel, a reply to one of the test's messages
   * there; in a thread, any invocation in a test's forum post. An allowed user's answer is
   * admitted as any invocation is, but opens no conversation: Factory records the user as
   * reached. Undefined when the message answers no test.
   */
  const answerAccessTest = (
    message: Message<true>,
    thread: ThreadChannel | null,
    parentId: string,
  ) =>
    Effect.gen(function* () {
      const repliedTo =
        message.type === MessageType.Reply ? message.reference?.messageId : undefined;
      const testMessage = thread === null ? repliedTo : thread.id;
      if (testMessage === undefined) return undefined;
      if (!(yield* isAccessTestMessage(sql, parentId, testMessage))) return undefined;
      session.referenced(message.id);
      if (!(yield* permittedProjects(message.author.id, "human", parentId))) return "ignored";
      if (!(yield* firstDelivery(message.id))) return "ignored";
      yield* recordReached(sql, message.author.id);
      return "reached";
    });

  /**
   * Authorizes and records an invocation, creating its thread, and queues it in its conversation;
   * the conversation, or nothing when it was not admitted.
   */
  const admitMessage = (
    message: Message<true>,
    thread: ThreadChannel | null,
    parentId: string,
    requesterKind: RequesterKind,
  ) =>
    Effect.gen(function* () {
      if (!(yield* firstDelivery(message.id))) return undefined;
      const refusal =
        requesterKind === "bot"
          ? botRefusal(message.author.id, thread, yield* Clock.currentTimeMillis)
          : undefined;
      if (refusal === "drop") return undefined;
      const token = evidence.token(message.guildId);
      const threadId =
        thread?.id ??
        (yield* Effect.option(
          Effect.tryPromise(() => session.startThread(message.channelId, message.id)),
        ).pipe(Effect.map((created) => (created._tag === "Some" ? created.value : undefined))));
      if (threadId === undefined) return undefined;
      const conversation = {
        applicationId,
        guildId: message.guildId,
        parentChannelId: parentId,
        threadId,
      };
      const generation = yield* generations.open(conversation);
      const stillPermitted = permitted(
        conversation,
        message.author.id,
        requesterKind,
        generation,
        token,
        thread?.type === ChannelType.PrivateThread,
      );
      if (refusal)
        return { kind: "refusal" as const, conversation, permitted: stillPermitted, text: refusal };
      const invocation: AdmittedInvocation = {
        conversation,
        generation,
        requesterId: message.author.id,
        requesterKind,
        messageId: message.id,
        text: message.content,
        replyTarget: yield* replyTarget(message, threadId),
        admittedAt: yield* Clock.currentTimeMillis,
        permitted: stillPermitted,
      };
      const reservation = yield* Effect.acquireRelease(
        Effect.map(interpreter.reserve(invocation), (reservation) => {
          pending.set(message.id, { invocation, reservation });
          return reservation;
        }),
        (reservation) =>
          Effect.suspend(() =>
            // Only an invocation still waiting for Chat SDK to hand it back owns this slot.
            pending.delete(message.id) && reservation !== "busy"
              ? Effect.catch(reservation.cancel, (error) =>
                  Effect.logWarning(
                    "Chat control could not clear an unclaimed message reservation.",
                    { reason: isSqlError(error) ? error.reason._tag : "Unknown" },
                  ),
                )
              : Effect.void,
          ),
      );
      if (requesterKind === "bot" && reservation !== "busy")
        session.botGuards.takeTurn(threadId, invocation.admittedAt);
      return { kind: "invocation" as const, conversation };
    });

  const botRefusal = (requesterId: string, thread: ThreadChannel | null, at: number) => {
    const rate = session.botGuards.rate(requesterId, at);
    if (rate !== "allow") return rate === "drop" ? rate : BOT_RATE_REFUSAL;
    if (!thread) return undefined;
    const loop = session.botGuards.checkThread(thread.id, at);
    if (loop !== "allow") return loop === "drop" ? loop : BOT_LOOP_REFUSAL;
    return undefined;
  };

  const requesterAccess = (
    user: {
      readonly id: string;
      readonly kind: RequesterKind;
      readonly guildId: string;
      readonly visible: boolean;
    },
    thread: ThreadChannel,
  ) => {
    let qualified: EvidenceToken | undefined;
    const check = Effect.gen(function* (): Effect.fn.Return<Access, unknown> {
      qualified = undefined;
      const userId = user.id;
      if (!thread.parentId || !(yield* permittedProjects(userId, user.kind, thread.parentId)))
        return "denied";
      if (!user.visible) return "denied";
      const token = evidence.token(user.guildId);
      const access = yield* refreshedAccess(
        {
          applicationId,
          guildId: user.guildId,
          parentChannelId: thread.parentId,
          threadId: thread.id,
        },
        userId,
      );
      if (access !== "permitted") return access;
      if (!(yield* permittedProjects(userId, user.kind, thread.parentId))) return "denied";
      if (!evidence.isCurrent(token) || !session.operating()) return "unavailable";
      qualified = token;
      return "permitted";
    });
    return { check, current: () => qualified !== undefined && evidence.isCurrent(qualified) };
  };

  /**
   * Acknowledges an interaction privately at once, since the acknowledgement is due within three
   * seconds and access checks may need Discord itself; its channel and thread, or nothing when
   * Discord refused the acknowledgement.
   */
  const acknowledged = (interaction: ChatInputCommandInteraction<"cached" | "raw">) =>
    Effect.map(
      Effect.option(
        Effect.tryPromise(() => interaction.deferReply({ flags: MessageFlags.Ephemeral })),
      ),
      (deferred) => {
        if (deferred._tag === "None") return undefined;
        const channel = interaction.channel;
        return { channel, thread: channel?.isThread() ? channel : null };
      },
    );

  const reset = (interaction: ChatInputCommandInteraction<"cached" | "raw">) =>
    Effect.gen(function* () {
      if (!(yield* firstDelivery(interaction.id))) return;
      const place = yield* acknowledged(interaction);
      if (!place) return;
      const { channel, thread } = place;
      let reply: keyof typeof RESET_REPLIES = channel ? "not-thread" : "unavailable";
      if (thread) {
        const access = yield* requesterAccess(
          {
            id: interaction.user.id,
            kind: interaction.user.bot ? "bot" : "human",
            guildId: interaction.guildId,
            visible: interaction.memberPermissions?.has(PermissionFlagsBits.ViewChannel) === true,
          },
          thread,
        ).check;
        reply = access === "permitted" ? "cleared" : access;
        if (access === "permitted" && session.operating())
          yield* generations.clear({
            applicationId,
            guildId: interaction.guildId,
            parentChannelId: thread.parentId!,
            threadId: thread.id,
          });
      }
      yield* Effect.ignore(Effect.tryPromise(() => interaction.editReply(RESET_REPLIES[reply])));
    });

  const ownMention = new RegExp(`<@!?${botUserId}>`, "g");

  const replyMessageId = (message: Message<true>, threadId: string) => {
    const reference = message.type === MessageType.Reply ? message.reference : null;
    return reference && (reference.type ?? 0) === 0 && reference.channelId === threadId
      ? reference.messageId
      : undefined;
  };

  const confirmationAttempt = (
    message: Message<true>,
    thread: ThreadChannel,
    requesterKind: RequesterKind,
  ) =>
    Effect.gen(function* () {
      const text = message.content.replace(ownMention, "").trim();
      const repliedTo = replyMessageId(message, thread.id);
      const target = yield* session.confirmations.confirmationTarget(
        applicationId,
        thread.id,
        repliedTo,
        text,
      );
      if (!target) return undefined;
      session.referenced(message.id);
      if (
        requesterKind === "bot" &&
        (!target.botCanConfirm ||
          target.requesterId !== message.author.id ||
          text !== message.content)
      )
        return "ignored" as const;
      if (!(yield* firstDelivery(message.id))) return "ignored" as const;
      return { proposalId: target.proposalId, text, repliedTo, requesterKind };
    });

  const confirmation = (
    message: Message<true>,
    thread: ThreadChannel,
    parentId: string,
    attempt: Exclude<Effect.Success<ReturnType<typeof confirmationAttempt>>, "ignored" | undefined>,
  ) =>
    Effect.gen(function* () {
      const { requesterKind, ...reply } = attempt;
      const requester = requesterAccess(
        { id: message.author.id, kind: requesterKind, guildId: message.guildId, visible: true },
        thread,
      );
      const answer = yield* session.confirmations.confirm({
        ...reply,
        authorId: message.author.id,
        threadId: thread.id,
        applicationId,
        operating: session.operating,
        access: requester.check,
        accessCurrent: requester.current,
      });
      if (answer.kind === "reply" && session.operating())
        yield* Effect.ignore(
          Effect.tryPromise(() =>
            session.post(
              {
                applicationId,
                guildId: message.guildId,
                parentChannelId: parentId,
                threadId: thread.id,
              },
              answer.text,
            ),
          ),
        );
    });

  // Events pass the gate one at a time in delivery order, so a repeated delivery meets the
  // marker its first delivery left and later events see every earlier decision.
  // Queue places are taken here too, so each conversation's queue follows admission order.
  const gate = Semaphore.makeUnsafe(1);

  const botRepliesToDelivery = (message: Message<true>, thread: ThreadChannel) => {
    const repliedTo = replyMessageId(message, thread.id);
    return repliedTo === undefined
      ? Effect.succeed(false)
      : Effect.map(session.publishedDelivery(thread.id, repliedTo), Boolean);
  };

  const receiveThreadMessage = (
    message: Message<true>,
    thread: ThreadChannel,
    parentId: string,
    kind: RequesterKind,
  ) =>
    Effect.gen(function* () {
      if (kind === "bot" && (yield* botRepliesToDelivery(message, thread)))
        return "ignored" as const;
      const attempt = yield* confirmationAttempt(message, thread, kind);
      if (attempt === "ignored" || attempt === undefined) return attempt;
      return { kind: "confirmation" as const, thread, parentId, attempt };
    });

  const receive = (message: Message<true>) =>
    Effect.gen(function* () {
      const kind = messageRequester(message, botUserId);
      if (!kind) return;
      if (kind === "human" && message.channel.isThread())
        session.botGuards.resetThread(message.channel.id);
      const place = explicitInvocation(message, botUserId, kind);
      if (!place) return;
      const { thread, parentId, named } = place;
      if (kind === "human") {
        const answered = yield* answerAccessTest(message, thread, parentId);
        if (answered) return answered === "reached" ? { kind: "react" as const } : undefined;
      }
      if (!(yield* permittedProjects(message.author.id, kind, parentId))) return;
      const received = thread && (yield* receiveThreadMessage(message, thread, parentId, kind));
      if (received) return received;
      if (kind === "bot" && !named) return;
      return yield* admitMessage(message, thread, parentId, kind);
    });

  return {
    message: (message: Message) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!session.operating() || !message.inGuild()) return;
          const received = yield* gate.withPermits(1)(receive(message));
          if (!received || received === "ignored") return;
          if (received.kind === "react") {
            // The reaction is an external send, which never happens while Chat control is Off.
            if (session.operating())
              yield* Effect.ignore(Effect.tryPromise(() => message.react("✅")));
            return;
          }
          if (received.kind === "confirmation")
            return yield* confirmation(
              message,
              received.thread,
              received.parentId,
              received.attempt,
            );
          if (received.kind === "refusal") {
            if (yield* received.permitted)
              yield* Effect.ignore(
                Effect.tryPromise(() => session.post(received.conversation, received.text)),
              );
            return;
          }
          yield* Effect.promise(() =>
            session.handOff(session.encodeThreadId(received.conversation), message),
          );
        }),
      ),
    interaction: (interaction: Interaction) =>
      Effect.gen(function* () {
        if (!session.operating() || !interaction.inGuild()) return;
        if (interaction.applicationId !== applicationId) return;
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "factory") return;
        if (interaction.options.getSubcommand(false) !== "reset") return;
        yield* gate.withPermits(1)(reset(interaction));
      }),
    /** Chat SDK's mention handler for an admitted message. */
    admitted: (messageId: string) =>
      Effect.gen(function* () {
        const handled = pending.get(messageId);
        if (!handled) return;
        pending.delete(messageId);
        const { invocation, reservation } = handled;
        if (reservation !== "busy") return yield* reservation.attach;
        // Overflow feedback is deterministic and the message is not queued or retained.
        if (yield* invocation.permitted)
          yield* Effect.ignore(
            Effect.tryPromise(() => session.post(invocation.conversation, BUSY_REPLY)),
          );
      }),
  };
}
