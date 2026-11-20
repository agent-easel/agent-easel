import type { T3Endpoint } from "./connection.ts";

export interface T3AppearanceReader {
  /**
   * `t3_theme_read` over the MCP connection. Null when T3 does not list the tool; rejects when T3
   * cannot be reached or answers outside the contract.
   */
  readTheme(target: T3Endpoint): Promise<T3ThemeRead | null>;
}

/** A published theme's colors by T3 role name; names and CSS color text are length-bounded. */
export type T3ThemeColors = Readonly<Record<string, string>>;
/**
 * One theme definition T3 publishes for its environment: seeds, role colors or both for its own
 * `appearance`, and optional role colors for the other mode. `definition` is null when the
 * definition is not in the format Factory supports.
 */
export interface PublishedT3Theme {
  readonly id: string;
  readonly name: string;
  readonly definition: {
    readonly appearance: "light" | "dark";
    /** `#rgb` or `#rrggbb` seeds; T3 generates from them only when both are given. */
    readonly seeds: { readonly canvas: string; readonly accent: string } | null;
    readonly colors: T3ThemeColors;
    /** Colors for the mode other than `appearance`; null when the theme declares none. */
    readonly variant: T3ThemeColors | null;
  } | null;
}

/**
 * The only theme facts Factory keeps from T3: the environment that answered, its default theme
 * id and, when that id names a published theme, its definition.
 */
export interface T3ThemeRead {
  readonly environmentId: string | null;
  readonly defaultTheme: string;
  readonly themes: readonly PublishedT3Theme[];
}
