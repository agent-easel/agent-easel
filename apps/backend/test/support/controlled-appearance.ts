import type { T3ThemeRead } from "../../src/adapters/t3.ts";
import { themeListing, themeRead } from "../../src/adapters/t3-theme-read.ts";

/**
 * T3's environment default theme and published theme files as `t3_theme_read` serves them over
 * the T3 connection, owned by the simulated engine. Factory reads them as the live adapter does.
 */
export class ControlledAppearance {
  /** False for a T3 that lists no `t3_theme_read`. */
  supported = true;
  defaultTheme = "";
  /** Published theme files with their ids, as the owner wrote them. */
  themes: Record<string, unknown>[] = [];
  /** Theme reads Factory made. */
  reads = 0;

  read(environmentId: string): T3ThemeRead | null {
    this.reads++;
    if (!this.supported) return null;
    const listing = themeListing({
      current: this.defaultTheme,
      published: this.themes.map(({ id, name }) => ({ id, name })),
    });
    const published = this.themes.find(({ id }) => id === this.defaultTheme);
    const file = published && { theme: { ...published, id: undefined } };
    return themeRead(environmentId, listing, file ?? null);
  }
}
