import {
  messageEvent,
  startControlledDiscord,
  type CreatedMessage,
  type MessageFault,
} from "../../../apps/backend/test/support/controlled-discord.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

const phraseOf = (message: CreatedMessage) => /`(confirm [A-Z0-9]{4})`/.exec(message.content)?.[1];

/** Chat control reaches this controlled Discord instead of discord.com; it knows one bot. */
export async function startJourneyDiscord() {
  const discord = await startControlledDiscord();
  const bot = { token: "ui-journey-bot-token", applicationId: "112233445566778899" };
  discord.addBot(bot);
  // The bot's server, with the channels UI journeys allow in Access.
  const guild = {
    id: "400000000000000001",
    name: "Team",
    channels: [
      { id: "400000000000000002", name: "factory" },
      { id: "400000000000000003", name: "deploys" },
    ],
  };
  discord.addGuild(guild);
  return { discord, bot, guild, apiUrl: discord.apiUrl };
}

/** Participants, moderators and Discord's own behavior around the bot. */
export function discordFixture(
  { discord, bot, guild }: Awaited<ReturnType<typeof startJourneyDiscord>>,
  { factory }: Host,
) {
  /** Chat control Off with nothing saved: no Language model, Discord connection or Access. */
  async function restoreChatControl() {
    const model = requireSuccess(await factory.getChatModelSettings());
    if (model.chatControlEnabled)
      requireSuccess(await factory.setChatControlEnabled({ enabled: false }));
    const saved = model.configuration;
    if (
      saved.providerKind !== null ||
      saved.baseUrl !== null ||
      saved.model !== null ||
      saved.keyConfigured
    )
      requireSuccess(
        await factory.updateChatModelSettings({
          revision: saved.revision,
          providerKind: null,
          baseUrl: null,
          model: null,
          key: saved.keyConfigured ? { kind: "remove" } : { kind: "keep" },
        }),
      );
    const { configuration: connection, access } = requireSuccess(
      await factory.getDiscordSettings(),
    );
    if (connection.publicKey !== null || connection.tokenConfigured)
      requireSuccess(
        await factory.updateDiscordConnection({
          revision: connection.revision,
          publicKey: null,
          token: connection.tokenConfigured ? { kind: "remove" } : { kind: "keep" },
        }),
      );
    if (access.users.length > 0 || access.bots.length > 0 || access.channels.length > 0)
      requireSuccess(
        await factory.updateDiscordAccess({
          revision: access.revision,
          users: [],
          bots: [],
          channels: [],
        }),
      );
  }

  let invocations = 0;
  /** Gateway sessions opened before the current journey began. */
  let earlierSessions = 0;
  return {
    actions: {
      /** The bot the controlled Discord knows, and the Gateway sessions it saw in this journey. */
      state: () => ({
        bot,
        sessions: discord.sessions
          .slice(earlierSessions)
          .map(({ token, ready, closed }) => ({ token, ready, closed })),
      }),
      /** External application permissions determine whether command registration succeeds. */
      commands({ available }: { available: boolean }) {
        discord.setCommandsAvailable(available);
      },
      /**
       * An allowed participant mentions the bot in the allowed channel: one new invocation, with
       * the given `content` or the default request. Factory answers in a new thread with the
       * message's ID.
       */
      invoke({ content }: { content?: string } = {}) {
        invocations += 1;
        const id = String(300000000000000000n + BigInt(invocations));
        discord.deliver(
          messageEvent({
            bot,
            guildId: guild.id,
            channelId: guild.channels[0]!.id,
            id,
            ...(content ? { content } : {}),
          }),
        );
        return { id };
      },
      messages: () =>
        discord.created.map((message) => ({
          id: message.id,
          channelId: message.channelId,
          content: message.content,
          phrase: phraseOf(message) ?? null,
        })),
      /** The channel's permissions stop, or again let, the bot post there. */
      posting({ channelId, denied }: { channelId: string; denied: boolean }) {
        discord.setPostingDenied(channelId, denied);
      },
      /** Discord's user data flags `userId` as a bot account named `username`. */
      botAccount({ userId, username }: { userId: string; username: string }) {
        discord.registerBotAccount(userId, username);
      },
      /** `userId` replies "here" to the latest access test message in `channelId`. */
      replyToAccessTest({ userId, channelId }: { userId: string; channelId: string }) {
        invocations += 1;
        const test = discord.created.findLast(
          (message) =>
            message.channelId === channelId && message.content.endsWith("you can use Factory."),
        )!;
        discord.deliver(
          messageEvent({
            bot,
            guildId: guild.id,
            channelId,
            id: String(320000000000000000n + BigInt(invocations)),
            authorId: userId,
            content: "here",
            mention: false,
            replyTo: {
              id: test.id,
              channelId,
              authorId: bot.applicationId,
              authorIsBot: true,
              content: test.content,
            },
          }),
        );
      },
      /** Discord meets the next message creates with these faults, in order. */
      fault({ faults }: { faults: MessageFault[] }) {
        discord.faultMessages(...faults);
      },
      /** Discord's nonce uniqueness window passed: a repeated nonce creates a new message again. */
      nonceWindow() {
        discord.nonceWindowPassed();
      },
      /**
       * A moderator changes `thread`: `locked` archives and locks it, `unlocked` unlocks it,
       * leaving it archived.
       */
      thread({ thread, state }: { thread: string; state: "locked" | "unlocked" }) {
        if (state === "locked") discord.archiveThread(thread, { locked: true });
        else discord.unlockThread(thread);
      },
      confirm({ thread, messageId }: { thread: string; messageId: string }) {
        invocations += 1;
        const review = discord.created.find((message) => message.id === messageId)!;
        discord.deliver(
          messageEvent({
            bot,
            guildId: guild.id,
            channelId: thread,
            id: String(310000000000000000n + BigInt(invocations)),
            content: phraseOf(review)!,
            mention: false,
            replyTo: {
              id: review.id,
              channelId: thread,
              authorId: bot.applicationId,
              authorIsBot: true,
              content: review.content,
            },
          }),
        );
      },
    },
    async reset() {
      discord.setCommandsAvailable(true);
      discord.clearFaults();
      for (const channel of guild.channels) discord.setPostingDenied(channel.id, false);
      await restoreChatControl();
      earlierSessions = discord.sessions.length;
    },
  };
}
