import type { Appearance } from "@t3-factory/contracts/desktop-bridge";
import { canonicalThemeColor, generateSeedColors } from "./t3-theme-generator.ts";

const T3_THEME_ROLES = [
  "canvas",
  "text",
  "textMuted",
  "placeholder",
  "surfaceRaised",
  "border",
  "input",
  "focus",
  "accent",
  "accentForeground",
  "sidebar",
  "sidebarForeground",
] as const;
export type T3ThemePalette = Readonly<Record<(typeof T3_THEME_ROLES)[number], string>>;
export type T3ThemeColors = Readonly<Record<string, string>>;

const T3_ROLE_NAMES: ReadonlySet<string> = new Set([
  ...T3_THEME_ROLES,
  "chrome",
  "toolbar",
  "toolbarForeground",
  "toolbarBorder",
  "toolbarControl",
  "toolbarControlForeground",
  "toolbarControlHover",
  "surface",
  "surfaceOverlay",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "secondaryLabel",
  "iconMuted",
  "error",
  "errorForeground",
  "errorSurface",
  "warning",
  "warningForeground",
  "warningSurface",
  "update",
  "updateForeground",
  "updateSurface",
  "accentSurface",
  "accentSurfaceForeground",
  "messageSurface",
  "messageForeground",
  "messageAction",
  "messageActionForeground",
  "messageActionHover",
  "codeBackground",
  "codeForeground",
  "searchMatchBackground",
  "searchMatchForeground",
  "searchMatchActiveBackground",
  "searchMatchActiveForeground",
  "sidebarMutedForeground",
  "sidebarControlSurface",
  "sidebarRowHover",
  "sidebarRowActive",
  "sidebarRowSelected",
  "sidebarBorder",
  "terminalBackground",
  "terminalForeground",
  "terminalCursor",
  "terminalSelection",
  "terminalScrollbar",
  "terminalScrollbarHover",
]);

export interface ResolvedTheme {
  readonly name: string;
  readonly modes: Readonly<Record<Appearance, T3ThemePalette | null>>;
}

export interface CustomThemeDefinition {
  readonly name: string;
  readonly appearance: Appearance;
  readonly seeds: { readonly canvas: string; readonly accent: string } | null;
  readonly colors: T3ThemeColors;
  readonly variant: T3ThemeColors | null;
}

const DEFAULT_BASE_PALETTES: Readonly<Record<Appearance, T3ThemePalette>> = {
  light: {
    canvas: "oklch(0.982446 0.010114 325.653)",
    text: "oklch(0.325698 0.116116 325.037)",
    textMuted: "oklch(0.494754 0.190937 354.544)",
    placeholder: "oklch(0.549927 0.090215 323.149)",
    surfaceRaised: "oklch(0.988235 0.005049 325.615)",
    border: "oklch(0.923531 0.021247 328.096)",
    input: "oklch(0.851713 0.055822 336.6)",
    focus: "oklch(0.591646 0.217985 0.584)",
    accent: "oklch(0.591646 0.217985 0.584)",
    accentForeground: "oklch(1 0 0)",
    sidebar: "oklch(0.928886 0.031178 322.592)",
    sidebarForeground: "oklch(0.396296 0.025134 285.196)",
  },
  dark: {
    canvas: "oklch(0.22813 0.020366 307.469)",
    text: "oklch(0.980735 0.004092 301.426)",
    textMuted: "oklch(0.880303 0.03077 342.696)",
    placeholder: "oklch(0.657087 0.028226 307.985)",
    surfaceRaised: "oklch(0.279864 0.021572 309.532)",
    border: "oklch(0.266943 0.015262 302.425)",
    input: "oklch(0.266817 0.02897 344.461)",
    focus: "oklch(0.591646 0.217985 0.584)",
    accent: "oklch(0.460685 0.185347 4.099)",
    accentForeground: "oklch(0.901233 0.057189 343.694)",
    sidebar: "oklch(0.185778 0.019368 322.159)",
    sidebarForeground: "oklch(0.967434 0.001326 286.375)",
  },
};

function readColors(colors: T3ThemeColors) {
  const read: Partial<Record<string, string>> = {};
  let unread = 0;
  for (const [role, color] of Object.entries(colors)) {
    if (!T3_ROLE_NAMES.has(role)) continue;
    const canonical = canonicalThemeColor(color);
    if (canonical) read[role] = canonical;
    else if ((T3_THEME_ROLES as readonly string[]).includes(role)) unread++;
  }
  return { read, unread, usable: Object.keys(read).length > 0 };
}

const withOverrides = (base: T3ThemePalette, overrides: Partial<Record<string, string>>) =>
  Object.fromEntries(
    T3_THEME_ROLES.map((role) => [role, overrides[role] ?? base[role]]),
  ) as T3ThemePalette;

export function resolveCustomThemeDefinition(definition: CustomThemeDefinition): {
  readonly theme: ResolvedTheme;
  readonly unreadColors: number;
} | null {
  const { name, appearance, seeds } = definition;
  const other: Appearance = appearance === "dark" ? "light" : "dark";
  const colors = readColors(definition.colors);
  const variant = definition.variant && readColors(definition.variant);
  if (!seeds && !colors.usable && !variant?.usable) return null;
  const base = seeds
    ? generateSeedColors(seeds.canvas, seeds.accent)
    : DEFAULT_BASE_PALETTES[appearance];
  const modes = {
    [appearance]: withOverrides(base, colors.read),
    [other]: variant ? withOverrides(DEFAULT_BASE_PALETTES[other], variant.read) : null,
  } as Record<Appearance, T3ThemePalette | null>;
  return {
    theme: { name, modes: { light: modes.light, dark: modes.dark } },
    unreadColors: colors.unread + (variant?.unread ?? 0),
  };
}
