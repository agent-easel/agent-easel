import { useEffect, useSyncExternalStore } from "react";
import type { ChatModelSettings, DiscordSettings } from "@agent-easel/contracts";
import { api } from "./api.ts";

/** The navigation indicator's tone: amber while Discord reconnects, red for every other failure. */
type ChatControlAttention = "attention" | "error" | null;

/**
 * One Chat control page's navigation indicator: a current unresolved failure on that page while
 * Chat control is On, as the host last reported it.
 */
function attentionStore<Settings extends { readonly needsAttention: boolean }>(
  read: () => Promise<Settings>,
  tone: (settings: Settings) => Exclude<ChatControlAttention, null>,
) {
  let needsAttention: ChatControlAttention = null;
  const listeners = new Set<() => void>();
  const report = (settings: Settings) => {
    const next = settings.needsAttention ? tone(settings) : null;
    if (next === needsAttention) return;
    needsAttention = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  // Keep the reader in the store's closure when the compiler outlines Hook callbacks.
  const getSnapshot = () => needsAttention;
  /** `read` reads the host's settings once, for the host only. */
  const useAttention = (shouldRead: boolean) => {
    useEffect(() => {
      if (shouldRead) void read().then(report, () => undefined);
    }, [shouldRead]);
    return useSyncExternalStore(subscribe, getSnapshot);
  };
  return { report, useAttention };
}

const discord = attentionStore<DiscordSettings>(
  () => api.getDiscordSettings(),
  (settings) =>
    settings.connectionStatus === "reconnecting" &&
    settings.commandSetup?.outcome !== "failed" &&
    settings.delivery.problems.length === 0 &&
    settings.delivery.reconciling.length === 0
      ? "attention"
      : "error",
);
const model = attentionStore<ChatModelSettings>(
  () => api.getChatModelSettings(),
  () => "error",
);

/** Records the latest Discord settings the host returned. */
export const reportDiscordSettings = discord.report;
export const useDiscordAttention = discord.useAttention;
const modelListeners = new Set<(settings: ChatModelSettings) => void>();

/** Records the latest Language model settings the host returned. */
export const reportChatModelSettings = (settings: ChatModelSettings) => {
  model.report(settings);
  for (const listener of modelListeners) listener(settings);
};

/** Calls `listener` with every Language model settings the host returns from now on. */
export const onChatModelSettings = (listener: (settings: ChatModelSettings) => void) => {
  modelListeners.add(listener);
  return () => {
    modelListeners.delete(listener);
  };
};
export const useChatModelAttention = model.useAttention;
