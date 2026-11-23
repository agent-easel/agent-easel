import type { AppearanceColorToken, AppearanceModeResult } from "@t3-factory/contracts";
import type { Appearance } from "@t3-factory/contracts/desktop-bridge";
import {
  contrast,
  formatHex,
  formatTranslucent,
  luminance,
  mix,
  parseColor,
  toOklch,
  toRgb,
  type Oklch,
  type Rgb,
} from "./color.ts";
import type { ResolvedTheme, T3ThemePalette } from "./t3-theme-palettes.ts";

const FACTORY_STATUS: Readonly<Record<Appearance, Readonly<Record<StatusToken, string>>>> = {
  dark: {
    destructive: "#ef4444",
    success: "#22c55e",
    attention: "#f59e0b",
    "status-working": "#22d3ee",
    "status-waiting": "#818cf8",
    "status-stopped": "#a1a1aa",
    "brand-cyan": "#22d3ee",
  },
  light: {
    destructive: "#dc2626",
    success: "#15803d",
    attention: "#b45309",
    "status-working": "#0e7490",
    "status-waiting": "#4f46e5",
    "status-stopped": "#71717a",
    "brand-cyan": "#0e7490",
  },
};
type StatusToken =
  | "destructive"
  | "success"
  | "attention"
  | "status-working"
  | "status-waiting"
  | "status-stopped"
  | "brand-cyan";

const TEXT_CONTRAST = 4.5;
const NON_TEXT_CONTRAST = 3;
const BORDER_CONTRAST = 1.3;

const NEUTRAL_STEP = { muted: [0.04, -0.035], hover: [0.08, -0.06], selected: [0.06, -0.05] };

const INKS: readonly Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 1, g: 1, b: 1 },
];

const modeLabel = (mode: Appearance) => (mode === "dark" ? "Dark" : "Light");

class Unreadable extends Error {}

function readable(color: Oklch, surfaces: readonly Rgb[], minimum: number, what: string): Rgb {
  const worst = (candidate: Rgb) =>
    Math.min(...surfaces.map((surface) => contrast(candidate, surface)));
  if (worst(toRgb(color)) >= minimum) return toRgb(color);
  const extreme = [1, 0]
    .map((l) => ({ l, score: worst(toRgb({ ...color, l })) }))
    .sort((a, b) => b.score - a.score)[0]!;
  if (extreme.score < minimum) throw new Unreadable(`${what} that cannot be made readable`);
  let [near, far] = [color.l, extreme.l];
  for (let step = 0; step < 20; step++) {
    const l = (near + far) / 2;
    if (worst(toRgb({ ...color, l })) >= minimum) far = l;
    else near = l;
  }
  return toRgb({ ...color, l: far });
}

function parsePalette(palette: T3ThemePalette) {
  const parsed: Partial<Record<keyof T3ThemePalette, Oklch>> = {};
  for (const [role, value] of Object.entries(palette) as [keyof T3ThemePalette, string][]) {
    const color = parseColor(value);
    if (!color) throw new Unreadable("colors Factory cannot read");
    parsed[role] = color;
  }
  return parsed as Record<keyof T3ThemePalette, Oklch>;
}

function readsAs(mode: Appearance, canvas: Rgb) {
  return mode === "dark" ? luminance(canvas) <= 0.2 : luminance(canvas) >= 0.4;
}

