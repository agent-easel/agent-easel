import {
  buttonEvent,
  messageEvent,
  startControlledDiscord,
  type CreatedMessage,
  type MessageFault,
} from "../../../apps/backend/test/support/controlled-discord.ts";

/** The confirmation button a message Discord created carries, if any. */
const buttonOf = (message: CreatedMessage) =>
  (message.components as { components: { custom_id: string }[] }[])[0]?.components[0];

/** Chat control reaches this controlled Discord instead of discord.com; it knows one bot. */
export async function startJourneyDiscord() {
  const discord = await startControlledDiscord();
  const bot = { token: "ui-journey-bot-token", applicationId: "112233445566778899" };
  discord.addBot(bot);
  // The bot's server, with the channel UI journeys allow in Access.
  const guild = {
    id: "400000000000000001",
    name: "Team",
    channels: [{ id: "400000000000000002", name: "factory" }],
  };
  discord.addGuild(guild);
  return { discord, bot, guild, apiUrl: discord.apiUrl };
}

/** Participants, moderators and Discord's own behavior around the bot. */
export function discordFixture({
  discord,
  bot,
  guild,
}: Awaited<ReturnType<typeof startJourneyDiscord>>) {
  let invocations = 0;
  return {
    actions: {
      /** The bot the controlled Discord knows, and the tokens of the Gateway sessions it saw. */
      state: () => ({
        bot,
        sessions: discord.sessions.map(({ token, ready, closed }) => ({ token, ready, closed })),
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
      /** The messages Discord created so far: text and any confirmation button's custom ID. */
      messages: () =>
        discord.created.map((message) => ({
          channelId: message.channelId,
          content: message.content,
          customId: buttonOf(message)?.custom_id ?? null,
        })),
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
      /** The participant clicks the confirmation button `customId` in `thread`. */
      click({ thread, customId }: { thread: string; customId: string }) {
        invocations += 1;
        discord.deliver(
          buttonEvent({
            bot,
            guildId: guild.id,
            thread: { id: thread, parentId: guild.channels[0]!.id },
            id: String(310000000000000000n + BigInt(invocations)),
            customId,
            message: discord.created.find((message) => buttonOf(message)?.custom_id === customId)!,
          }),
        );
      },
    },
    reset() {
      discord.setCommandsAvailable(true);
      discord.clearFaults();
    },
  };
}
