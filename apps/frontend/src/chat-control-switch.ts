import type { DiscordSettings } from "@agent-easel/contracts";

/**
 * What the page knows of the Language model's provider, base URL and model: saved or not, still
 * being read, or unread because the read failed.
 */
export type ModelState = "complete" | "incomplete" | "reading" | "unread";

/**
 * Why the Chat control switch cannot turn On, mirroring the host's rule: the saved Public key and
 * bot token and the Language model's saved provider, base URL and model are required, and the
 * latest check of the saved connection revision must not have reported a rejected token or a
 * refused Message Content intent. Until the model is read the switch waits for it. Turning Off is
 * never blocked.
 */
export type ChatControlBlocker =
  | {
      readonly kind: "save";
      /** The missing part of the bot, or null when the bot is saved. */
      readonly bot: "the bot" | "the Public key" | "the bot token" | null;
      readonly model: boolean;
    }
  | { readonly kind: "rejected" }
  | { readonly kind: "intent" }
  /** Whether the model is saved is not known yet, or the read failed. */
  | { readonly kind: "model"; readonly state: "reading" | "unread" };

export function chatControlBlocker(
  settings: Pick<DiscordSettings, "chatControlEnabled" | "configuration" | "latestCheck">,
  model: ModelState,
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
  const missingModel = model === "incomplete";
  if (bot !== null || missingModel) return { kind: "save", bot, model: missingModel };
  if (model !== "complete") return { kind: "model", state: model };
  const check = settings.latestCheck;
  if (check?.revision !== revision) return null;
  if (check.outcome === "token-rejected") return { kind: "rejected" };
  if (check.outcome === "intent-disallowed") return { kind: "intent" };
  return null;
}
