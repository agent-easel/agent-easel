import type { Appearance } from "./desktop-bridge.ts";

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

export type AppearanceModeResult =
  | {
      readonly kind: "custom";
      readonly colors: Readonly<Record<AppearanceColorToken, string>>;
    }
  | { readonly kind: "baseline"; readonly explanation: string };

export interface CustomThemePresentation {
  readonly name: string;
  readonly modes: Readonly<Record<Appearance, AppearanceModeResult>>;
}
