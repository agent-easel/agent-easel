import { useSyncExternalStore } from "react";
import type { CustomThemePresentation } from "@agent-easel/contracts";
import { parseCustomThemeJson, parseStoredCustomTheme } from "@agent-easel/domain-validation";
import { applyCustomColors } from "./appearance.ts";

const storageKey = "factory.custom-theme";

export interface CustomThemeState {
  readonly presentation: CustomThemePresentation | null;
  readonly rawJson: string | null;
}

export type ApplyCustomThemeResult =
  | {
      readonly ok: true;
      readonly presentation: CustomThemePresentation;
      readonly unreadColors: number;
      readonly storageWarning: string | null;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly details?: string;
    };

const EMPTY_STATE: CustomThemeState = { presentation: null, rawJson: null };
let current: CustomThemeState = EMPTY_STATE;
let generation = 0;
const listeners = new Set<() => void>();

export function beginThemeUpload(): number {
  generation += 1;
  return generation;
}

export function isCurrentThemeUpload(token: number): boolean {
  return token === generation;
}

export function cancelThemeUploads() {
  generation += 1;
}

function notify() {
  for (const listener of listeners) listener();
}

function readStoredTheme(): CustomThemeState {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return EMPTY_STATE;
    const stored = parseStoredCustomTheme(JSON.parse(raw));
    if (!stored) return EMPTY_STATE;
    return { presentation: stored.presentation, rawJson: stored.rawJson };
  } catch {
    return EMPTY_STATE;
  }
}

function setThemeState(next: CustomThemeState) {
  generation += 1;
  current = next;
  applyCustomColors(next.presentation);
  notify();
}

export function startCustomTheme() {
  setThemeState(readStoredTheme());
  try {
    const storage = window.localStorage;
    window.addEventListener("storage", (event) => {
      if (event.storageArea === storage && (event.key === storageKey || event.key === null))
        setThemeState(readStoredTheme());
    });
  } catch {
    return;
  }
}

export function applyCustomThemeJson(rawJson: string): ApplyCustomThemeResult {
  generation += 1;
  const parsed = parseCustomThemeJson(rawJson);
  if (!parsed.ok) return parsed;
  setThemeState({ presentation: parsed.presentation, rawJson });
  let storageWarning: string | null = null;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ version: 1, rawJson, presentation: parsed.presentation }),
    );
  } catch {
    storageWarning =
      "This browser blocks saved settings, so the custom colors apply until this tab closes.";
  }
  return {
    ok: true,
    presentation: parsed.presentation,
    unreadColors: parsed.unreadColors,
    storageWarning,
  };
}

export function resetCustomTheme() {
  setThemeState(EMPTY_STATE);
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCustomTheme(): CustomThemeState {
  return useSyncExternalStore(subscribe, () => current);
}
