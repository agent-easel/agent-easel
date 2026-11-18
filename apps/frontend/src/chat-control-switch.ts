import type { DiscordSettings } from "@t3-factory/contracts";

/**
 * Why the Chat control switch cannot turn On, mirroring the host's rule: the saved Public key and
 * bot token and the Language model's saved provider, base URL and model are required, and the
 * latest check of the saved connection revision must not have reported a rejected token or a
 * refused Message Content intent. Turning Off is never blocked.
 */
export type ChatControlBlocker =
  | {
      readonly kind: "save";
      /** The missing part of the bot, or null when the bot is saved. */
      readonly bot: "the bot" | "the Public key" | "the bot token" | null;
      readonly model: boolean;
    }
  | { readonly kind: "rejected" }
  | { readonly kind: "intent" };

export function chatControlBlocker(
  settings: Pick<DiscordSettings, "chatControlEnabled" | "configuration" | "latestCheck">,
  /** Whether the Language model's provider, base URL and model are saved. */
  modelComplete: boolean,
): ChatControlBlocker | null {
  if (settings.chatControlEnabled) return null;
  const { publicKey, tokenConfigured, revision } = settings.configuration;
  const bot =
    publicKey === null && !tokenConfigured
      ? "the bot"
      : publicKey === null
        ? "the Public key"
        : !tokenConfigured
          ? "the bot token"
          : null;
  if (bot !== null || !modelComplete) return { kind: "save", bot, model: !modelComplete };
  const check = settings.latestCheck;
  if (check?.revision !== revision) return null;
  if (check.outcome === "token-rejected") return { kind: "rejected" };
  if (check.outcome === "intent-disallowed") return { kind: "intent" };
  return null;
}
