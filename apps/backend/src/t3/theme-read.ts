import type { PublishedT3Theme, T3ThemeColors, T3ThemeRead } from "./appearance.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
const stringField = (value: unknown, ...path: string[]) => {
  const found = field(value, ...path);
  return typeof found === "string" ? found : undefined;
};

/** T3 examines at most this many theme files, and each is far smaller than these bounds. */
const MAX_THEMES = 32;
const MAX_THEME_COLORS = 256;
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const THEME_SEED = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const THEME_ROLE = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;

const absentOr = <Value>(value: unknown, read: (given: unknown) => Value | undefined) =>
  value === undefined ? null : read(value);

/** A record of role names to short color texts, or undefined for any other shape. */
function themeColors(value: unknown): T3ThemeColors | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  const bounded = entries.every(
    ([role, color]) =>
      THEME_ROLE.test(role) && typeof color === "string" && color.length > 0 && color.length <= 64,
  );
  return bounded && entries.length <= MAX_THEME_COLORS
    ? (Object.fromEntries(entries) as T3ThemeColors)
    : undefined;
}

const themeSeed = (value: unknown) =>
  typeof value === "string" && THEME_SEED.test(value) ? value : undefined;

/** The definition of T3's theme file version 1, or null for any structure Factory does not read. */
function themeDefinition(theme: Record<string, unknown>): PublishedT3Theme["definition"] {
  const { version, appearance } = theme;
  if ((version !== undefined && version !== 1) || (appearance !== "light" && appearance !== "dark"))
    return null;
  const other = appearance === "dark" ? "light" : "dark";
  const variants = theme.variants === undefined ? {} : theme.variants;
  if (!isRecord(variants) || Array.isArray(variants)) return null;
  const canvas = absentOr(theme.canvas, themeSeed);
  const accent = absentOr(theme.accent, themeSeed);
  const colors = absentOr(theme.colors, themeColors);
  const variant = absentOr(variants[other], themeColors);
  // A variant for the theme's own appearance is never used, but it must still be well-formed.
  const unused = absentOr(variants[appearance], themeColors);
  if ([canvas, accent, colors, variant, unused].includes(undefined)) return null;
  return {
    appearance,
    seeds: canvas && accent ? { canvas, accent } : null,
    colors: colors ?? {},
    variant: variant ?? null,
  };
}

/**
 * Published theme files with their ids. Entries without a usable id and name are dropped; a
 * named theme in another format is kept without a definition, so Settings can say why it is not
 * followed.
 */
export function publishedThemes(themes: readonly unknown[]): PublishedT3Theme[] {
  return themes.slice(0, MAX_THEMES).flatMap((theme) => {
    const id = stringField(theme, "id");
    const name = stringField(theme, "name")?.trim();
    if (!isRecord(theme) || !id || !THEME_ID.test(id) || !name || name.length > 48) return [];
    return [{ id, name, definition: themeDefinition(theme) }];
  });
}

/**
 * T3's default theme id, bounded before Settings names it to every client. An id outside the
 * published form is cut and marked, so it can name no built-in or published theme.
 */
const defaultThemeId = (id: string) =>
  id === "" || THEME_ID.test(id) ? id : `${id.slice(0, 48)}…`;

/** What `t3_theme_read` without arguments lists: the default theme id and published theme ids. */
export interface T3ThemeListing {
  readonly defaultTheme: string;
  readonly published: readonly string[];
}

/** Throws for an answer outside `t3_theme_read`'s contract. */
export function themeListing(value: unknown): T3ThemeListing {
  const current = field(value, "current");
  const published = field(value, "published");
  if (typeof current !== "string" || !Array.isArray(published))
    throw new Error("t3_theme_read did not return the default theme and published themes.");
  return {
    defaultTheme: defaultThemeId(current),
    published: published.flatMap((theme) => {
      const id = stringField(theme, "id");
      return id ? [id] : [];
    }),
  };
}

/**
 * The theme facts Factory follows. `file` is `t3_theme_read`'s `theme` for the published
 * default, which T3 returns without its id.
 */
export function themeRead(
  environmentId: string | null,
  listing: T3ThemeListing,
  file: unknown,
): T3ThemeRead {
  const theme = field(file, "theme");
  return {
    environmentId,
    defaultTheme: listing.defaultTheme,
    themes: isRecord(theme) ? publishedThemes([{ ...theme, id: listing.defaultTheme }]) : [],
  };
}
