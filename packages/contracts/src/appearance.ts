import type { Appearance } from "./desktop-bridge.ts";

/**
 * Every color token of Factory's design system, by its CSS custom property name without `--`.
 * An inherited mode replaces all of them at once, so a mode never mixes inherited and baseline
 * colors.
 */
export const APPEARANCE_COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "muted",
  "muted-foreground",
  "subtle-foreground",
  "emphasis-foreground",
  "accent",
  "accent-foreground",
  "secondary",
  "secondary-foreground",
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "primary",
  "primary-hover",
  "primary-foreground",
  "brand-soft",
  "brand-soft-border",
  "link",
  "brand-cyan",
  "border",
  "border-strong",
  "border-hover",
  "input",
  "ring",
  "overlay",
  "destructive",
  "success",
  "attention",
  "status-working",
  "status-waiting",
  "status-stopped",
] as const;
export type AppearanceColorToken = (typeof APPEARANCE_COLOR_TOKENS)[number];

/**
 * One mode of an inherited palette. `inherited` colors are Factory-formatted `#rrggbb` or
 * `rgb(r g b / a)` values that passed the contrast policy; `baseline` means clients show
 * Factory's own colors for that mode, with the reason.
 */
export type AppearanceModeResult =
  | {
      readonly kind: "inherited";
      readonly colors: Readonly<Record<AppearanceColorToken, string>>;
    }
  | { readonly kind: "baseline"; readonly explanation: string };

/**
 * One validated, dual-mode presentation of the T3 environment's default theme. Clients choose
 * the half for their own Light/Dark mode. `revision` changes whenever anything below does; the
 * binding fields identify the source the colors came from.
 */
export interface AppearancePresentation {
  readonly revision: string;
  readonly environmentId: string;
  /** The upstream T3 revision Factory's palette resolver was ported from. */
  readonly resolverPin: string;
  readonly theme: { readonly id: string; readonly name: string };
  readonly modes: Readonly<Record<Appearance, AppearanceModeResult>>;
}

/**
 * The source theme colors currently come from: the connection's T3 environment and the
 * resolver. A client reuses cached colors only for exactly this source.
 */
export interface AppearanceSource {
  readonly environmentId: string;
  readonly resolverPin: string;
}

/**
 * - `connecting`: Factory is reading T3's default theme over the T3 connection.
 * - `following`: Factory follows the environment default theme.
 * - `unavailable`: the T3 connection is not authorized, T3 is unreachable or its environment
 *   cannot be matched to the T3 connection.
 * - `unsupported`: the connected T3 does not offer `t3_theme_read`.
 */
export type T3AppearanceState = "connecting" | "following" | "unavailable" | "unsupported";

/** Theme-color status for Settings. It never carries a T3 credential. */
export interface T3Appearance {
  readonly state: T3AppearanceState;
  readonly explanation: string;
  /** The last valid presentation of this session; kept through a transient outage only. */
  readonly presentation: AppearancePresentation | null;
}