function mapMode(palette: T3ThemePalette, mode: Appearance) {
  const t3 = parsePalette(palette);
  const step = (base: Oklch, [dark, light]: number[]) =>
    toRgb({ ...base, l: base.l + (mode === "dark" ? dark! : light!) });
  const background = toRgb(t3.canvas);
  if (!readsAs(mode, background))
    throw new Unreadable(`a canvas that does not read as ${modeLabel(mode)}`);
  const card = toRgb(t3.surfaceRaised);
  const muted = step(t3.canvas, NEUTRAL_STEP.muted);
  const hover = step(t3.canvas, NEUTRAL_STEP.hover);
  const sidebar = toRgb(t3.sidebar);
  const selected = step(t3.sidebar, NEUTRAL_STEP.selected);
  const primary = toRgb(t3.accent);

  const actionHover = (step: number) => toRgb({ ...t3.accent, l: t3.accent.l + step });
  const primaryHover = INKS.some((ink) =>
    [primary, actionHover(-0.06)].every((fill) => contrast(ink, fill) >= TEXT_CONTRAST),
  )
    ? actionHover(-0.06)
    : actionHover(0.06);
  const surfaces = [background, card, muted];

  const foreground = readable(t3.text, [...surfaces, hover], TEXT_CONTRAST, "text");

  const mutedForeground = readable(
    t3.textMuted,
    [...surfaces, hover, sidebar, selected],
    TEXT_CONTRAST,
    "secondary text",
  );
  const emphasis = readable(
    toOklch(mix(foreground, mutedForeground, 0.5)),
    surfaces,
    TEXT_CONTRAST,
    "emphasized text",
  );
  const sidebarForeground = readable(
    t3.sidebarForeground,
    [sidebar, selected],
    TEXT_CONTRAST,
    "sidebar text",
  );
  const ring = readable(t3.focus, [background, card, sidebar], NON_TEXT_CONTRAST, "focus");
  const statusSurfaces = [...surfaces, sidebar];
  const border = readable(t3.border, statusSurfaces, BORDER_CONTRAST, "borders");
  const input = readable(t3.input, statusSurfaces, BORDER_CONTRAST, "inputs");
  const status = Object.fromEntries(
    Object.entries(FACTORY_STATUS[mode]).map(([token, value]) => [
      token,
      formatHex(readable(parseColor(value)!, statusSurfaces, TEXT_CONTRAST, `${token} status`)),
    ]),
  ) as Record<StatusToken, string>;

  const colors: Record<AppearanceColorToken, string> = {
    background: formatHex(background),
    foreground: formatHex(foreground),
    card: formatHex(card),
    "card-foreground": formatHex(foreground),
    popover: formatHex(card),
    "popover-foreground": formatHex(foreground),
    muted: formatHex(muted),
    "muted-foreground": formatHex(mutedForeground),
    "subtle-foreground": formatHex(
      readable(t3.placeholder, [...surfaces, sidebar], NON_TEXT_CONTRAST, "section labels"),
    ),
    "emphasis-foreground": formatHex(emphasis),
    accent: formatHex(hover),
    "accent-foreground": formatHex(foreground),
    secondary: formatHex(hover),
    "secondary-foreground": formatHex(foreground),
    sidebar: formatHex(sidebar),
    "sidebar-foreground": formatHex(sidebarForeground),
    "sidebar-accent": formatHex(selected),
    "sidebar-accent-foreground": formatHex(sidebarForeground),
    "sidebar-border": formatHex(border),
    "sidebar-ring": formatHex(ring),
    primary: formatHex(primary),
    "primary-hover": formatHex(primaryHover),
    "primary-foreground": formatHex(
      readable(t3.accentForeground, [primary, primaryHover], TEXT_CONTRAST, "action labels"),
    ),
    "brand-soft": formatTranslucent(primary, mode === "dark" ? 0.14 : 0.08),
    "brand-soft-border": formatTranslucent(primary, mode === "dark" ? 0.6 : 0.45),
    link: formatHex(readable(t3.accent, surfaces, TEXT_CONTRAST, "links")),
    border: formatHex(border),
    "border-strong": formatHex(mix(border, foreground, 0.12)),
    "border-hover": formatHex(mix(border, foreground, 0.22)),
    input: formatHex(input),
    ring: formatHex(ring),
    overlay:
      mode === "dark" ? formatTranslucent(background, 0.8) : formatTranslucent(foreground, 0.43),
    ...status,
  };
  return colors;
}

function presentMode(theme: ResolvedTheme, mode: Appearance): AppearanceModeResult {
  const palette = theme.modes[mode];
  const fallback = `Factory’s ${modeLabel(mode)} colors are used.`;
  if (!palette)
    return {
      kind: "baseline",
      explanation: `Theme “${theme.name}” has no ${modeLabel(mode)} colors. ${fallback}`,
    };
  try {
    return { kind: "custom", colors: mapMode(palette, mode) };
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    return {
      kind: "baseline",
      explanation: `Theme “${theme.name}” has ${modeLabel(mode)} colors with ${error.message}. ${fallback}`,
    };
  }
}

export function presentThemeModes(theme: ResolvedTheme): Record<Appearance, AppearanceModeResult> {
  return { light: presentMode(theme, "light"), dark: presentMode(theme, "dark") };
}
