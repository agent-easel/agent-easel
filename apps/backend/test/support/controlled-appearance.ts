import type { T3AppearanceReader, T3ThemeRead } from "../../src/t3/appearance.ts";
import { themeListing, themeRead } from "../../src/t3/theme-read.ts";
import type { ControlledT3Connection } from "./controlled-t3-connection.ts";

/**
 * T3's environment default theme and published theme files as `t3_theme_read` serves them over
 * the T3 connection, owned by the simulated engine. Factory reads them as the live module does.
 */
export class ControlledAppearance implements T3AppearanceReader {
  private readonly connection: ControlledT3Connection;

  constructor(connection: ControlledT3Connection) {
    this.connection = connection;
  }

  /** False for a T3 that lists no `t3_theme_read`. */
  supported = true;
  defaultTheme = "";
  /** Published theme files with their ids, as the owner wrote them. */
  themes: Record<string, unknown>[] = [];
  /** Theme reads Factory made. */
  reads = 0;

  async readTheme(): Promise<T3ThemeRead | null> {
    this.connection.requireConnection();
    this.reads++;
    if (!this.supported) return null;
    const listing = themeListing({
      current: this.defaultTheme,
      published: this.themes.map(({ id, name }) => ({ id, name })),
    });
    const published = this.themes.find(({ id }) => id === this.defaultTheme);
    const file = published && { theme: { ...published, id: undefined } };
    return themeRead(this.connection.environmentId, listing, file ?? null);
  }
}
