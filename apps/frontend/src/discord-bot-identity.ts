import type { DiscordSettings } from "@t3-factory/contracts";

type BotSettings = Pick<
  DiscordSettings,
  | "chatControlEnabled"
  | "configuration"
  | "latestCheck"
  | "application"
  | "botName"
  | "connectionStatus"
>;

/** The latest check of the saved revision, the only one that describes the saved connection. */
export const currentCheck = ({ latestCheck, configuration }: BotSettings) =>
  latestCheck?.revision === configuration.revision ? latestCheck : null;

/**
 * The bot the Bot row names and whether it is verified, both from one source. The check of the
 * saved credentials describes them while Off, and while On until the Gateway adopts the bot it
 * verified: saved credentials may belong to another bot than the one Factory last operated as,
 * which stays recorded through startup and failed logins. Otherwise the operating connection does.
 */
export function checkedBot(settings: BotSettings): {
  readonly name: string | null;
  readonly verified: boolean;
} {
  const check = currentCheck(settings);
  const verified = check?.outcome === "verified";
  if (
    check &&
    (!settings.chatControlEnabled || (verified && check.applicationId !== settings.application))
  )
    return { name: check.botName, verified };
  return {
    name: settings.botName ?? check?.botName ?? null,
    verified: settings.connectionStatus === "connected" || verified,
  };
}
