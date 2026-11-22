import {
  APPEARANCE_COLOR_TOKENS,
  type AppearanceColorToken,
  type AppearanceModeResult,
  type CustomThemePresentation,
} from "@t3-factory/contracts";
import { presentThemeModes } from "./theme/palette-mapping.ts";
import {
  resolveCustomThemeDefinition,
  type CustomThemeDefinition,
  type T3ThemeColors,
} from "./theme/t3-theme-palettes.ts";

const COLOR = /^(#[0-9a-f]{6}|rgb\(\d{1,3} \d{1,3} \d{1,3} \/ (0|1|0?\.\d{1,6})\))$/;
const TEXT_LIMIT = 512;
const MAX_JSON_BYTES = 131_072;
const MAX_THEME_COLORS = 256;
const THEME_SEED = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const THEME_ROLE = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;

export type CustomThemeParseResult =
  | {
      readonly ok: true;
      readonly presentation: CustomThemePresentation;
      readonly unreadColors: number;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly details?: string;
    };

export interface StoredCustomTheme {
  readonly version: 1;
  readonly rawJson: string;
  readonly presentation: CustomThemePresentation;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= TEXT_LIMIT;

function readColorRecord(value: unknown): T3ThemeColors | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_THEME_COLORS) return undefined;
  const valid = entries.every(
    ([role, color]) =>
      THEME_ROLE.test(role) && typeof color === "string" && color.length > 0 && color.length <= 64,
  );
  return valid ? (Object.fromEntries(entries) as T3ThemeColors) : undefined;
}

function readSeed(value: unknown): string | undefined {
  return typeof value === "string" && THEME_SEED.test(value) ? value : undefined;
}

type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

function parseThemeName(raw: unknown): FieldResult<string> {
  const candidate = raw === undefined ? "Custom theme" : raw;
  if (typeof candidate !== "string")
    return { ok: false, message: '"name" must be a string of 1–48 characters.' };
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > 48)
    return { ok: false, message: '"name" must be a string of 1–48 characters.' };
  return { ok: true, value: trimmed };
}

function parseSeeds(
  rawCanvas: unknown,
  rawAccent: unknown,
): FieldResult<{ readonly canvas: string; readonly accent: string } | null> {
  const hasCanvas = rawCanvas !== undefined;
  const hasAccent = rawAccent !== undefined;
  if (!hasCanvas && !hasAccent) return { ok: true, value: null };
  if (hasCanvas !== hasAccent)
    return { ok: false, message: 'Provide both "canvas" and "accent" hex colors, or neither.' };
  const canvas = readSeed(rawCanvas);
  const accent = readSeed(rawAccent);
  if (!canvas || !accent)
    return { ok: false, message: '"canvas" and "accent" must be #rgb or #rrggbb hex colors.' };
  return { ok: true, value: { canvas, accent } };
}

function parseVariants(
  rawVariants: unknown,
  appearance: "light" | "dark",
): FieldResult<T3ThemeColors | null> {
  if (rawVariants === undefined) return { ok: true, value: null };
  if (!isRecord(rawVariants))
    return { ok: false, message: '"variants" must be an object with optional light/dark colors.' };
  const other = appearance === "dark" ? "light" : "dark";
  const variant = rawVariants[other] === undefined ? null : readColorRecord(rawVariants[other]);
  const unused =
    rawVariants[appearance] === undefined ? null : readColorRecord(rawVariants[appearance]);
  if (variant === undefined || unused === undefined)
    return { ok: false, message: 'Each "variants" entry must map role names to color strings.' };
  return { ok: true, value: variant };
}

function parseDefinition(raw: Record<string, unknown>):
  | { readonly ok: true; readonly definition: CustomThemeDefinition }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  if (raw.version !== undefined && raw.version !== 1)
    return { ok: false, message: "Only theme config version 1 is supported." };
  if (raw.appearance !== "light" && raw.appearance !== "dark")
    return { ok: false, message: 'Theme config must set "appearance" to "light" or "dark".' };
  const name = parseThemeName(raw.name);
  if (!name.ok) return name;
  const seeds = parseSeeds(raw.canvas, raw.accent);
  if (!seeds.ok) return seeds;
  const colors = raw.colors === undefined ? {} : readColorRecord(raw.colors);
  if (!colors)
    return {
      ok: false,
      message: '"colors" must be an object mapping role names to color strings.',
    };
  const variant = parseVariants(raw.variants, raw.appearance);
  if (!variant.ok) return variant;
  return {
    ok: true,
    definition: {
      name: name.value,
      appearance: raw.appearance,
      seeds: seeds.value,
      colors,
      variant: variant.value,
    },
  };
}

export function parseCustomThemeJson(rawJson: string): CustomThemeParseResult {
  if (rawJson.trim().length === 0)
    return { ok: false, message: "Paste or upload a theme JSON config first." };
  if (rawJson.length > MAX_JSON_BYTES)
    return { ok: false, message: "Theme config is larger than the 128 KB limit." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      ok: false,
      message: "Theme config is not valid JSON.",
      ...(error instanceof Error ? { details: error.message } : {}),
    };
  }
  if (!isRecord(parsed)) return { ok: false, message: "Theme config must be a JSON object." };
  const defined = parseDefinition(parsed);
  if (!defined.ok) return defined;
  const resolved = resolveCustomThemeDefinition(defined.definition);
  if (!resolved)
    return {
      ok: false,
      message: `Theme “${defined.definition.name}” has no seeds or readable colors Factory can use.`,
    };
  const modes = presentThemeModes(resolved.theme);
  if (modes.light.kind === "baseline" && modes.dark.kind === "baseline")
    return {
      ok: false,
      message: `Factory can’t use the “${resolved.theme.name}” theme.`,
      details: [modes.light.explanation, modes.dark.explanation].join("\n"),
    };
  return {
    ok: true,
    presentation: { name: resolved.theme.name, modes },
    unreadColors: resolved.unreadColors,
  };
}

function parseMode(value: unknown): AppearanceModeResult | null {
  if (!isRecord(value)) return null;
  if (value.kind === "baseline")
    return isText(value.explanation) ? { kind: "baseline", explanation: value.explanation } : null;
  if (value.kind !== "custom" || !isRecord(value.colors)) return null;
  const colors: Partial<Record<AppearanceColorToken, string>> = {};
  for (const token of APPEARANCE_COLOR_TOKENS) {
    const color = value.colors[token];
    if (typeof color !== "string" || !COLOR.test(color)) return null;
    colors[token] = color;
  }
  return { kind: "custom", colors: colors as Record<AppearanceColorToken, string> };
}

export function parseStoredCustomTheme(value: unknown): StoredCustomTheme | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (
    typeof value.rawJson !== "string" ||
    value.rawJson.length === 0 ||
    value.rawJson.length > MAX_JSON_BYTES
  )
    return null;
  if (!isRecord(value.presentation) || !isRecord(value.presentation.modes)) return null;
  const { name, modes } = value.presentation;
  const light = parseMode(modes.light);
  const dark = parseMode(modes.dark);
  if (!isText(name) || !light || !dark) return null;
  return {
    version: 1,
    rawJson: value.rawJson,
    presentation: { name, modes: { light, dark } },
  };
}
