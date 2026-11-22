import { reportFeature } from "./api.ts";
import { useSyncExternalStore } from "react";
import { APPEARANCE_COLOR_TOKENS, type CustomThemePresentation } from "@t3-factory/contracts";
import type { AppearancePreference } from "@t3-factory/contracts/desktop-bridge";
import { desktopBridge } from "./desktop-bridge.ts";

const storageKey = "factory.appearance";
const systemSchemeQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function parsePreference(value: string | null | undefined): AppearancePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function currentPreference(): AppearancePreference {
  return parsePreference(document.documentElement.dataset.appearancePreference);
}

/** Browser chrome follows the canvas color the stylesheet resolved for this mode. */
function syncThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", color);
}

/** Switches every color at once instead of letting each control's color transition run. */
function recolor(change: () => void) {
  const root = document.documentElement;
  root.dataset.appearanceChanging = "";
  change();
  syncThemeColor();
  // Reading layout commits the new colors before transitions are allowed again.
  void root.offsetHeight;
  delete root.dataset.appearanceChanging;
}

function applyEffectiveAppearance(preference: AppearancePreference) {
  let mode = preference;
  if (mode === "system") mode = window.matchMedia(systemSchemeQuery).matches ? "dark" : "light";
  const root = document.documentElement;
  if (mode === root.dataset.appearance) return;
  recolor(() => {
    root.dataset.appearance = mode;
  });
}

function applyPreference(preference: AppearancePreference) {
  if (preference === currentPreference()) return;
  document.documentElement.dataset.appearancePreference = preference;
  applyEffectiveAppearance(preference);
  for (const listener of listeners) listener();
}

const customColorsId = "factory-custom-colors";

export function applyCustomColors(presentation: CustomThemePresentation | null) {
  recolor(() => {
    document.getElementById(customColorsId)?.remove();
    if (!presentation) return;
    const style = document.createElement("style");
    style.id = customColorsId;
    document.head.append(style);
    const sheet = style.sheet!;
    for (const mode of ["light", "dark"] as const) {
      const half = presentation.modes[mode];
      if (half.kind !== "custom") continue;
      const index = sheet.insertRule(
        `html:root[data-appearance="${mode}"] {}`,
        sheet.cssRules.length,
      );
      const rule = sheet.cssRules[index] as CSSStyleRule;
      for (const token of APPEARANCE_COLOR_TOKENS)
        rule.style.setProperty(`--${token}`, half.colors[token]);
    }
  });
}

export function startAppearance() {
  const preference = currentPreference();
  applyEffectiveAppearance(preference);
  syncThemeColor();
  window.matchMedia(systemSchemeQuery).addEventListener("change", () => {
    applyEffectiveAppearance(currentPreference());
  });

  if (desktopBridge()) return;
  try {
    const storage = window.localStorage;
    window.addEventListener("storage", (event) => {
      if (event.storageArea === storage && (event.key === storageKey || event.key === null))
        applyPreference(parsePreference(storage.getItem(storageKey)));
    });
    // A tab may have saved a new choice since the blocking script read storage.
    applyPreference(parsePreference(storage.getItem(storageKey)));
  } catch {
    // A profile that blocks storage has no persisted tab preferences to follow.
  }
}

/**
 * Applies the preference immediately, then saves it for this installation or browser profile.
 * On save failure a browser keeps the tab's choice, while desktop restores the saved preference.
 */
export async function chooseAppearance(preference: AppearancePreference): Promise<string | null> {
  const previous = currentPreference();
  applyPreference(preference);
  const desktop = desktopBridge();
  if (desktop) {
    const result = await desktop.setAppearance(preference).catch((cause: unknown) => ({
      ok: false as const,
      message: cause instanceof Error ? cause.message : "The desktop app couldn’t save the mode.",
    }));
    if (result.ok) {
      if (previous !== preference) reportFeature("theme_changed");
      return null;
    }
    applyPreference(previous);
    return result.message;
  }
  try {
    window.localStorage.setItem(storageKey, preference);
    if (previous !== preference) reportFeature("theme_changed");
    return null;
  } catch {
    return "This browser blocks saved settings, so the appearance applies until this tab closes.";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppearancePreference(): AppearancePreference {
  return useSyncExternalStore(subscribe, currentPreference);
}
