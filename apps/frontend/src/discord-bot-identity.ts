import type { DiscordSettings } from "@t3-factory/contracts";

type BotSettings = Pick<
  DiscordSettings,
  "chatControlEnabled" | "configuration" | "latestCheck" | "botName" | "connectionStatus"
>;

/** The latest check of the saved revision, the only one that describes the saved connection. */
export const currentCheck = ({ latestCheck, configuration }: BotSettings) =>
  latestCheck?.revision === configuration.revision ? latestCheck : null;

/**
 * The bot the Bot row names and whether it is verified, both from one source: while On, the
 * operating connection; while Off, the check of the saved credentials once there is one, because
 * saved credentials may belong to another bot than the one Factory last operated as.
 */
export function checkedBot(settings: BotSettings): {
  readonly name: string | null;
  readonly verified: boolean;
} {
  const check = currentCheck(settings);
  if (!settings.chatControlEnabled && check)
    return { name: check.botName, verified: check.outcome === "verified" };
  return {
    name: settings.botName ?? check?.botName ?? null,
    verified: settings.connectionStatus === "connected" || check?.outcome === "verified",
  };
}
